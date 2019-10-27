export default class LruCache<K, V> {
    private readonly capacity;
    private readonly storage;
    constructor(capacity: number);
    set(key: K, value: V): void;
    get(key: K): V | undefined;
    remove(key: K): void;
    private flush;
}
//# sourceMappingURL=LruCache.d.ts.map