import type { Collection, UpdateOptions, Indices } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
export declare type Wrapped<T extends IDable, Fields extends keyof T, FieldStorage> = {
    [K in keyof T]: K extends 'id' ? T[K] : K extends Fields ? FieldStorage : T[K];
};
export interface Wrapper<T extends IDable, K extends keyof T, FieldStorage, CustomData> {
    wrap: (key: K, value: T[K], processed: CustomData) => Promise<FieldStorage> | FieldStorage;
    unwrap: (key: K, value: FieldStorage, processed: CustomData) => Promise<T[K]> | T[K];
    preWrap?: (record: Readonly<Partial<T>>) => Promise<CustomData> | CustomData;
    preUnwrap?: (record: Readonly<Partial<Wrapped<T, K, FieldStorage>>>) => Promise<CustomData> | CustomData;
    preRemove?: (record: Readonly<Pick<Wrapped<T, K, FieldStorage>, 'id'>>) => Promise<void> | void;
}
export default class WrappedCollection<T extends IDable, WF extends readonly (keyof Omit<T, 'id'> & string)[], FieldStorage, E, Inner extends Wrapped<T, WF[-1], FieldStorage> = Wrapped<T, WF[-1], FieldStorage>> implements Collection<T> {
    private readonly baseCollection;
    private readonly fields;
    private readonly wrapper;
    constructor(baseCollection: Collection<Inner>, fields: WF, wrapper: Wrapper<T, WF[-1], FieldStorage, E>);
    add(entry: T): Promise<void>;
    get<K extends keyof T & keyof Inner & string, F extends readonly (string & keyof T)[]>(key: K, value: T[K] & Inner[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & keyof Inner & string, F extends readonly (string & keyof T)[]>(key?: K, value?: T[K] & Inner[NonNullable<K>], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    update<K extends keyof T & keyof Inner & string>(key: K, value: T[K] & Inner[K], update: Partial<T>, options?: UpdateOptions): Promise<void>;
    remove<K extends string & keyof T>(key: K, value: T[K] & Inner[K]): Promise<number>;
    get indices(): Indices<T>;
    private wrapAll;
    private unwrapAll;
}
//# sourceMappingURL=WrappedCollection.d.ts.map