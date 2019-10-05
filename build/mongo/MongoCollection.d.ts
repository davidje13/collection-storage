import { Collection as MCollection } from 'mongodb';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
interface State {
    closed: boolean;
}
export default class MongoCollection<T extends IDable> implements Collection<T> {
    private readonly collection;
    private readonly stateRef;
    constructor(collection: MCollection, keys?: DBKeys<T>, stateRef?: State);
    add(value: T): Promise<void>;
    update<K extends keyof T & string>(keyName: K, key: T[K], value: Partial<T>, { upsert }?: {
        upsert?: boolean | undefined;
    }): Promise<void>;
    get<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName: K, key: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(keyName?: K, key?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    remove<K extends keyof T & string>(key: K, value: T[K]): Promise<number>;
    private getCollection;
}
export {};
