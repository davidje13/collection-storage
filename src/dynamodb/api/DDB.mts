import { retry, makeKeyValue, safeSet, safeGet } from 'collection-storage/index.mts';
import type { AWS } from './AWS.mts';
import { type Results, Paged } from './Results.mts';
import { AWSError } from './AWSError.mts';

// https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/Welcome.html

export type DDBValue =
  | { S: string }
  | { N: string } // number
  | { B: string } // binary (base64)
  | { BOOL: boolean }
  | { NULL: true }
  | { M: Record<string, DDBValue> }
  | { L: DDBValue[] }
  | { SS: string[] } // stringset
  | { NS: string[] } // numberset
  | { BS: string[] }; // binaryset (base64)

export type DDBItem = Record<string, DDBValue>;

type DDBType = 'S' | 'N' | 'B' | 'BOOL' | 'NULL' | 'M' | 'L' | 'SS' | 'NS' | 'BS';
type DDBKeyType = 'HASH' | 'RANGE';

interface DDBConsumedCapacity {
  CapacityUnits: number;
}

interface DDBResponse {
  ConsumedCapacity?: DDBConsumedCapacity | DDBConsumedCapacity[];
}

interface DDBReturnedItem extends DDBResponse {
  Attributes: DDBItem;
}

interface DDBGetResponse extends DDBResponse {
  Item: DDBItem;
}

interface DDBBatchGetResponse extends DDBResponse {
  Responses: Record<string, DDBItem[]>;
  UnprocessedKeys: Record<
    string,
    {
      Keys: DDBItem[];
    }
  >;
}

interface DDBBatchWriteResponse extends DDBResponse {
  UnprocessedItems: Record<
    string,
    {
      DeleteRequest?: {
        Key: DDBItem;
      };
      PutRequest?: {
        Item: DDBItem;
      };
    }[]
  >;
}

interface DDBListTablesResponse extends DDBResponse {
  TableNames: string[];
  LastEvaluatedTableName?: string;
}

interface DDBScanResponse extends DDBResponse {
  Items: DDBItem[];
  LastEvaluatedKey?: DDBItem;
}

export interface DDBProvisionedThroughput {
  ReadCapacityUnits: number;
  WriteCapacityUnits: number;
}

interface DDBGlobalSecondaryIndex {
  Backfilling?: boolean | undefined;
  IndexName: string;
  IndexStatus?: string | undefined;
  KeySchema: {
    AttributeName: string;
    KeyType: DDBKeyType;
  }[];
  Projection?:
    | {
        NonKeyAttributes?: string[] | undefined;
        ProjectionType: string;
      }
    | undefined;
  ProvisionedThroughput?: DDBProvisionedThroughput | undefined;
}

interface DDBAttributeDefinition {
  AttributeName: string;
  AttributeType: string;
}

interface DDBDescribeResponse extends DDBResponse {
  Table: {
    AttributeDefinitions: DDBAttributeDefinition[];
    GlobalSecondaryIndexes?: DDBGlobalSecondaryIndex[] | undefined;
    ItemCount: number;
    KeySchema: {
      AttributeName: string;
      KeyType: DDBKeyType;
    }[];
    TableStatus: string;
    ProvisionedThroughput: DDBProvisionedThroughput;
  };
}

interface KeyDefinition {
  attributeName: string;
  attributeType: DDBType;
  keyType: DDBKeyType;
}

interface GlobalSecondaryIndexDefinition {
  indexName: string;
  keySchema: KeyDefinition[];
  projectionType?: 'KEYS_ONLY' | 'INCLUDE' | 'ALL' | undefined;
  nonKeyAttributes?: string[] | undefined;
  throughput?: DDBProvisionedThroughput | undefined;
}

const AWS_URL_FORMAT = /^([^:]*):\/\/dynamodb\.([^.]+)\.amazonaws\.com(\/?.*)$/;
const ResourceInUseException = 'ResourceInUseException';
const ResourceNotFoundException = 'ResourceNotFoundException';

function ifNotEmpty<T extends any[] | string>(l: T): T | undefined {
  return l.length ? l : undefined;
}

function flatten(value: DDBItem, keys: string[]): string {
  // this is only used for internal short-term lookups, so securing value[key] is not necessary
  return keys.map((key) => JSON.stringify(value[key])).join();
}

interface ExpressionDefinition {
  attributeExpression: (attr: string, value: string) => string;
  joiner: string | ((items: string[]) => string);
  attributes: Readonly<DDBItem | string[]>;
}

function escapedExpressions(
  expressions: Record<string, ExpressionDefinition>,
): Record<string, unknown> {
  let i = 0;
  const attrValues: DDBItem = {};
  const attrNames: Record<string, string> = {};
  let hasExpr = false;
  let hasAnyValues = false;
  const result: Record<string, unknown> = {};

  for (const [key, { attributeExpression, joiner, attributes }] of Object.entries(expressions)) {
    const parts: string[] = [];
    if (Array.isArray(attributes)) {
      if (!attributes.length) {
        continue;
      }
      for (const attr of attributes) {
        const attrName = `#${i}`;
        const attrValue = `:${i}`;
        parts.push(attributeExpression(attrName, attrValue));
        safeSet(attrNames, attrName, attr);
        ++i;
      }
    } else {
      const rawAttr = Object.entries(attributes);
      if (!rawAttr.length) {
        continue;
      }
      for (const [attr, value] of rawAttr) {
        const attrName = `#${i}`;
        const attrValue = `:${i}`;
        parts.push(attributeExpression(attrName, attrValue));
        safeSet(attrNames, attrName, attr);
        safeSet(attrValues, attrValue, value);
        ++i;
      }
      hasAnyValues = true;
    }

    // key is trusted
    result[key] = typeof joiner === 'string' ? parts.join(joiner) : joiner(parts);
    hasExpr = true;
  }

  if (!hasExpr) {
    return {};
  }

  return {
    ...result,
    ExpressionAttributeValues: hasAnyValues ? attrValues : undefined,
    ExpressionAttributeNames: attrNames,
  };
}

const projection = (attrs: readonly string[] | undefined): ExpressionDefinition => ({
  attributeExpression: (attr): string => attr,
  joiner: ',',
  attributes: attrs || [],
});

const retryPolling = retry(
  (e) =>
    AWSError.isType(e, ResourceNotFoundException) ||
    (e instanceof Error && e.message === 'pending'),
  { timeoutMillis: 60000, maxDelayMillis: 1000, jitter: false },
);
const retryRemaining = retry(
  (e) => e instanceof Error && e.message === 'remaining unprocessed items',
);

const INVALID_NAME_CHARS = /[^-a-zA-Z0-9_.]/g;

export function escapeName(name: string): string {
  // no standard escape scheme conforms to DDB restrictions, so this is home-grown:
  // (does not attempt to ensure no collisions; more important to allow valid
  // names through unchanged)
  return name
    .replace(INVALID_NAME_CHARS, (c) => {
      const code = c.charCodeAt(0);
      const hex = code.toString(16);
      if (hex.length <= 2) {
        return `_u${hex.padStart(2, '0')}`;
      }
      return `_U${hex.padStart(4, '0')}`;
    })
    .padEnd(3, '_');
}

interface DDBOptions {
  consistentRead?: boolean | undefined;
}

function createAttributeDefinitions(schemas: KeyDefinition[][]): DDBAttributeDefinition[] {
  const attrs = new Map<string, DDBType>();
  for (const keys of schemas) {
    for (const { attributeName, attributeType } of keys) {
      if (!attrs.has(attributeName)) {
        attrs.set(attributeName, attributeType);
      } else if (attrs.get(attributeName) !== attributeType) {
        throw new Error(`inconsistent attribute type for ${attributeName}`);
      }
    }
  }
  return [...attrs.entries()].map(([attributeName, attributeType]) => ({
    AttributeName: attributeName,
    AttributeType: attributeType,
  }));
}

function createSecondaryIndex(i: GlobalSecondaryIndexDefinition): DDBGlobalSecondaryIndex {
  return {
    IndexName: i.indexName,
    KeySchema: i.keySchema.map(({ attributeName, keyType }) => ({
      AttributeName: attributeName,
      KeyType: keyType,
    })),
    Projection: {
      ProjectionType: i.projectionType || (i.nonKeyAttributes ? 'INCLUDE' : 'KEYS_ONLY'),
      NonKeyAttributes: i.nonKeyAttributes,
    },
    ProvisionedThroughput: i.throughput,
  };
}

function indicesMatch(a: GlobalSecondaryIndexDefinition, b: DDBGlobalSecondaryIndex): boolean {
  if (a.keySchema.length !== b.KeySchema.length) {
    return false;
  }
  return a.keySchema.every(
    (k, i) =>
      k.attributeName === b.KeySchema[i]!.AttributeName && k.keyType === b.KeySchema[i]!.KeyType,
  );
}

export class DDB {
  /** @internal */ private readonly _aws: AWS;
  /** @internal */ private readonly _host: string;
  /** @internal */ private readonly _region: string;
  /** @internal */ private readonly _consistentRead: boolean;
  /** @internal */ private _totalCapacityUnits = 0;

  /** @internal */ constructor(
    aws: AWS,
    host: string,
    { consistentRead = false }: DDBOptions = {},
  ) {
    this._aws = aws;
    this._host = host;
    const parts = AWS_URL_FORMAT.exec(host);
    this._region = parts?.[1] ?? 'us-east-1'; // default region for API calls
    this._consistentRead = consistentRead;
  }

  getConsumedUnits(): number {
    return this._totalCapacityUnits;
  }

  getTableNames(): Results<string> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_ListTables.html
    return new Paged(
      this._aws,
      async (lastTableName) => {
        const response: DDBListTablesResponse = await this._call('ListTables', {
          ExclusiveStartTableName: lastTableName,
        });
        return [response.TableNames, response.LastEvaluatedTableName];
      },
      10,
    );
  }

  upsertTable(
    tableName: string,
    pKeySchema: KeyDefinition[],
    secondaryIndices: GlobalSecondaryIndexDefinition[] = [],
    waitForReady: boolean,
    throughput?: DDBProvisionedThroughput | undefined,
  ): Promise<boolean> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
    return this._aws.do(async () => {
      let created = false;
      try {
        await this._call('CreateTable', {
          TableName: tableName,
          AttributeDefinitions: createAttributeDefinitions([
            pKeySchema,
            ...secondaryIndices.map(({ keySchema }) => keySchema),
          ]),
          KeySchema: pKeySchema.map(({ attributeName, keyType }) => ({
            AttributeName: attributeName,
            KeyType: keyType,
          })),
          GlobalSecondaryIndexes: ifNotEmpty(secondaryIndices.map((i) => createSecondaryIndex(i))),
          BillingMode: throughput ? 'PROVISIONED' : 'PAY_PER_REQUEST',
          ProvisionedThroughput: throughput,
        });
        created = true;
      } catch (e) {
        if (AWSError.isType(e, ResourceInUseException)) {
          await this._replaceIndices(tableName, secondaryIndices);
        } else {
          throw e;
        }
      }

      if (waitForReady) {
        await this.waitForTable(tableName, true);
      }

      return created;
    });
  }

  describeTable(tableName: string): Promise<DDBDescribeResponse> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTable.html
    return this._call('DescribeTable', { TableName: tableName });
  }

  waitForTable(tableName: string, waitForIndices: boolean): Promise<void> {
    return retryPolling.promise(async () => {
      const desc = await this.describeTable(tableName);
      if (desc.Table.TableStatus !== 'ACTIVE') {
        throw new Error('pending');
      }
      const indices = desc.Table.GlobalSecondaryIndexes;
      if (waitForIndices && indices && indices.some((i) => i.IndexStatus !== 'ACTIVE')) {
        throw new Error('pending');
      }
    });
  }

  async deleteTable(tableName: string): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteTable.html
    await this._call('DeleteTable', { TableName: tableName });
  }

  async putItem(tableName: string, item: DDBItem, unique?: string | undefined): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
    await this._call('PutItem', {
      TableName: tableName,
      Item: item,
      ...escapedExpressions({
        ConditionExpression: {
          attributeExpression: (attr): string => `attribute_not_exists(${attr})`,
          joiner: ' and ',
          attributes: unique ? [unique] : [],
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
    });
  }

  async updateItem(
    tableName: string,
    key: DDBItem,
    update: DDBItem,
    condition?: DDBItem | undefined,
  ): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html
    await this._call('UpdateItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        UpdateExpression: {
          attributeExpression: (attr, value): string => `${attr}=${value}`,
          joiner: (l): string => `SET ${l.join(',')}`,
          attributes: update,
        },
        ConditionExpression: {
          attributeExpression: (attr, value): string => `${attr}=${value}`,
          joiner: ' and ',
          attributes: condition || {},
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
    });
  }

  async getItem(
    tableName: string,
    key: DDBItem,
    requestedAttrs?: readonly string[] | undefined,
  ): Promise<DDBItem | null> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
    const data: DDBGetResponse = await this._call('GetItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        ProjectionExpression: projection(requestedAttrs),
      }),
      ConsistentRead: this._consistentRead,
      ReturnConsumedCapacity: 'TOTAL',
    });

    // DDB is inconsistent in how it returns 'not found' state:
    if (!data.Item || !Object.keys(data.Item).length) {
      return null;
    }
    return data.Item;
  }

  async batchGetItems(
    tableName: string,
    keys: DDBItem[],
    requestedAttrs?: readonly string[] | undefined,
  ): Promise<(DDBItem | null)[]> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
    if (!keys.length) {
      return [];
    }
    if (keys.length === 1) {
      return [await this.getItem(tableName, keys[0]!, requestedAttrs)];
    }

    const keyAttrs = Object.keys(keys[0]!);
    const fullAttrs = requestedAttrs?.slice();
    if (fullAttrs) {
      for (const k of keyAttrs) {
        if (!fullAttrs.includes(k)) {
          fullAttrs.push(k);
        }
      }
    }

    const indices = new Map<string, number>();
    keys.forEach((key, i) => indices.set(flatten(key, keyAttrs), i));

    const extracted: (DDBItem | null)[] = keys.map(() => null);
    const tableQuery = {
      ...escapedExpressions({ ProjectionExpression: projection(fullAttrs) }),
      ConsistentRead: this._consistentRead,
    };

    await this._callBatched(keys, 100, async (batchKeys) => {
      const data: DDBBatchGetResponse = await this._call('BatchGetItem', {
        RequestItems: makeKeyValue(tableName, {
          ...tableQuery,
          Keys: batchKeys,
        }),
        ReturnConsumedCapacity: 'TOTAL',
      });
      for (const item of safeGet(data.Responses, tableName)!) {
        const index = indices.get(flatten(item, keyAttrs));
        if (index !== undefined) {
          extracted[index] = item;
        }
      }
      return safeGet(data.UnprocessedKeys, tableName)?.Keys || [];
    });

    return extracted;
  }

  batchPutItems(tableName: string, items: DDBItem[]): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    return this._callBatched(items, 25, async (batchItems) => {
      const data: DDBBatchWriteResponse = await this._call('BatchWriteItem', {
        RequestItems: makeKeyValue(
          tableName,
          batchItems.map((item) => ({
            PutRequest: { Item: item },
          })),
        ),
        ReturnConsumedCapacity: 'TOTAL',
      });
      return (safeGet(data.UnprocessedItems, tableName) || []).map((i) => i.PutRequest!.Item);
    });
  }

  batchDeleteItems(tableName: string, keys: DDBItem[]): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    return this._callBatched(keys, 25, async (batchKeys) => {
      const data: DDBBatchWriteResponse = await this._call('BatchWriteItem', {
        RequestItems: makeKeyValue(
          tableName,
          batchKeys.map((key) => ({
            DeleteRequest: { Key: key },
          })),
        ),
        ReturnConsumedCapacity: 'TOTAL',
      });
      return (safeGet(data.UnprocessedItems, tableName) || []).map((i) => i.DeleteRequest!.Key);
    });
  }

  getAllItems(tableName: string, requestedAttrs?: readonly string[] | undefined): Results<DDBItem> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
    const query = {
      TableName: tableName,
      ...escapedExpressions({
        ProjectionExpression: projection(requestedAttrs),
      }),
      ConsistentRead: this._consistentRead,
      ReturnConsumedCapacity: 'TOTAL',
    };
    return new Paged(this._aws, async (lastKey) => {
      const response: DDBScanResponse = await this._call('Scan', {
        ...query,
        ExclusiveStartKey: lastKey,
      });
      return [response.Items, response.LastEvaluatedKey];
    });
  }

  async getItemsBySecondaryKey(
    tableName: string,
    indexName: string,
    key: DDBItem,
    requestedAttrs: readonly string[] | undefined,
    limitOne: boolean,
  ): Promise<DDBItem[]> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
    const colocatedAttrs = ['id'];
    const nonColocatedAttrs: string[] = [];
    for (const attr of requestedAttrs || []) {
      if (attr !== 'id') {
        if (Object.prototype.hasOwnProperty.call(key, attr)) {
          colocatedAttrs.push(attr);
        } else {
          nonColocatedAttrs.push(attr);
        }
      }
    }
    const query = {
      TableName: tableName,
      IndexName: indexName,
      ...escapedExpressions({
        KeyConditionExpression: {
          attributeExpression: (attr, value): string => `${attr}=${value}`,
          joiner: ' and ',
          attributes: key,
        },
        ProjectionExpression: projection(colocatedAttrs),
      }),
      ConsistentRead: false, // cannot be true for Global Secondary Index
      ReturnConsumedCapacity: 'TOTAL',
    };
    let items: DDBItem[];
    if (limitOne) {
      const response: DDBScanResponse = await this._call('Query', {
        ...query,
        Limit: 1,
      });
      items = response.Items;
    } else {
      items = await new Paged(this._aws, async (lastKey) => {
        const response: DDBScanResponse = await this._call('Query', {
          ...query,
          ExclusiveStartKey: lastKey,
        });
        return [response.Items, response.LastEvaluatedKey];
      }).all();
    }

    if (!items.length || (requestedAttrs && !nonColocatedAttrs.length)) {
      return items;
    }

    const pkItems = await this.batchGetItems(
      tableName,
      items.map(({ id }) => ({ id: id! })),
      ifNotEmpty(nonColocatedAttrs),
    );
    return items
      .map((item, i) => (pkItems[i] ? { ...item, ...pkItems[i] } : null))
      .filter((item) => item) as DDBItem[];
  }

  async deleteItem(tableName: string, key: DDBItem): Promise<void> {
    await this._callDelete(tableName, key, false);
  }

  /** @internal */ _deleteAndReturnItem(tableName: string, key: DDBItem): Promise<DDBItem> {
    return this._callDelete(tableName, key, true);
  }

  /** @internal */ private async _callDelete(
    tableName: string,
    key: DDBItem,
    returnOld: boolean,
  ): Promise<DDBItem> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
    const response: DDBReturnedItem = await this._call('DeleteItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        ConditionExpression: {
          attributeExpression: (attr): string => `attribute_exists(${attr})`,
          joiner: ' and ',
          attributes: [Object.keys(key)[0]!],
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
      ReturnValues: returnOld ? 'ALL_OLD' : undefined,
    });
    return response.Attributes;
  }

  /** @internal */ private async _replaceIndices(
    tableName: string,
    secondaryIndices: GlobalSecondaryIndexDefinition[] = [],
  ): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTable.html
    const existing = await this.describeTable(tableName);
    const indices = new Map<string, DDBGlobalSecondaryIndex>();
    const toCreate: GlobalSecondaryIndexDefinition[] = [];
    const oldIndices = existing.Table.GlobalSecondaryIndexes || [];
    for (const idx of oldIndices) {
      indices.set(idx.IndexName, idx);
    }
    for (const idx of secondaryIndices) {
      const old = indices.get(idx.indexName);
      if (old) {
        if (!indicesMatch(idx, old)) {
          throw new Error(`Cannot change existing index definition ${idx.indexName}`);
        }
        indices.delete(idx.indexName);
      } else {
        toCreate.push(idx);
      }
    }
    const toDelete = [...indices.keys()];
    for (const idx of toDelete) {
      await this._call('UpdateTable', {
        TableName: tableName,
        GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: idx } }],
      });
      // must wait for table to be ACTIVE before next update can be applied
      await this.waitForTable(tableName, false);
    }
    for (const idx of toCreate) {
      await this._call('UpdateTable', {
        TableName: tableName,
        AttributeDefinitions: createAttributeDefinitions([idx.keySchema]),
        GlobalSecondaryIndexUpdates: [{ Create: createSecondaryIndex(idx) }],
      });
      // must wait for table to be ACTIVE before next update can be applied
      await this.waitForTable(tableName, false);
    }
  }

  /** @internal */ private _callBatched<T>(
    items: T[],
    batchLimit: number,
    fn: (batchItems: T[]) => Promise<T[]>,
  ): Promise<void> {
    const remaining = items.slice();
    return this._aws.do(() =>
      retryRemaining.promise(async () => {
        const queue = remaining.slice();
        remaining.length = 0;
        while (queue.length) {
          const batchItems = queue.splice(0, batchLimit);

          const retryItems = await fn(batchItems);
          remaining.push(...retryItems);
        }
        if (remaining.length) {
          throw new Error('remaining unprocessed items');
        }
      }),
    );
  }

  /** @internal */ private async _call<T extends DDBResponse = DDBResponse>(
    fnName: string,
    body?: string | Record<string, unknown> | Buffer | undefined,
  ): Promise<T> {
    const response = await this._aws.request({
      method: 'POST',
      url: this._host,
      region: this._region,
      service: 'dynamodb',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `DynamoDB_20120810.${fnName}`,
      },
      body,
    });
    // DynamoDB does not include read/write capacity usage for errors,
    // though they can consume capacity.
    // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.ConditionalWrites.ReturnConsumedCapacity

    const data = response.json as T;
    if (data.ConsumedCapacity) {
      let capacity;
      if (Array.isArray(data.ConsumedCapacity)) {
        capacity = data.ConsumedCapacity.reduce((t, c) => t + Number(c.CapacityUnits), 0);
      } else {
        capacity = Number(data.ConsumedCapacity.CapacityUnits);
      }
      this._totalCapacityUnits += capacity;
    }
    return data;
  }
}
