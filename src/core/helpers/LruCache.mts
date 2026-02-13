export class LruCache<K, V> {
  /** @internal */ declare private readonly _capacity: number;
  /** @internal */ declare private readonly _flushFn: ((value: V) => void) | undefined;
  /** @internal */ declare private readonly _purgeFresh: (value: V) => boolean;
  /** @internal */ declare private readonly _purgeInterval: number | undefined;
  /** @internal */ declare private _purgeTm: NodeJS.Timeout | undefined;
  /** @internal */ private readonly _storage = new Map<K, V>();

  constructor(
    capacity: number,
    flushFn?: (value: V) => void,
    purgeFresh: (value: V) => boolean = always,
    purgeInterval = Number.POSITIVE_INFINITY,
  ) {
    this._capacity = capacity;
    this._flushFn = flushFn;
    this._purgeFresh = purgeFresh;
    this._purgeInterval =
      Number.isFinite(purgeInterval) && purgeInterval > 0
        ? Math.min(purgeInterval, 1000 * 60 * 60 * 24)
        : undefined;
    this.purge = this.purge.bind(this);
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
    if (!this._storage.size && this._purgeTm) {
      clearTimeout(this._purgeTm);
      this._purgeTm = undefined;
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
    clearTimeout(this._purgeTm);
    this._purgeTm = undefined;
  }

  purge() {
    try {
      for (const [key, value] of [...this._storage]) {
        if (!this._purgeFresh(value)) {
          if (this._storage.delete(key)) {
            this._flushFn?.(value);
          }
        }
      }
    } catch (err) {
      console.warn('Error while purging LruCache', err);
    }
    clearTimeout(this._purgeTm);
    this._purgeTm =
      this._storage.size && this._purgeInterval
        ? setTimeout(this.purge, this._purgeInterval).unref()
        : undefined;
  }

  /** @internal */ private _internalAdd(key: K, value: V) {
    this._storage.set(key, value);

    while (this._storage.size > this._capacity) {
      this.remove(this._storage.keys().next().value!);
    }

    if (!this._purgeTm && this._purgeInterval) {
      this._purgeTm = setTimeout(this.purge, this._purgeInterval).unref();
    }
  }
}

const always = () => true;
