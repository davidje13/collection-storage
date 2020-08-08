import type { AWS, AWSErrorResponse } from './AWS';
import { Results, Paged } from './Results';
import DDBError from './DDBError';
import retry from '../../helpers/retry';

// https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/Welcome.html

export type DDBValue =
  { S: string } |
  { N: string } | // number
  { B: string } | // binary (base64)
  { BOOL: boolean } |
  { NULL: true } |
  { M: Record<string, DDBValue> } |
  { L: DDBValue[] } |
  { SS: string[] } | // stringset
  { NS: string[] } | // numberset
  { BS: string[] }; // binaryset (base64)

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
  UnprocessedKeys: Record<string, {
    Keys: DDBItem[];
  }>;
}

interface DDBBatchWriteResponse extends DDBResponse {
  UnprocessedItems: Record<string, {
    DeleteRequest?: {
      Key: DDBItem;
    };
    PutRequest?: {
      Item: DDBItem;
    };
  }[]>;
}

interface DDBListTablesResponse extends DDBResponse {
  TableNames: string[];
  LastEvaluatedTableName?: string;
}

interface DDBScanResponse extends DDBResponse {
  Items: DDBItem[];
  LastEvaluatedKey?: DDBItem;
}

interface DDBProvisionedThroughput {
  ReadCapacityUnits: number;
  WriteCapacityUnits: number;
}

interface DDBGlobalSecondaryIndex {
  Backfilling?: boolean;
  IndexName: string;
  IndexStatus?: string;
  KeySchema: {
    AttributeName: string;
    KeyType: DDBKeyType;
  }[];
  Projection?: {
    NonKeyAttributes?: string[];
    ProjectionType: string;
  };
  ProvisionedThroughput?: DDBProvisionedThroughput;
}

interface DDBAttributeDefinition {
  AttributeName: string;
  AttributeType: string;
}

interface DDBDescribeResponse extends DDBResponse {
  Table: {
    AttributeDefinitions: DDBAttributeDefinition[];
    GlobalSecondaryIndexes?: DDBGlobalSecondaryIndex[];
    ItemCount: number;
    KeySchema: {
      AttributeName: string;
      KeyType: DDBKeyType;
    }[];
    TableStatus: string;
  };
}

export interface KeyDefinition {
  attributeName: string;
  attributeType: DDBType;
  keyType: DDBKeyType;
}

export interface GlobalSecondaryIndexDefinition {
  indexName: string;
  keySchema: KeyDefinition[];
  projectionType?: 'KEYS_ONLY' | 'INCLUDE' | 'ALL';
  nonKeyAttributes?: string[];
}

const AWS_URL_FORMAT = /^([^:]*):\/\/dynamodb\.([^.]+)\.amazonaws\.com(\/?.*)$/;

function ifNotEmpty<T extends any[] | string>(l: T): T | undefined {
  return l.length ? l : undefined;
}

function flatten(value: DDBItem, keys: string[]): string {
  return keys.map((key) => JSON.stringify(value[key])).join('');
}

interface ExpressionDefinition {
  attributeExpression: (attr: string, value: string) => string;
  joiner: string | ((items: string[]) => string);
  attributes: Readonly<DDBItem | string[] | undefined>;
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

  Object.keys(expressions).forEach((key) => {
    const { attributeExpression, joiner, attributes } = expressions[key];
    if (!attributes) {
      return;
    }

    const parts: string[] = [];
    const hasValues = !Array.isArray(attributes);
    const rawAttrNames = Array.isArray(attributes) ? attributes : Object.keys(attributes);
    if (!rawAttrNames.length) {
      return;
    }

    rawAttrNames.forEach((attr) => {
      const attrName = `#${i}`;
      const attrValue = `:${i}`;
      parts.push(attributeExpression(attrName, attrValue));
      attrNames[attrName] = attr;
      if (hasValues) {
        attrValues[attrValue] = (attributes as DDBItem)[attr];
      }
      i += 1;
    });
    result[key] = typeof joiner === 'string' ? parts.join(joiner) : joiner(parts);
    hasAnyValues = hasAnyValues || hasValues;
    hasExpr = true;
  });

  if (!hasExpr) {
    return {};
  }

  return {
    ...result,
    ExpressionAttributeValues: hasAnyValues ? attrValues : undefined,
    ExpressionAttributeNames: attrNames,
  };
}

const INVALID_NAME_CHARS = /[^-a-zA-Z0-9_.]/g;

export function escapeName(name: string): string {
  // no standard escape scheme conforms to DDB restrictions, so this is home-grown:
  // (does not attempt to ensure no collisions; more important to allow valid
  // names through unchanged)
  return name.replace(INVALID_NAME_CHARS, (c) => {
    const code = c.charCodeAt(0);
    const hex = code.toString(16);
    if (hex.length <= 2) {
      return `_u${hex.padStart(2, '0')}`;
    }
    return `_U${hex.padStart(4, '0')}`;
  }).padEnd(3, '_');
}

interface DDBOptions {
  consistentRead?: boolean;
}

function createAttributeDefinitions(
  schemas: KeyDefinition[][],
): DDBAttributeDefinition[] {
  const attrs = new Map<string, DDBType>();
  schemas.forEach((keys) => keys.forEach(({ attributeName, attributeType }) => {
    if (!attrs.has(attributeName)) {
      attrs.set(attributeName, attributeType);
    } else if (attrs.get(attributeName) !== attributeType) {
      throw new Error(`inconsistent attribute type for ${attributeName}`);
    }
  }));
  return [...attrs.entries()].map(([attributeName, attributeType]) => ({
    AttributeName: attributeName,
    AttributeType: attributeType,
  }));
}

function createSecondaryIndex(
  i: GlobalSecondaryIndexDefinition,
  throughput: DDBProvisionedThroughput | undefined,
): DDBGlobalSecondaryIndex {
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
    ProvisionedThroughput: throughput,
  };
}

function indicesMatch(
  a: GlobalSecondaryIndexDefinition,
  b: DDBGlobalSecondaryIndex,
): boolean {
  if (a.keySchema.length !== b.KeySchema.length) {
    return false;
  }
  return a.keySchema.every((k, i) => (
    k.attributeName === b.KeySchema[i].AttributeName &&
    k.keyType === b.KeySchema[i].KeyType
  ));
}

export class DDB {
  private readonly region: string;

  private readonly consistentRead: boolean;

  private totalCapacityUnits = 0;

  constructor(
    private readonly aws: AWS,
    private readonly host: string,
    {
      consistentRead = false,
    }: DDBOptions = {},
  ) {
    const parts = AWS_URL_FORMAT.exec(host);
    if (parts) {
      [, this.region] = parts;
    } else {
      this.region = 'us-east-1'; // default region for API calls
    }
    this.consistentRead = consistentRead;
  }

  getConsumedUnits(): number {
    return this.totalCapacityUnits;
  }

  getTableNames(): Results<string> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_ListTables.html
    return new Paged(this.aws, async (lastTableName) => {
      const response: DDBListTablesResponse = await this.call('ListTables', {
        ExclusiveStartTableName: lastTableName,
      });
      return [response.TableNames, response.LastEvaluatedTableName];
    }, 10);
  }

  upsertTable(
    tableName: string,
    pKeySchema: KeyDefinition[],
    secondaryIndices: GlobalSecondaryIndexDefinition[] = [],
    waitForReady: boolean,
    throughput?: DDBProvisionedThroughput,
    indexThroughput?: DDBProvisionedThroughput,
  ): Promise<boolean> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
    return this.aws.do(async () => {
      let created = false;
      try {
        await this.call('CreateTable', {
          TableName: tableName,
          AttributeDefinitions: createAttributeDefinitions([
            pKeySchema,
            ...secondaryIndices.map(({ keySchema }) => keySchema),
          ]),
          KeySchema: pKeySchema.map(({ attributeName, keyType }) => ({
            AttributeName: attributeName,
            KeyType: keyType,
          })),
          GlobalSecondaryIndexes: ifNotEmpty(secondaryIndices.map(
            (i) => createSecondaryIndex(i, indexThroughput || throughput),
          )),
          BillingMode: throughput ? 'PROVISIONED' : 'PAY_PER_REQUEST',
          ProvisionedThroughput: throughput,
        });
        created = true;
      } catch (e) {
        if (e instanceof DDBError && e.isType(DDBError.ResourceInUseException)) {
          await this.replaceIndices(tableName, secondaryIndices, indexThroughput || throughput);
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
    return this.call('DescribeTable', { TableName: tableName });
  }

  waitForTable(tableName: string, waitForIndices: boolean): Promise<void> {
    return this.aws.do(() => retry(
      (e) => (
        (e instanceof DDBError && e.isType(DDBError.ResourceNotFoundException)) ||
        e.message === 'pending'
      ),
      {
        timeoutMillis: 60000,
        maxDelayMillis: 1000,
        jitter: false,
      },
    )(async () => {
      const desc = await this.describeTable(tableName);
      if (desc.Table.TableStatus !== 'ACTIVE') {
        throw new Error('pending');
      }
      const indices = desc.Table.GlobalSecondaryIndexes;
      if (waitForIndices && indices && indices.some((i) => (i.IndexStatus !== 'ACTIVE'))) {
        throw new Error('pending');
      }
    }));
  }

  async deleteTable(tableName: string): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteTable.html
    await this.call('DeleteTable', { TableName: tableName });
  }

  async putItem(tableName: string, item: DDBItem, unique?: string): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
    await this.call('PutItem', {
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
    condition?: DDBItem,
  ): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html
    await this.call('UpdateItem', {
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
          attributes: condition,
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
    });
  }

  async getItem(
    tableName: string,
    key: DDBItem,
    requestedAttrs?: readonly string[],
  ): Promise<DDBItem | null> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
    const data: DDBGetResponse = await this.call('GetItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        ProjectionExpression: {
          attributeExpression: (attr): string => attr,
          joiner: ',',
          attributes: requestedAttrs,
        },
      }),
      ConsistentRead: this.consistentRead,
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
    requestedAttrs?: readonly string[],
  ): Promise<(DDBItem | null)[]> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
    if (!keys.length) {
      return [];
    }
    if (keys.length === 1) {
      return [await this.getItem(tableName, keys[0], requestedAttrs)];
    }

    const keyAttrs = Object.keys(keys[0]);
    const fullAttrs = requestedAttrs?.slice();
    if (fullAttrs) {
      keyAttrs.forEach((k) => {
        if (!fullAttrs.includes(k)) {
          fullAttrs.push(k);
        }
      });
    }

    const indices = new Map<string, number>();
    keys.forEach((key, i) => indices.set(flatten(key, keyAttrs), i));

    const extracted: (DDBItem | null)[] = keys.map(() => null);
    const tableQuery = {
      ...escapedExpressions({
        ProjectionExpression: {
          attributeExpression: (attr): string => attr,
          joiner: ',',
          attributes: fullAttrs,
        },
      }),
      ConsistentRead: this.consistentRead,
    };

    await this.callBatched(keys, 100, async (batchKeys) => {
      const data: DDBBatchGetResponse = await this.call('BatchGetItem', {
        RequestItems: {
          [tableName]: {
            ...tableQuery,
            Keys: batchKeys,
          },
        },
        ReturnConsumedCapacity: 'TOTAL',
      });
      data.Responses[tableName].forEach((item) => {
        const index = indices.get(flatten(item, keyAttrs));
        if (index !== undefined) {
          extracted[index] = item;
        }
      });
      return data.UnprocessedKeys[tableName]?.Keys || [];
    });

    return extracted;
  }

  batchPutItems(tableName: string, items: DDBItem[]): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    return this.callBatched(items, 25, async (batchItems) => {
      const data: DDBBatchWriteResponse = await this.call('BatchWriteItem', {
        RequestItems: {
          [tableName]: batchItems.map((item) => ({ PutRequest: { Item: item } })),
        },
        ReturnConsumedCapacity: 'TOTAL',
      });
      return (data.UnprocessedItems[tableName] || []).map((i) => i.PutRequest!.Item);
    });
  }

  batchDeleteItems(tableName: string, keys: DDBItem[]): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
    return this.callBatched(keys, 25, async (batchKeys) => {
      const data: DDBBatchWriteResponse = await this.call('BatchWriteItem', {
        RequestItems: {
          [tableName]: batchKeys.map((key) => ({ DeleteRequest: { Key: key } })),
        },
        ReturnConsumedCapacity: 'TOTAL',
      });
      return (data.UnprocessedItems[tableName] || []).map((i) => i.DeleteRequest!.Key);
    });
  }

  getAllItems(tableName: string, requestedAttrs?: readonly string[]): Results<DDBItem> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
    const query = {
      TableName: tableName,
      ...escapedExpressions({
        ProjectionExpression: {
          attributeExpression: (attr): string => attr,
          joiner: ',',
          attributes: requestedAttrs,
        },
      }),
      ConsistentRead: this.consistentRead,
      ReturnConsumedCapacity: 'TOTAL',
    };
    return new Paged(this.aws, async (lastKey) => {
      const response: DDBScanResponse = await this.call('Scan', {
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
    (requestedAttrs || []).forEach((attr) => {
      if (attr !== 'id') {
        if (Object.hasOwnProperty.call(key, attr)) {
          colocatedAttrs.push(attr);
        } else {
          nonColocatedAttrs.push(attr);
        }
      }
    });
    const query = {
      TableName: tableName,
      IndexName: indexName,
      ...escapedExpressions({
        KeyConditionExpression: {
          attributeExpression: (attr, value): string => `${attr}=${value}`,
          joiner: ' and ',
          attributes: key,
        },
        ProjectionExpression: {
          attributeExpression: (attr): string => attr,
          joiner: ',',
          attributes: colocatedAttrs,
        },
      }),
      ConsistentRead: false, // cannot be true for Global Secondary Index
      ReturnConsumedCapacity: 'TOTAL',
    };
    let items: DDBItem[];
    if (limitOne) {
      const response: DDBScanResponse = await this.call('Query', {
        ...query,
        Limit: 1,
      });
      items = response.Items;
    } else {
      items = await new Paged(this.aws, async (lastKey) => {
        const response: DDBScanResponse = await this.call('Query', {
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
      items.map(({ id }) => ({ id })),
      ifNotEmpty(nonColocatedAttrs),
    );
    return items
      .map((item, i) => (pkItems[i] ? ({ ...item, ...pkItems[i] }) : null))
      .filter((item) => item) as DDBItem[];
  }

  async deleteItem(tableName: string, key: DDBItem): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
    await this.call('DeleteItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        ConditionExpression: {
          attributeExpression: (attr): string => `attribute_exists(${attr})`,
          joiner: ' and ',
          attributes: [Object.keys(key)[0]],
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
    });
  }

  async deleteAndReturnItem(tableName: string, key: DDBItem): Promise<DDBItem> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
    const response: DDBReturnedItem = await this.call('DeleteItem', {
      TableName: tableName,
      Key: key,
      ...escapedExpressions({
        ConditionExpression: {
          attributeExpression: (attr): string => `attribute_exists(${attr})`,
          joiner: ' and ',
          attributes: [Object.keys(key)[0]],
        },
      }),
      ReturnConsumedCapacity: 'TOTAL',
      ReturnValues: 'ALL_OLD',
    });
    return response.Attributes;
  }

  private async replaceIndices(
    tableName: string,
    secondaryIndices: GlobalSecondaryIndexDefinition[] = [],
    throughput: DDBProvisionedThroughput | undefined,
  ): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTable.html
    const existing = await this.describeTable(tableName);
    const indices = new Map<string, DDBGlobalSecondaryIndex>();
    const toCreate: GlobalSecondaryIndexDefinition[] = [];
    const oldIndices = existing.Table.GlobalSecondaryIndexes || [];
    for (let i = 0; i < oldIndices.length; i += 1) {
      const idx = oldIndices[i];
      indices.set(idx.IndexName, idx);
    }
    for (let i = 0; i < secondaryIndices.length; i += 1) {
      const idx = secondaryIndices[i];
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
    /* eslint-disable no-await-in-loop */ // index creation and deletion must be serial
    for (let i = 0; i < toDelete.length; i += 1) {
      await this.call('UpdateTable', {
        TableName: tableName,
        GlobalSecondaryIndexUpdates: [{
          Delete: { IndexName: toDelete[i] },
        }],
      });
      // must wait for table to be ACTIVE before next update can be applied
      await this.waitForTable(tableName, false);
    }
    for (let i = 0; i < toCreate.length; i += 1) {
      await this.call('UpdateTable', {
        TableName: tableName,
        AttributeDefinitions: createAttributeDefinitions([toCreate[i].keySchema]),
        GlobalSecondaryIndexUpdates: [{
          Create: createSecondaryIndex(toCreate[i], throughput),
        }],
      });
      // must wait for table to be ACTIVE before next update can be applied
      await this.waitForTable(tableName, false);
    }
    /* eslint-enable no-await-in-loop */
  }

  private callBatched<T>(
    items: T[],
    batchLimit: number,
    fn: (batchItems: T[]) => Promise<T[]>,
  ): Promise<void> {
    return this.aws.do(async () => {
      const queue = [...items];
      for (let batchPos = 0; batchPos < queue.length;) {
        const batchItems = queue.slice(batchPos, batchPos + batchLimit);
        batchPos += batchItems.length;

        /* eslint-disable-next-line no-await-in-loop */ // no benefit from parallelism
        const retryItems = await fn(batchItems);
        queue.push(...retryItems); // TODO: add delays for retrying items
      }
    });
  }

  private async call<T extends DDBResponse = DDBResponse>(
    fnName: string,
    body?: string | object | Buffer,
  ): Promise<T> {
    const response = await this.aws.request({
      method: 'POST',
      url: this.host,
      region: this.region,
      service: 'dynamodb',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `DynamoDB_20120810.${fnName}`,
      },
      body,
    });
    const data = JSON.parse(response.text) as T & AWSErrorResponse;
    if (response.status >= 300) {
      // DynamoDB does not include read/write capacity usage for errors, though
      // they can consume capacity.
      // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.ConditionalWrites.ReturnConsumedCapacity

      /* eslint-disable-next-line no-underscore-dangle */ // part of API
      throw new DDBError(response.status, data.__type, data.message);
    }
    if (data.ConsumedCapacity) {
      let capacity;
      if (Array.isArray(data.ConsumedCapacity)) {
        capacity = data.ConsumedCapacity.reduce((t, c) => (t + Number(c.CapacityUnits)), 0);
      } else {
        capacity = Number(data.ConsumedCapacity.CapacityUnits);
      }
      this.totalCapacityUnits += capacity;
    }
    return data;
  }
}
