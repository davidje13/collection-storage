export default class LruCache<K, V> {
  private readonly storage = new Map<K, V>();

  public constructor(
    private readonly capacity: number,
  ) {}

  public set(key: K, value: V): void {
    this.storage.delete(key);
    this.storage.set(key, value);
    this.flush();
  }

  public get(key: K): V | undefined {
    const value = this.storage.get(key);
    if (this.storage.delete(key)) {
      this.storage.set(key, value!);
    }
    return value;
  }

  public async cachedAsync(key: K, calc: (key: K) => Promise<V>): Promise<V> {
    const value = this.storage.get(key);
    if (this.storage.delete(key)) {
      this.storage.set(key, value!);
      return value!;
    }
    const created = await calc(key);
    this.storage.set(key, created);
    return created;
  }

  public remove(key: K): void {
    this.storage.delete(key);
  }

  private flush(): void {
    while (this.storage.size > this.capacity) {
      this.storage.delete(this.storage.keys().next().value);
    }
  }
}
