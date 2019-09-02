export default class LruCache<K, V> {
    private readonly capacity;
    private readonly storage;
    constructor(capacity: number);
    set(key: K, value: V): void;
    get(key: K): V | undefined;
    private flush;
}
