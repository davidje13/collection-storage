import DynamoCollection, { Throughput } from './DynamoCollection';
import { DDB } from './api/DDB';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
export declare type DbThroughputFn = (tableName: string, indexName: string | null) => Throughput | null | undefined;
export default class DynamoDb extends BaseDB {
    private readonly aws;
    private readonly ddb;
    private constructor();
    static connect(url: string, throughputFn?: DbThroughputFn): DynamoDb;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): DynamoCollection<T>;
    getDDB(): DDB;
    protected internalClose(): Promise<void>;
}
//# sourceMappingURL=DynamoDb.d.ts.map