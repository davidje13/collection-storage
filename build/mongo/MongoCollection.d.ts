import { Collection as MCollection } from 'mongodb';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
export default class MongoCollection<T extends IDable> extends BaseCollection<T> {
    private readonly collection;
    private readonly stateRef;
    constructor(collection: MCollection, keys?: DBKeys<T>, stateRef?: StateRef);
    protected preAct(): void;
    protected internalAdd(value: T): Promise<void>;
    protected internalUpsert(id: T['id'], update: Partial<T>): Promise<void>;
    protected internalUpdate<K extends string & keyof T>(searchAttribute: K, searchValue: T[K], update: Partial<T>): Promise<void>;
    protected internalGet<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalGetAll<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends string & keyof T>(searchAttribute: K, searchValue: T[K]): Promise<number>;
}
//# sourceMappingURL=MongoCollection.d.ts.map