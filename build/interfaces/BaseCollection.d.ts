import type { Collection, UpdateOptions } from './Collection';
import type { IDable } from './IDable';
import type { DBKeys } from './DB';
export default abstract class BaseCollection<T extends IDable> implements Collection<T> {
    protected readonly keys: DBKeys<T>;
    protected internalReady?: () => Promise<void>;
    private innerPreAct;
    protected constructor(keys: DBKeys<T>);
    add(entry: T): Promise<void>;
    get<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    update<K extends keyof T & string>(searchAttribute: K, searchValue: T[K], update: Partial<T>, options?: UpdateOptions): Promise<void>;
    remove<K extends keyof T & string>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    protected initAsync(wait: Promise<unknown>): Promise<void>;
    protected isIndexed(attribute: string): boolean;
    protected isIndexUnique(attribute: string): boolean;
    protected preAct(): Promise<void> | void;
    protected internalGet<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute: K, searchValue: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    protected internalUpsert(id: T['id'], update: Partial<T>, options: UpdateOptions): Promise<void>;
    protected abstract internalAdd(entry: T): Promise<void>;
    protected abstract internalGetAll<K extends keyof T & string, F extends readonly (keyof T & string)[]>(searchAttribute?: K, searchValue?: T[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected abstract internalUpdate<K extends keyof T & string>(searchAttribute: K, searchValue: T[K], update: Partial<T>, options: UpdateOptions): Promise<void>;
    protected abstract internalRemove<K extends keyof T & string>(searchAttribute: K, searchValue: T[K]): Promise<number>;
}
//# sourceMappingURL=BaseCollection.d.ts.map