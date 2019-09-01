import { Collection as MCollection } from 'mongodb';
import IDable from '../IDable';
import Collection from '../Collection';
import { DBKeys } from '../DB';
export default class MongoCollection<T extends IDable> implements Collection<T> {
    private readonly collection;
    constructor(collection: MCollection, keys?: DBKeys<T>);
    add(value: T): Promise<void>;
    update<K extends keyof T & string>(keyName: K, key: T[K], value: Partial<T>, { upsert }?: {
        upsert?: boolean | undefined;
    }): Promise<void>;
    get<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName: K, key: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName?: K, key?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
}
