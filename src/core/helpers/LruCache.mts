export class LruCache<K, V> {
  /** @internal */ declare private readonly _capacity: number;
  /** @internal */ declare private readonly _flushFn: ((value: V) => void) | undefined;
  /** @internal */ private readonly _storage = new Map<K, V>();

  constructor(capacity: number, flushFn?: (value: V) => void) {
    this._capacity = capacity;
    this._flushFn = flushFn;
  }

  cached(key: K, calc: (key: K) => V, fresh: (value: V) => boolean = always): V {
    const value = this._storage.get(key);
    if (this._storage.delete(key)) {
      if (fresh(value!)) {
        this._storage.set(key, value!);
        return value!;
      }
      this._flushFn?.(value!);
    }
    const created = calc(key);
    this._internalAdd(key, created);
    return created;
  }

  async cachedAsync(
    key: K,
    calc: (key: K) => Promise<V>,
    fresh: (value: V) => boolean = always,
  ): Promise<V> {
    const value = this._storage.get(key);
    if (this._storage.delete(key)) {
      if (fresh(value!)) {
        this._storage.set(key, value!);
        return value!;
      }
      this._flushFn?.(value!);
    }
    const created = await calc(key);
    this._internalAdd(key, created);
    return created;
  }

  add(key: K, value: V) {
    this.remove(key);
    this._internalAdd(key, value);
  }

  peek(key: K): V | undefined {
    return this._storage.get(key);
  }

  remove(key: K) {
    if (this._flushFn) {
      const value = this._storage.get(key);
      if (this._storage.delete(key)) {
        this._flushFn(value!);
      }
    } else {
      this._storage.delete(key);
    }
  }

  clear() {
    if (this._flushFn) {
      const items = [...this._storage.values()];
      this._storage.clear();
      for (const value of items) {
        this._flushFn(value);
      }
    } else {
      this._storage.clear();
    }
  }

  /** @internal */ private _internalAdd(key: K, value: V) {
    this._storage.set(key, value);

    while (this._storage.size > this._capacity) {
      this.remove(this._storage.keys().next().value!);
    }
  }
}

const always = () => true;
