import type { Collection, UpdateOptions, Filtered } from '../interfaces/Collection.mts';
import type { IDable } from '../interfaces/IDable.mts';
import { LruCache } from '../helpers/LruCache.mts';
import {
  serialiseValue,
  deserialiseValue,
  serialiseRecord,
  partialDeserialiseRecord,
  type Serialised,
  deserialiseRecord,
} from '../helpers/serialiser.mts';

export interface CacheOptions {
  capacity?: number;
  maxAge?: number;
  time?: () => number;
}

interface CacheItem<T> {
  serialised: Serialised<T> | null;
  partial: boolean;
  time: number;
}

function appendAttr<T extends string, K extends string>(
  attributes: Readonly<T[]>,
  extra: K,
): Readonly<(T | K)[]> {
  if (attributes.includes(extra as unknown as T)) {
    return attributes;
  }
  return [...attributes, extra];
}

class CachedCollection<T extends IDable> implements Collection<T> {
  /** @internal */ private readonly _baseCollection: Collection<T>;
  /** @internal */ private readonly _maxAge: number;
  /** @internal */ private readonly _time: () => number;
  /** @internal */ private readonly _cache: LruCache<string, CacheItem<T>>;
  /** @internal */ private readonly _customIndexData: Map<
    string & keyof T,
    Map<string, Set<string>>
  >;

  constructor(
    baseCollection: Collection<T>,
    {
      capacity = Number.POSITIVE_INFINITY,
      maxAge = Number.POSITIVE_INFINITY,
      time = Date.now,
    }: CacheOptions,
  ) {
    this._baseCollection = baseCollection;
    this._maxAge = maxAge;
    this._time = time;
    this._cache = new LruCache(capacity, this._removeIndices.bind(this));
    this._customIndexData = new Map(
      baseCollection.indices.getCustomIndices().map((k) => [k, new Map()]),
    );
  }

  get name() {
    return this._baseCollection.name;
  }

  get indices() {
    return this._baseCollection.indices;
  }

  get closed() {
    return this._baseCollection.closed;
  }

  async add(...records: T[]) {
    await this._baseCollection.add(...records);
    for (const record of records) {
      this._store(serialiseRecord(record), false);
    }
  }

  /** @internal */ private _byId(baseFilter: Filtered<T>, id: T['id']): Filtered<T> {
    const self = this;
    return {
      ...baseFilter,

      async get() {
        const cached = await self._cachedById(id);
        if (!cached.serialised) {
          return null;
        }
        return deserialiseRecord(cached.serialised);
      },
      async *values() {
        const cached = await self._cachedById(id);
        if (cached.serialised) {
          yield deserialiseRecord(cached.serialised);
        }
      },
      async remove() {
        const removed = await baseFilter.remove();
        if (removed > 0) {
          self._cache.add(serialiseValue(id), {
            serialised: null,
            partial: false,
            time: self._time(),
          });
        }
        return removed;
      },
      async update(delta: Partial<T>, options?: UpdateOptions) {
        await baseFilter.update(delta, options);
        const sDelta = serialiseRecord(delta);
        const sId = serialiseValue(id);
        const item = self._cache.peek(sId);
        const serialised = item?.serialised;
        if (serialised) {
          self._removeIndices(item);
          sDelta.forEach((v, k) => serialised.set(k, v));
          self._populateIndices(item);
        } else if (options?.upsert) {
          self._store(sDelta.set('id', sId), true);
        }
      },
      attrs<F extends readonly (string & keyof T)[]>(attributes: F) {
        return {
          async get() {
            const cacheItem = await self._cachedById(id, attributes);
            if (!cacheItem.serialised) {
              return null;
            }
            return partialDeserialiseRecord(cacheItem.serialised, attributes);
          },
          async *values() {
            const cacheItem = await self._cachedById(id, attributes);
            if (cacheItem.serialised) {
              yield partialDeserialiseRecord(cacheItem.serialised, attributes);
            }
          },
        };
      },
    };
  }

  /** @internal */ private _byUnique<K extends string & keyof T>(
    baseFilter: Filtered<T>,
    filterAttribute: K,
    filterValue: T[K],
  ): Filtered<T> {
    const self = this;
    return {
      ...this._by(baseFilter, filterAttribute, filterValue),

      async get() {
        const sId = self._filterOne(filterAttribute, filterValue);
        if (sId !== null) {
          const cached = await self._cachedById(deserialiseValue(sId) as T['id']);
          if (cached.serialised?.get(filterAttribute) === serialiseValue(filterValue)) {
            return deserialiseRecord(cached.serialised);
          }
        }
        const record = await baseFilter.get();
        if (record) {
          self._store(
            serialiseRecord(record).set(filterAttribute, serialiseValue(filterValue)),
            false,
          );
        } else {
          self._clearCacheMatching(filterAttribute, filterValue);
        }
        return record;
      },
      async *values() {
        const record = await this.get();
        if (record !== null) {
          yield record;
        }
      },
      attrs<F extends readonly (string & keyof T)[]>(attributes: F) {
        return {
          async get() {
            const sId = self._filterOne(filterAttribute, filterValue);
            if (sId !== null) {
              const cached = await self._cachedById(
                deserialiseValue(sId) as T['id'],
                appendAttr(attributes, filterAttribute),
              );
              if (cached.serialised?.get(filterAttribute) === serialiseValue(filterValue)) {
                return partialDeserialiseRecord(cached.serialised, attributes);
              }
            }
            const record = await baseFilter.attrs(appendAttr(attributes, 'id')).get();
            if (record) {
              self._store(
                serialiseRecord(record).set(filterAttribute, serialiseValue(filterValue)),
                true,
              );
            } else {
              self._clearCacheMatching(filterAttribute, filterValue);
            }
            return record;
          },
          async *values() {
            const record = await this.get();
            if (record !== null) {
              yield record;
            }
          },
        };
      },
    };
  }

  /** @internal */ private _by<K extends string & keyof T>(
    baseFilter: Filtered<T>,
    filterAttribute: K,
    filterValue: T[K],
  ): Filtered<T> {
    const self = this;
    return {
      ...baseFilter,

      async get() {
        const item = await baseFilter.get();
        if (item) {
          self._store(serialiseRecord(item), false);
        } else {
          self._clearCacheMatching(filterAttribute, filterValue);
        }
        return item;
      },
      async *values() {
        const items = baseFilter.values();
        if (self._baseCollection.indices.isIndex(filterAttribute)) {
          const idxSIds = new Set(self._filter(filterAttribute, filterValue));
          for await (const item of items) {
            self._store(serialiseRecord(item), false);
            idxSIds.delete(serialiseValue(item.id));
            yield item;
          }
          idxSIds.forEach((sId) => self._cache.remove(sId));
        } else {
          for await (const item of items) {
            self._store(serialiseRecord(item), false);
            yield item;
          }
        }
      },
      async remove() {
        const removed = await baseFilter.remove();
        if (removed > 0) {
          for (const sId of self._filter(filterAttribute, filterValue)) {
            self._cache.add(sId, { serialised: null, partial: false, time: self._time() });
          }
        }
        return removed;
      },
      async update(delta: Partial<T>, options?: UpdateOptions) {
        await baseFilter.update(delta, options);
        const sDelta = serialiseRecord(delta);
        for (const sId of self._filter(filterAttribute, filterValue)) {
          const item = self._cache.peek(sId);
          const serialised = item?.serialised;
          if (serialised) {
            self._removeIndices(item);
            sDelta.forEach((v, k) => serialised.set(k, v));
            self._populateIndices(item);
          }
        }
      },

      attrs<F extends readonly (string & keyof T)[]>(returnAttributes: F) {
        return {
          async get() {
            const item = await baseFilter.attrs(appendAttr(returnAttributes, 'id')).get();
            if (item) {
              self._store(
                serialiseRecord(item).set(filterAttribute, serialiseValue(filterValue)),
                true,
              );
            } else {
              self._clearCacheMatching(filterAttribute, filterValue);
            }
            return item;
          },
          async *values() {
            const items = baseFilter.attrs(appendAttr(returnAttributes, 'id')).values();
            if (self._baseCollection.indices.isIndex(filterAttribute)) {
              const idxSIds = new Set(self._filter(filterAttribute, filterValue));
              for await (const item of items) {
                idxSIds.delete(serialiseValue(item.id));
                if (!returnAttributes.includes('id')) {
                  const { id, ...restItem } = item;
                  yield restItem as Pick<T, F[number]>;
                } else {
                  yield item;
                }
              }
              idxSIds.forEach((sId) => self._cache.remove(sId));
            } else {
              if (!returnAttributes.includes('id')) {
                for await (const { id, ...restItem } of items) {
                  yield restItem as Pick<T, F[number]>;
                }
              } else {
                yield* items;
              }
            }
          },
        };
      },
    };
  }

  all() {
    const self = this;
    const baseFilter = this._baseCollection.all();
    return {
      ...baseFilter,

      async get() {
        const item = await baseFilter.get();
        if (item) {
          self._store(serialiseRecord(item), false);
        } else {
          self._cache.clear();
        }
        return item;
      },
      async *values() {
        self._cache.clear();
        for await (const item of self._baseCollection.all().values()) {
          self._store(serialiseRecord(item), false);
          yield item;
        }
      },
      remove() {
        self._cache.clear();
        return baseFilter.remove();
      },
      update() {
        throw new Error('Cannot apply update to all items');
      },

      attrs<F extends readonly (string & keyof T)[]>(returnAttributes: F) {
        return {
          async get() {
            const item = await baseFilter.attrs(appendAttr(returnAttributes, 'id')).get();
            if (item) {
              self._store(serialiseRecord(item), true);
            } else {
              self._cache.clear();
            }
            return item;
          },
          values() {
            return baseFilter.attrs(returnAttributes).values();
          },
        };
      },
    };
  }

  where<K extends string & keyof T>(filterAttribute: K, filterValue: T[K]) {
    const baseFilter = this._baseCollection.where(filterAttribute, filterValue);
    if (filterAttribute === 'id') {
      return this._byId(baseFilter, filterValue as T['id']);
    } else if (this._baseCollection.indices.isUniqueIndex(filterAttribute)) {
      return this._byUnique(baseFilter, filterAttribute, filterValue);
    } else {
      return this._by(baseFilter, filterAttribute, filterValue);
    }
  }

  /** @internal */ private _filter<K extends string & keyof T>(
    attribute: K,
    value: T[K],
  ): Iterable<string> {
    return this._customIndexData.get(attribute)?.get(serialiseValue(value)) ?? [];
  }

  /** @internal */ private _filterOne<K extends string & keyof T>(
    attribute: K,
    value: T[K],
  ): string | null {
    return (
      this._customIndexData.get(attribute)?.get(serialiseValue(value))?.keys().next().value ?? null
    );
  }

  /** @internal */ private _clearCacheMatching<K extends string & keyof T>(
    attribute: K,
    value: T[K],
  ) {
    for (const k of this._filter(attribute, value)) {
      this._cache.remove(k);
    }
  }

  /** @internal */ private _populateIndices({ serialised }: CacheItem<T>): void {
    if (!serialised) {
      return;
    }

    const sId = serialised.get('id')!;
    this._customIndexData.forEach((idx, attr) => {
      const sValue = serialised.get(attr);
      if (!sValue) {
        return;
      }
      let idxSIds = idx.get(sValue);
      if (!idxSIds) {
        idxSIds = new Set([sId]);
        idx.set(sValue, idxSIds);
      } else if (idxSIds.size && this.indices.isUniqueIndex(attr)) {
        const idxSId = idxSIds.keys().next().value!;
        if (idxSId !== sId) {
          this._cache.remove(idxSId);
          idx.set(sValue, new Set([sId]));
        }
      } else {
        idxSIds.add(sId);
      }
    });
  }

  /** @internal */ private _removeIndices({ serialised }: CacheItem<T>): void {
    if (!serialised) {
      return;
    }

    const sId = serialised.get('id')!;
    this._customIndexData.forEach((idx, attr) => {
      const sValue = serialised.get(attr);
      if (!sValue) {
        return;
      }
      const idxSIds = idx.get(sValue)!;
      idxSIds.delete(sId);
      if (!idxSIds.size) {
        idx.delete(sValue);
      }
    });
  }

  /** @internal */ private _store(serialised: Serialised<T>, partial: boolean): void {
    const cacheItem = { serialised, partial, time: this._time() };
    this._populateIndices(cacheItem);
    this._cache.add(serialised.get('id')!, cacheItem);
  }

  /** @internal */ private _cachedById<F extends readonly (string & keyof T)[]>(
    id: T['id'],
    attributes?: F,
  ): Promise<CacheItem<T>> {
    const sId = serialiseValue(id);
    return this._cache.cachedAsync(
      sId,
      async () => {
        const filter = this._baseCollection.where('id', id);
        const item = attributes ? await filter.attrs(attributes).get() : await filter.get();
        const cacheItem = {
          serialised: item ? serialiseRecord(item).set('id', sId) : null,
          partial: Boolean(attributes),
          time: this._time(),
        };
        this._populateIndices(cacheItem);
        return cacheItem;
      },
      this._isFresh(attributes),
    );
  }

  /** @internal */ private _isFresh(
    attributes?: readonly (string & keyof T)[],
  ): (item: CacheItem<T>) => boolean {
    return ({ serialised, partial, time }: CacheItem<T>): boolean => {
      if (this._time() > time + this._maxAge) {
        return false;
      }
      if (!serialised || !partial) {
        return true;
      }
      if (!attributes) {
        return false;
      }
      return attributes.every((attr) => serialised.has(attr));
    };
  }
}

export function cache<T extends IDable>(
  baseCollection: Collection<T>,
  options: CacheOptions = {},
): Collection<T> {
  if (
    (options.capacity !== undefined && options.capacity <= 0) ||
    (options.maxAge !== undefined && options.maxAge < 0)
  ) {
    return baseCollection;
  }
  return new CachedCollection(baseCollection, options);
}
