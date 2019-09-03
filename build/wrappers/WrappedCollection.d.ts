import IDable from '../interfaces/IDable';
import Collection, { UpdateOptions } from '../interfaces/Collection';
export declare type Wrapped<T extends IDable, WF extends keyof T, W> = {
    [K in keyof T]: K extends 'id' ? T[K] : K extends WF ? W : T[K];
};
export interface Wrapper<T extends IDable, K extends keyof T, W, E> {
    wrap: (key: K, value: T[K], processed: E) => Promise<W> | W;
    unwrap: (key: K, value: W, processed: E) => Promise<T[K]> | T[K];
    preWrap?: (record: Readonly<Partial<T>>) => Promise<E> | E;
    preUnwrap?: (record: Readonly<Partial<Wrapped<T, K, W>>>) => Promise<E> | E;
    preRemove?: (record: Readonly<Pick<Wrapped<T, K, W>, 'id'>>) => Promise<void> | void;
}
export default class WrappedCollection<T extends IDable, WF extends readonly (keyof Omit<T, 'id'> & string)[], W, E, Inner extends Wrapped<T, WF[-1], W> = Wrapped<T, WF[-1], W>> implements Collection<T> {
    private readonly baseCollection;
    private readonly fields;
    private readonly wrapper;
    constructor(baseCollection: Collection<Inner>, fields: WF, wrapper: Wrapper<T, WF[-1], W, E>);
    add(entry: T): Promise<void>;
    get<K extends keyof T & keyof Inner & string, F extends readonly (keyof T & string)[]>(key: K, value: T[K] & Inner[K], fields?: F): Promise<Readonly<Pick<T, F[-1]>> | null>;
    getAll<K extends keyof T & keyof Inner & string, F extends readonly (keyof T & string)[]>(key?: K, value?: T[K] & Inner[NonNullable<K>], fields?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    update<K extends keyof T & keyof Inner & string>(key: K, value: T[K] & Inner[K], update: Partial<T>, options?: UpdateOptions): Promise<void>;
    remove<K extends keyof T & string>(key: K, value: T[K] & Inner[K]): Promise<number>;
    private wrapAll;
    private unwrapAll;
}
