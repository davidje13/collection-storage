import type AWS from './AWS';
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

export type TransactWrite = {
  type: 'put';
  tableName: string;
  item: DDBItem;
  unique?: string;
} | {
  type: 'update';
  tableName: string;
  key: DDBItem;
  update: DDBItem;
  condition?: DDBItem;
};

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

interface DDBListTablesResponse extends DDBResponse {
  TableNames: string[];
  LastEvaluatedTableName?: string;
}

interface DDBScanResponse extends DDBResponse {
  Items: DDBItem[];
  LastEvaluatedKey?: DDBItem;
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

function conditionalCheckStatus(fn: () => Promise<unknown>): Promise<boolean> {
  return fn().then(() => true).catch((e) => {
    // TODO: do this without searching for a string in the error message
    if (e.message.includes('ConditionalCheckFailedException')) {
      return false;
    }
    throw e;
  });
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

async function getAllPaged<K, I>(
  fn: (start: K | undefined) => Promise<[I[], K]>,
  pageLimit = Number.POSITIVE_INFINITY,
): Promise<I[]> {
  const items: I[] = [];
  let lastKey: K | undefined;
  for (let page = 0; page < pageLimit; page += 1) {
    /* eslint-disable-next-line no-await-in-loop */ // pagination must be serial
    const [pageItems, nextKey]: [I[], K] = await fn(lastKey);
    items.push(...pageItems);
    lastKey = nextKey;
    if (!lastKey) {
      return items;
    }
  }
  throw new Error('Too many items');
}

interface DDBOptions {
  consistentRead?: boolean;
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

  getTableNames(): Promise<string[]> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_ListTables.html
    return this.aws.do(() => getAllPaged(async (lastTableName) => {
      const response: DDBListTablesResponse = await this.call('ListTables', {
        ExclusiveStartTableName: lastTableName,
      });
      return [response.TableNames, response.LastEvaluatedTableName];
    }, 10));
  }

  // TODO:
  // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTable.html for checking if table already exists, or indices need changing
  // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTable.html for changing indices
  createTable(
    tableName: string,
    pKeySchema: KeyDefinition[],
    secondaryIndices: GlobalSecondaryIndexDefinition[] = [],
    waitForReady: boolean,
  ): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
    const attrs = new Map<string, DDBType>();
    const allKeySchemas = [pKeySchema, ...secondaryIndices.map(({ keySchema }) => keySchema)];
    allKeySchemas.forEach((keys) => keys.forEach(({ attributeName, attributeType }) => {
      if (!attrs.has(attributeName)) {
        attrs.set(attributeName, attributeType);
      } else if (attrs.get(attributeName) !== attributeType) {
        throw new Error(`inconsistent attribute type for ${attributeName}`);
      }
    }));

    return this.aws.do(async () => {
      try {
        await this.call('CreateTable', {
          TableName: tableName,
          AttributeDefinitions: [...attrs.entries()].map(([attributeName, attributeType]) => ({
            AttributeName: attributeName,
            AttributeType: attributeType,
          })),
          KeySchema: pKeySchema.map(({ attributeName, keyType }) => ({
            AttributeName: attributeName,
            KeyType: keyType,
          })),
          GlobalSecondaryIndexes: ifNotEmpty(secondaryIndices.map((i) => ({
            IndexName: i.indexName,
            KeySchema: i.keySchema.map(({ attributeName, keyType }) => ({
              AttributeName: attributeName,
              KeyType: keyType,
            })),
            Projection: {
              ProjectionType: i.projectionType || (i.nonKeyAttributes ? 'INCLUDE' : 'KEYS_ONLY'),
              NonKeyAttributes: i.nonKeyAttributes,
            },
            // ProvisionedThroughput: {
            //   ReadCapacityUnits: 1, // TODO: make configurable - only applies if PROVISIONED
            //   WriteCapacityUnits: 1,
            // },
          }))),
          BillingMode: 'PAY_PER_REQUEST', // TODO: make configurable (PROVISIONED)
          // ProvisionedThroughput: {
          //   ReadCapacityUnits: 1, // TODO: make configurable - only applies if PROVISIONED
          //   WriteCapacityUnits: 1,
          // },
        });
      } catch (e) {
        if (e.message.includes('ResourceInUseException')) {
          // ignore (table already exists) - TODO: update indices if needed
        } else {
          throw e;
        }
      }

      if (waitForReady) {
        await this.waitForTable(tableName);
      }
    });
  }

  async waitForTable(tableName: string): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTable.html
    await this.aws.do(() => retry(
      (e) => e.message.includes('ResourceNotFoundException'),
      {
        timeoutMillis: 60000,
        maxDelayMillis: 1000,
        jitter: false,
      },
    )(() => this.call('DescribeTable', { TableName: tableName })));
  }

  async deleteTable(tableName: string): Promise<void> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteTable.html
    await this.call('DeleteTable', { TableName: tableName });
  }

  putItem(tableName: string, item: DDBItem, unique?: string): Promise<boolean> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
    return conditionalCheckStatus(() => this.call('PutItem', {
      TableName: tableName,
      Item: item,
      ConditionExpression: unique ? `attribute_not_exists(${unique})` : undefined,
      ReturnConsumedCapacity: 'TOTAL',
    }));
  }

  updateItem(
    tableName: string,
    key: DDBItem,
    update: DDBItem,
    condition?: DDBItem,
  ): Promise<boolean> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html
    return conditionalCheckStatus(() => this.call('UpdateItem', {
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
    }));
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

    const batchSize = 100;
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
    for (let batchPos = 0; batchPos < keys.length; batchPos += batchSize) {
      const currentKeys = keys.slice(batchPos, batchPos + batchSize);
      /* eslint-disable-next-line no-await-in-loop */ // pagination must be serial
      const data: DDBBatchGetResponse = await this.call('BatchGetItem', {
        RequestItems: {
          [tableName]: {
            ...tableQuery,
            Keys: currentKeys,
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
      // TODO: handle UnprocessedKeys
    }

    return extracted;
  }

  getAllItems(tableName: string, requestedAttrs?: readonly string[]): Promise<DDBItem[]> {
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
    return this.aws.do(() => getAllPaged(async (lastKey) => {
      const response: DDBScanResponse = await this.call('Scan', {
        ...query,
        ExclusiveStartKey: lastKey,
      });
      return [response.Items, response.LastEvaluatedKey];
    }));
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
      items = await this.aws.do(() => getAllPaged(async (lastKey) => {
        const response: DDBScanResponse = await this.call('Query', {
          ...query,
          ExclusiveStartKey: lastKey,
        });
        return [response.Items, response.LastEvaluatedKey];
      }));
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

  deleteItem(tableName: string, key: DDBItem): Promise<boolean> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
    return conditionalCheckStatus(() => this.call('DeleteItem', {
      TableName: tableName,
      Key: key,
      ConditionExpression: `attribute_exists(${Object.keys(key)[0]})`,
      ReturnConsumedCapacity: 'TOTAL',
    }));
  }

  async deleteAndReturnItem(tableName: string, key: DDBItem): Promise<DDBItem | null> {
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
    try {
      const response: DDBReturnedItem = await this.call('DeleteItem', {
        TableName: tableName,
        Key: key,
        ConditionExpression: `attribute_exists(${Object.keys(key)[0]})`,
        ReturnConsumedCapacity: 'TOTAL',
        ReturnValues: 'ALL_OLD',
      });
      return response.Attributes;
    } catch (e) {
      if (e.message.includes('ConditionalCheckFailedException')) {
        return null;
      }
      throw e;
    }
  }

  transactWriteItems(spec: TransactWrite[]): Promise<boolean> {
    return conditionalCheckStatus(() => this.call('TransactWriteItems', {
      TransactItems: spec.map((s) => {
        switch (s.type) {
          case 'put':
            return {
              Put: {
                TableName: s.tableName,
                Item: s.item,
                ConditionExpression: s.unique ? `attribute_not_exists(${s.unique})` : undefined,
              },
            };
          case 'update':
            return {
              Update: {
                TableName: s.tableName,
                Key: s.key,
                ...escapedExpressions({
                  UpdateExpression: {
                    attributeExpression: (attr, value): string => `${attr}=${value}`,
                    joiner: (l): string => `SET ${l.join(',')}`,
                    attributes: s.update,
                  },
                  ConditionExpression: {
                    attributeExpression: (attr, value): string => `${attr}=${value}`,
                    joiner: ' and ',
                    attributes: s.condition,
                  },
                }),
              },
            };
          default:
            throw new Error('unknown transaction type');
        }
      }),
      ReturnConsumedCapacity: 'TOTAL',
    }));
  }

  private async call<T extends DDBResponse = DDBResponse>(
    fnName: string,
    body?: string | object | Buffer,
  ): Promise<T> {
    const response = await this.aws.request<T>({
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
    if (response.ConsumedCapacity) {
      let capacity;
      if (Array.isArray(response.ConsumedCapacity)) {
        capacity = response.ConsumedCapacity.reduce((t, c) => (t + c.CapacityUnits), 0);
      } else {
        capacity = response.ConsumedCapacity.CapacityUnits;
      }
      this.totalCapacityUnits += capacity;
    }
    return response;
  }
}
