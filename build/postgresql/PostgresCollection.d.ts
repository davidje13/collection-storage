import IDable from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import { DBKeys } from '../interfaces/DB';
declare type PPool = import('pg').Pool;
interface State {
    closed: boolean;
}
export default class PostgresCollection<T extends IDable> extends BaseCollection<T> {
    private readonly pool;
    private readonly stateRef;
    private readonly tableName;
    private readonly cachedQueries;
    private pending?;
    constructor(pool: PPool, name: string, keys?: DBKeys<T>, stateRef?: State);
    protected preAct(): void;
    protected internalAdd({ id, ...rest }: T): Promise<void>;
    protected internalUpsert(id: T['id'], update: Partial<T>): Promise<void>;
    protected internalUpdate<K extends keyof T & string>(searchAttribute: K, searchValue: T[K], { id, ...rest }: Partial<T>): Promise<void>;
    protected internalGet<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalGetAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends keyof T & string>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    private runTableQuery;
}
export {};
//# sourceMappingURL=PostgresCollection.d.ts.map