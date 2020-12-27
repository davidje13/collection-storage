import type { Pool as PgPoolT } from 'pg';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
export default class PostgresCollection<T extends IDable> extends BaseCollection<T> {
    private readonly pool;
    private readonly tableName;
    private readonly stateRef;
    private readonly cachedQueries;
    constructor(pool: PgPoolT, tableName: string, keys?: DBKeys<T>, stateRef?: StateRef);
    protected internalAdd(item: T): Promise<void>;
    protected internalUpsert(id: T['id'], update: Partial<T>): Promise<void>;
    protected internalUpdate<K extends string & keyof T>(searchAttribute: K, searchValue: T[K], item: Partial<T>): Promise<void>;
    protected internalGet<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalGetAll<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends string & keyof T>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    private runTableQuery;
}
//# sourceMappingURL=PostgresCollection.d.ts.map