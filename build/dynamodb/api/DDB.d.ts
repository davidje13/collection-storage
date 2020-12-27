import type AWS from './AWS';
import { Results } from './Results';
export declare type DDBValue = {
    S: string;
} | {
    N: string;
} | // number
{
    B: string;
} | // binary (base64)
{
    BOOL: boolean;
} | {
    NULL: true;
} | {
    M: Record<string, DDBValue>;
} | {
    L: DDBValue[];
} | {
    SS: string[];
} | // stringset
{
    NS: string[];
} | // numberset
{
    BS: string[];
};
export declare type DDBItem = Record<string, DDBValue>;
declare type DDBType = 'S' | 'N' | 'B' | 'BOOL' | 'NULL' | 'M' | 'L' | 'SS' | 'NS' | 'BS';
declare type DDBKeyType = 'HASH' | 'RANGE';
interface DDBConsumedCapacity {
    CapacityUnits: number;
}
interface DDBResponse {
    ConsumedCapacity?: DDBConsumedCapacity | DDBConsumedCapacity[];
}
export interface DDBProvisionedThroughput {
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
    projectionType?: 'KEYS_ONLY' | 'INCLUDE' | 'ALL';
    nonKeyAttributes?: string[];
    throughput?: DDBProvisionedThroughput;
}
export declare function escapeName(name: string): string;
interface DDBOptions {
    consistentRead?: boolean;
}
export declare class DDB {
    private readonly aws;
    private readonly host;
    private readonly region;
    private readonly consistentRead;
    private totalCapacityUnits;
    constructor(aws: AWS, host: string, { consistentRead }?: DDBOptions);
    getConsumedUnits(): number;
    getTableNames(): Results<string>;
    upsertTable(tableName: string, pKeySchema: KeyDefinition[], secondaryIndices: GlobalSecondaryIndexDefinition[] | undefined, waitForReady: boolean, throughput?: DDBProvisionedThroughput): Promise<boolean>;
    describeTable(tableName: string): Promise<DDBDescribeResponse>;
    waitForTable(tableName: string, waitForIndices: boolean): Promise<void>;
    deleteTable(tableName: string): Promise<void>;
    putItem(tableName: string, item: DDBItem, unique?: string): Promise<void>;
    updateItem(tableName: string, key: DDBItem, update: DDBItem, condition?: DDBItem): Promise<void>;
    getItem(tableName: string, key: DDBItem, requestedAttrs?: readonly string[]): Promise<DDBItem | null>;
    batchGetItems(tableName: string, keys: DDBItem[], requestedAttrs?: readonly string[]): Promise<(DDBItem | null)[]>;
    batchPutItems(tableName: string, items: DDBItem[]): Promise<void>;
    batchDeleteItems(tableName: string, keys: DDBItem[]): Promise<void>;
    getAllItems(tableName: string, requestedAttrs?: readonly string[]): Results<DDBItem>;
    getItemsBySecondaryKey(tableName: string, indexName: string, key: DDBItem, requestedAttrs: readonly string[] | undefined, limitOne: boolean): Promise<DDBItem[]>;
    deleteItem(tableName: string, key: DDBItem): Promise<void>;
    deleteAndReturnItem(tableName: string, key: DDBItem): Promise<DDBItem>;
    private callDelete;
    private replaceIndices;
    private callBatched;
    private call;
}
export {};
//# sourceMappingURL=DDB.d.ts.map