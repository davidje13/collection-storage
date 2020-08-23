import type { Collection, UpdateOptions, Indices } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
import LruCache from '../helpers/LruCache';
import {
  serialiseValue,
  deserialiseValue,
  serialiseRecord,
  deserialiseRecord,
} from '../helpers/serialiser';

export interface CacheOptions {
  capacity?: number;
  maxAge?: number;
  time?: () => number;
}

interface CacheItem {
  serialised: Record<string, string> | null;
  partial: boolean;
  time: number;
}

function appendField<T, K extends string>(
  fields: Readonly<T[]> | undefined,
  extra: K,
): (T | K)[] | undefined {
  if (!fields) {
    return undefined;
  }
  return [...fields, extra];
}

function filterItem<T, F extends readonly (keyof T & string)[]>(
  { serialised }: CacheItem,
  fields?: F,
): Readonly<Pick<T, F[-1]>> | null {
  if (!serialised) {
    return null;
  }
  let result: Record<string, any>;
  if (fields) {
    result = {};
    fields.forEach((k) => {
      const v = serialised[k];
      if (v) {
        result[k] = deserialiseValue(v);
      }
    });
  } else {
    result = deserialiseRecord(serialised);
  }
  return result as Readonly<Pick<T, F[-1]>>;
}

class CachedCollection<T extends IDable> implements Collection<T> {
  private readonly maxAge: number;

  private readonly time: () => number;

  private readonly cache: LruCache<string, CacheItem>;

  private readonly indexData: Partial<Record<keyof T, Map<string, Set<string>>>> = {};

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
    baseCollection.indices.getCustomIndices().forEach((k) => {
      this.indexData[k as keyof T] = new Map();
    });
  }

  public async add(entry: T): Promise<void> {
    await this.baseCollection.add(entry);
    this.storeItem(entry, false);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    key: K,
    value: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (key === 'id') {
      return filterItem(await this.cachedById(value as T['id'], fields), fields);
    }
    if (this.indices.isUniqueIndex(key)) {
      const keys = this.getKeys(key, value);
      if (keys.length) {
        const cacheItem = await this.cachedById(deserialiseValue(keys[0]) as T['id'], appendField(fields, key));
        if (cacheItem.serialised && cacheItem.serialised[key] === serialiseValue(value)) {
          return filterItem(cacheItem, fields);
        }
      }
    }

    const item = await this.baseCollection.get(key, value, appendField(fields, 'id')!);
    if (item) {
      this.storeItem({ [key]: value, ...item }, Boolean(fields));
    } else {
      this.getKeys(key, value).forEach((k) => this.cache.remove(k));
    }
    return item;
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    key?: K,
    value?: T[NonNullable<K>],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (!key) {
      const allItems = await this.baseCollection.getAll();
      this.cache.clear();
      allItems.forEach((item) => this.storeItem(item, false));
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

  public async update<K extends keyof T & string>(
    key: K,
    value: T[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void> {
    await this.baseCollection.update(key, value, update, options);
    const keys = this.getKeys(key, value);
    const serialisedUpdate = serialiseRecord(update);
    keys.forEach((k) => {
      const item = this.cache.peek(k)!;
      if (item.serialised) {
        this.removeIndices(item);
        Object.assign(item.serialised, serialisedUpdate);
        this.populateIndices(item);
      }
    });
    if (!keys.length && options?.upsert && key === 'id') {
      this.storeItem({ id: value as T['id'], ...update }, true);
    }
  }

  public async remove<K extends keyof T & string>(
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

  public get indices(): Indices {
    return this.baseCollection.indices;
  }

  private getKeys<K extends keyof T & string>(key: K, value: T[K]): string[] {
    const sv = serialiseValue(value);
    if (key === 'id') {
      return [sv];
    }
    const keys = this.indexData[key]?.get(sv);
    return keys ? [...keys] : [];
  }

  private populateIndices({ serialised }: CacheItem): void {
    if (!serialised) {
      return;
    }

    Object.entries(this.indexData).forEach(([attr, idx]) => {
      if (!Object.prototype.hasOwnProperty.call(serialised, attr)) {
        return;
      }
      let idxKeys = idx!.get(serialised[attr]);
      if (!idxKeys) {
        idxKeys = new Set([serialised.id]);
        idx!.set(serialised[attr], idxKeys);
      } else if (idxKeys.size && this.indices.isUniqueIndex(attr)) {
        const idxKey = [...idxKeys][0];
        if (idxKey !== serialised.id) {
          this.cache.remove(idxKey);
          idx!.set(serialised[attr], new Set([serialised.id]));
        }
      } else {
        idxKeys.add(serialised.id);
      }
    });
  }

  private removeIndices({ serialised }: CacheItem): void {
    if (!serialised) {
      return;
    }

    Object.entries(this.indexData).forEach(([attr, idx]) => {
      if (!Object.prototype.hasOwnProperty.call(serialised, attr)) {
        return;
      }
      const idxKeys = idx!.get(serialised[attr])!;
      idxKeys.delete(serialised.id);
      if (!idxKeys.size) {
        idx!.delete(serialised[attr]);
      }
    });
  }

  private storeItem(item: Readonly<Pick<T, 'id'>>, partial: boolean): void {
    const serialised = serialiseRecord(item);
    const cacheItem = { serialised, partial, time: this.time() };
    this.populateIndices(cacheItem);
    this.cache.add(serialised.id, cacheItem);
  }

  private cachedById<F extends readonly (keyof T & string)[]>(
    id: T['id'],
    fields?: F,
  ): Promise<CacheItem> {
    const key = serialiseValue(id);
    return this.cache.cachedAsync(key, async () => {
      const item = await this.baseCollection.get('id', id, fields!);
      const cacheItem = {
        serialised: item ? { id: key, ...serialiseRecord(item) } : null,
        partial: Boolean(fields),
        time: this.time(),
      };
      this.populateIndices(cacheItem);
      return cacheItem;
    }, this.isFresh(fields));
  }

  private isFresh(fields?: readonly (keyof T & string)[]): (item: CacheItem) => boolean {
    return ({ serialised, partial, time }: CacheItem): boolean => {
      if (this.time() > time + this.maxAge) {
        return false;
      }
      if (!serialised || !partial) {
        return true;
      }
      if (!fields) {
        return false;
      }
      return fields.every((field) => Object.prototype.hasOwnProperty.call(serialised, field));
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
