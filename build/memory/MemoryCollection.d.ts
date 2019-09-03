import Collection from '../interfaces/Collection';
import IDable from '../interfaces/IDable';
import { DBKeys } from '../interfaces/DB';
export default class MemoryCollection<T extends IDable> implements Collection<T> {
    private readonly simulatedLatency;
    private readonly data;
    private readonly keys;
    constructor(keys?: DBKeys<T>, simulatedLatency?: number);
    add(value: T): Promise<void>;
    update<K extends keyof T & string>(keyName: K, key: T[K], value: Partial<T>, { upsert }?: {
        upsert?: boolean | undefined;
    }): Promise<void>;
    get<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName: K, key: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName?: K, key?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    remove<K extends keyof T & string>(key: K, value: T[K]): Promise<number>;
    private internalGetSerialisedIds;
    private internalCheckDuplicates;
    private internalPopulateIndices;
    private internalRemoveIndices;
}
