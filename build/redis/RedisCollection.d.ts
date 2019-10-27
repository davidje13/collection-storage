import IDable from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import { UpdateOptions } from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import RedisConnectionPool from './RedisConnectionPool';
export default class RedisCollection<T extends IDable> extends BaseCollection<T> {
    private readonly pool;
    private readonly prefix;
    private readonly keyPrefixes;
    private readonly uniqueKeys;
    private readonly nonUniqueKeys;
    constructor(pool: RedisConnectionPool, prefix: string, keys?: DBKeys<T>);
    protected internalAdd(value: T): Promise<void>;
    protected internalUpdate<K extends keyof T & string>(searchAttribute: K, searchValue: T[K], update: Partial<T>, { upsert }: UpdateOptions): Promise<void>;
    protected internalGet<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalGetAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends keyof T & string>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    private makeKey;
    private runAdd;
    private getUpdatePatch;
    private runUpdates;
    private makeUpdateArgs;
    private getByKeysKeepWatches;
    private rawByKeyKeepWatches;
    private getAndWatchBySerialisedKey;
}
//# sourceMappingURL=RedisCollection.d.ts.map