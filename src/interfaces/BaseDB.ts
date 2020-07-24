import type { Collection } from './Collection';
import type { IDable } from './IDable';
import type { DB, DBKeys } from './DB';
import { canonicalJSON } from '../helpers/serialiser';

export default abstract class BaseDB implements DB {
  private readonly collectionCache = new Map<string, [string, Collection<any>]>();

  constructor(
    private readonly makeCollection: <T extends IDable>(
      name: string,
      keys?: DBKeys<T>,
    ) => Collection<T>,
  ) {}

  public getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T> {
    const cached = this.collectionCache.get(name);
    const normKeys = canonicalJSON(keys);
    if (cached) {
      const [cachedNormKeys, cachedCol] = cached;
      if (normKeys !== cachedNormKeys) {
        throw new Error(`Cannot requuest collection '${name}' with different keys`);
      }
      return cachedCol;
    }
    const created = this.makeCollection(name, keys);
    this.collectionCache.set(name, [normKeys, created]);
    return created;
  }

  abstract close(): Promise<void> | void;
}
