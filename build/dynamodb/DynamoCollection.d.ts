import { DDB } from './api/DDB';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
export interface Throughput {
    read: number;
    write: number;
}
declare type CollectionThroughputFn = (indexName: string | null) => Throughput | null | undefined;
export default class DynamoCollection<T extends IDable> extends BaseCollection<T> {
    private readonly ddb;
    private readonly tableName;
    private readonly uniqueKeys;
    constructor(ddb: DDB, tableName: string, keys?: DBKeys<T>, throughputFn?: CollectionThroughputFn);
    get internalTableName(): string;
    get internalIndexTableName(): string;
    protected internalAdd(value: T): Promise<void>;
    protected internalUpsert(id: T['id'], update: Partial<T>): Promise<void>;
    protected internalUpdate<K extends keyof T & string>(searchAttribute: K, searchValue: T[K], { id: _, ...update }: Partial<T>): Promise<void>;
    protected internalGet<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalGetAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends keyof T & string>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    private atomicPutUniques;
    private putItem;
    private updateItem;
    private deleteItem;
}
export {};
//# sourceMappingURL=DynamoCollection.d.ts.map