import type { Collection, UpdateOptions, Indices } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
import LruCache from '../helpers/LruCache';
import {
  serialiseValue,
  deserialiseValue,
  serialiseRecord,
  partialDeserialiseRecord,
  Serialised,
} from '../helpers/serialiser';

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

function appendField<T extends string, K extends string>(
  fields: Readonly<T[]> | undefined,
  extra: K,
): Readonly<(T | K)[]> | undefined {
  if (!fields || fields.includes(extra as unknown as T)) {
    return fields;
  }
  return [...fields, extra];
}

class CachedCollection<T extends IDable> implements Collection<T> {
  private readonly maxAge: number;

  private readonly time: () => number;

  private readonly cache: LruCache<string, CacheItem<T>>;

  private readonly customIndexData: Map<string & keyof T, Map<string, Set<string>>>;

  public constructor(
    private readonly baseCollection: Collection<T>,
    {
      capacity = Number.POSITIVE_INFINITY,
      maxAge = Number.POSITIVE_INFINITY,
      time = Date.now,
    }: CacheOptions,
  ) {
    this.maxAge = maxAge;
    this.time = time;
    this.cache = new LruCache(capacity, this.removeIndices.bind(this));
    this.customIndexData = new Map(baseCollection.indices.getCustomIndices()
      .map((k) => ([k, new Map()])));
  }

  public async add(entry: T): Promise<void> {
    await this.baseCollection.add(entry);
    this.storeItem(serialiseRecord(entry), false);
  }

  public async get<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    key: K,
    value: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (key === 'id') {
      const cacheItem = await this.cachedById(value as T['id'], fields);
      if (!cacheItem.serialised) {
        return null;
      }
      return partialDeserialiseRecord(cacheItem.serialised, fields);
    }
    if (this.indices.isUniqueIndex(key)) {
      const keys = this.getKeys(key, value);
      if (keys.length) {
        const cacheItem = await this.cachedById(deserialiseValue(keys[0]) as T['id'], appendField(fields, key));
        if (cacheItem.serialised && cacheItem.serialised.get(key) === serialiseValue(value)) {
          return partialDeserialiseRecord(cacheItem.serialised, fields);
        }
      }
    }

    const item = await this.baseCollection.get(key, value, appendField(fields, 'id')!);
    if (item) {
      this.storeItem(serialiseRecord(item).set(key, serialiseValue(value)), Boolean(fields));
    } else {
      this.getKeys(key, value).forEach((k) => this.cache.remove(k));
    }
    return item;
  }

  public async getAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    key?: K,
    value?: T[NonNullable<K>],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (!key) {
      const allItems = await this.baseCollection.getAll();
      this.cache.clear();
      allItems.forEach((item) => this.storeItem(serialiseRecord(item), false));
      return allItems;
    }
    if (this.indices.isUniqueIndex(key)) {
      const item = await this.get(key, value!, fields);
      return item ? [item] : [];
    }
    const items = await this.baseCollection.getAll(key, value!, appendField(fields, 'id')!);
    if (this.indices.isIndex(key)) {
      const idxKeys = new Set(this.getKeys(key, value!));
      items.forEach(({ id }) => idxKeys.delete(serialiseValue(id)));
      idxKeys.forEach((k) => this.cache.remove(k));
    }
    if (fields && !fields.includes('id')) {
      return items.map(({ id, ...restItem }) => (restItem as Pick<T, F[-1]>));
    }
    return items;
  }

  public async update<K extends string & keyof T>(
    key: K,
    value: T[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void> {
    await this.baseCollection.update(key, value, update, options);
    const keys = this.getKeys(key, value);
    const serialisedUpdate = serialiseRecord(update);
    keys.forEach((itemKey) => {
      const item = this.cache.peek(itemKey)!;
      const { serialised } = item;
      if (serialised) {
        this.removeIndices(item);
        serialisedUpdate.forEach((v, k) => {
          serialised.set(k, v);
        });
        this.populateIndices(item);
      }
    });
    if (!keys.length && options?.upsert && key === 'id') {
      this.storeItem(serialiseRecord(update).set('id', serialiseValue(value)), true);
    }
  }

  public async remove<K extends string & keyof T>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const removed = await this.baseCollection.remove(key, value);
    if (removed > 0) {
      this.getKeys(key, value).forEach((k) => {
        this.cache.add(k, { serialised: null, partial: false, time: this.time() });
      });
    }
    return removed;
  }

  public get indices(): Indices<T> {
    return this.baseCollection.indices;
  }

  private getKeys<K extends string & keyof T>(key: K, value: T[K]): string[] {
    const sv = serialiseValue(value);
    if (key === 'id') {
      return [sv];
    }
    const keys = this.customIndexData.get(key)?.get(sv);
    return keys ? [...keys] : [];
  }

  private populateIndices({ serialised }: CacheItem<T>): void {
    if (!serialised) {
      return;
    }

    const id = serialised.get('id')!;
    this.customIndexData.forEach((idx, attr) => {
      const value = serialised.get(attr);
      if (!value) {
        return;
      }
      let idxKeys = idx.get(value);
      if (!idxKeys) {
        idxKeys = new Set([id]);
        idx.set(value, idxKeys);
      } else if (idxKeys.size && this.indices.isUniqueIndex(attr)) {
        const idxKey = [...idxKeys][0];
        if (idxKey !== id) {
          this.cache.remove(idxKey);
          idx.set(value, new Set([id]));
        }
      } else {
        idxKeys.add(id);
      }
    });
  }

  private removeIndices({ serialised }: CacheItem<T>): void {
    if (!serialised) {
      return;
    }

    const id = serialised.get('id')!;
    this.customIndexData.forEach((idx, attr) => {
      const value = serialised.get(attr);
      if (!value) {
        return;
      }
      const idxKeys = idx.get(value)!;
      idxKeys.delete(id);
      if (!idxKeys.size) {
        idx.delete(value);
      }
    });
  }

  private storeItem(serialised: Serialised<T>, partial: boolean): void {
    const cacheItem = { serialised, partial, time: this.time() };
    this.populateIndices(cacheItem);
    this.cache.add(serialised.get('id')!, cacheItem);
  }

  private cachedById<F extends readonly (string & keyof T)[]>(
    id: T['id'],
    fields?: F,
  ): Promise<CacheItem<T>> {
    const key = serialiseValue(id);
    return this.cache.cachedAsync(key, async () => {
      const item = await this.baseCollection.get('id', id, fields!);
      const cacheItem = {
        serialised: item ? serialiseRecord(item).set('id', key) : null,
        partial: Boolean(fields),
        time: this.time(),
      };
      this.populateIndices(cacheItem);
      return cacheItem;
    }, this.isFresh(fields));
  }

  private isFresh(fields?: readonly (string & keyof T)[]): (item: CacheItem<T>) => boolean {
    return ({ serialised, partial, time }: CacheItem<T>): boolean => {
      if (this.time() > time + this.maxAge) {
        return false;
      }
      if (!serialised || !partial) {
        return true;
      }
      if (!fields) {
        return false;
      }
      return fields.every((field) => serialised.has(field));
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
  return new CachedCollection<T>(baseCollection, options);
}
