export default class LruCache<K, V> {
  private readonly storage = new Map<K, V>();

  public constructor(
    private readonly capacity: number,
  ) {}

  public async cachedAsync(key: K, calc: (key: K) => Promise<V>): Promise<V> {
    const value = this.storage.get(key);
    if (this.storage.delete(key)) {
      this.storage.set(key, value!);
      return value!;
    }
    const created = await calc(key);
    this.storage.set(key, created);
    this.flush();
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
