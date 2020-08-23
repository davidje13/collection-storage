const always = (): boolean => true;

export default class LruCache<K, V> {
  private readonly storage = new Map<K, V>();

  public constructor(
    private readonly capacity: number,
    private readonly flushFn?: (value: V) => void,
  ) {}

  public cached(
    key: K,
    calc: (key: K) => V,
    fresh: (value: V) => boolean = always,
  ): V {
    const value = this.storage.get(key);
    if (this.storage.delete(key)) {
      if (fresh(value!)) {
        this.storage.set(key, value!);
        return value!;
      }
      this.flushFn?.(value!);
    }
    const created = calc(key);
    this.internalAdd(key, created);
    return created;
  }

  public async cachedAsync(
    key: K,
    calc: (key: K) => Promise<V>,
    fresh: (value: V) => boolean = always,
  ): Promise<V> {
    const value = this.storage.get(key);
    if (this.storage.delete(key)) {
      if (fresh(value!)) {
        this.storage.set(key, value!);
        return value!;
      }
      this.flushFn?.(value!);
    }
    const created = await calc(key);
    this.internalAdd(key, created);
    return created;
  }

  public add(key: K, value: V): void {
    this.remove(key);
    this.internalAdd(key, value);
  }

  public peek(key: K): V | undefined {
    return this.storage.get(key);
  }

  public remove(key: K): void {
    if (this.flushFn) {
      const value = this.storage.get(key);
      if (this.storage.delete(key)) {
        this.flushFn(value!);
      }
    } else {
      this.storage.delete(key);
    }
  }

  public clear(): void {
    this.storage.clear();
  }

  private internalAdd(key: K, value: V): void {
    this.storage.set(key, value);

    while (this.storage.size > this.capacity) {
      this.remove(this.storage.keys().next().value);
    }
  }
}
