import type { Collection, UpdateOptions, Indices } from './Collection';
import type { IDable } from './IDable';
import type { DBKeys } from './DB';
export default abstract class BaseCollection<T extends IDable> implements Collection<T> {
    readonly indices: Readonly<Indices<T>>;
    protected internalReady?: () => Promise<void>;
    private innerPreAct;
    protected constructor(keys: DBKeys<T>);
    add(entry: T): Promise<void>;
    get<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    update<K extends string & keyof T>(searchAttribute: K, searchValue: T[K], update: Partial<T>, options?: UpdateOptions): Promise<void>;
    remove<K extends string & keyof T>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    protected initAsync(wait: Promise<unknown>): Promise<void>;
    protected preAct(): Promise<void> | void;
    protected internalGet<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalUpsert(id: T['id'], update: Partial<T>, options: UpdateOptions): Promise<void>;
    protected abstract internalAdd(entry: T): Promise<void>;
    protected abstract internalGetAll<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute?: K, searchValue?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected abstract internalUpdate<K extends string & keyof T>(searchAttribute: K, searchValue: T[K], update: Partial<T>, options: UpdateOptions): Promise<void>;
    protected abstract internalRemove<K extends string & keyof T>(searchAttribute: K, searchValue: T[K]): Promise<number>;
}
//# sourceMappingURL=BaseCollection.d.ts.map