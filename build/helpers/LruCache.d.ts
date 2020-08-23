export default class LruCache<K, V> {
    private readonly capacity;
    private readonly flushFn?;
    private readonly storage;
    constructor(capacity: number, flushFn?: (value: V) => void);
    cached(key: K, calc: (key: K) => V, fresh?: (value: V) => boolean): V;
    cachedAsync(key: K, calc: (key: K) => Promise<V>, fresh?: (value: V) => boolean): Promise<V>;
    add(key: K, value: V): void;
    peek(key: K): V | undefined;
    remove(key: K): void;
    clear(): void;
    private internalAdd;
}
//# sourceMappingURL=LruCache.d.ts.map