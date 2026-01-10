import { canonicalJSON } from '../helpers/serialiser.mts';
import type { Collection } from './Collection.mts';
import type { CollectionOptions } from './CollectionOptions.mts';
import type { DB, DBKeys } from './DB.mts';
import type { IDable } from './IDable.mts';

export abstract class BaseDB implements DB {
  // Note: private properties & methods in this class must not be mangled by terser,
  // as it can lead to name collisions when the sub-classes get (separately) mangled

  /** @internal */ private readonly csState = { closed: false };
  /** @internal */ private readonly csCache = new Map<string, [string, Collection<any>]>();
  /** @internal */ declare private csClose: Promise<void> | undefined;

  abstract getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;

  protected internalClose(): Promise<void> | void {}

  close() {
    if (!this.csClose) {
      this.csState.closed = true;
      this.csClose = this.allReady().then(() => this.internalClose());
    }
    return this.csClose;
  }

  get closed() {
    return this.csState.closed;
  }

  protected get<T extends IDable, CollectionT extends Collection<T>>(
    name: string,
    keys: DBKeys<T> = {},
    factory: (options: CollectionOptions<T>) => CollectionT,
  ): CollectionT {
    if (this.csState.closed) {
      throw new Error('Connection closed');
    }
    const cached = this.csCache.get(name);
    const normKeys = canonicalJSON(keys);
    if (cached) {
      const [cachedNormKeys, cachedCol] = cached;
      if (normKeys !== cachedNormKeys) {
        throw new Error(`Cannot request collection '${name}' with different keys`);
      }
      return cachedCol as CollectionT;
    }
    const created = factory({ name, keys, state: this.csState });
    this.csCache.set(name, [normKeys, created]);
    return created;
  }

  protected async allReady() {
    const toAwait = [...this.csCache.values()].map(([, c]) =>
      (c as AsyncCollection<IDable>).internalReady?.(),
    );
    await Promise.allSettled(toAwait);
  }
}

interface AsyncCollection<T extends IDable> extends Collection<T> {
  internalReady?: () => Promise<void>;
}
