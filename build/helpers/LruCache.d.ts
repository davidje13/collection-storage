export default class LruCache<K, V> {
    private readonly capacity;
    private readonly storage;
    constructor(capacity: number);
    cached(key: K, calc: (key: K) => V): V;
    cachedAsync(key: K, calc: (key: K) => Promise<V>): Promise<V>;
    remove(key: K): void;
    private flush;
}
//# sourceMappingURL=LruCache.d.ts.map