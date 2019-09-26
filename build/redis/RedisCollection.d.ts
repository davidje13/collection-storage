import { Redis } from 'ioredis';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
export default class RedisCollection<T extends IDable> implements Collection<T> {
    private readonly client;
    private readonly prefix;
    private readonly keyPrefixes;
    private readonly keys;
    private readonly uniqueKeys;
    constructor(client: Redis, prefix: string, keys?: DBKeys<T>);
    add(value: T): Promise<void>;
    update<K extends keyof T & string>(keyName: K, key: T[K], value: Partial<T>, { upsert }?: {
        upsert?: boolean | undefined;
    }): Promise<void>;
    get<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName: K, key: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName?: K, key?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    remove<K extends keyof T & string>(key: K, value: T[K]): Promise<number>;
    private makeKey;
    private setByKey;
    private getByKey;
    private readByKey;
    private readByKeys;
    private internalGetPossibleSerialisedIds;
    private internalCheckKeyDuplicates;
    private internalMigrateIndices;
    private runMulti;
}
