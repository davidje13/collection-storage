import { canonicalJSON } from '../helpers/serialiser.mts';
import type { Collection } from './Collection.mts';
import type { CollectionOptions } from './CollectionOptions.mts';
import type { DB, DBKeys } from './DB.mts';
import type { IDable } from './IDable.mts';

export abstract class BaseDB implements DB {
  /** @internal */ private readonly _state = { closed: false };
  /** @internal */ private readonly _cache = new Map<string, [string, Collection<any>]>();
  /** @internal */ private _closing: Promise<void> | undefined;

  abstract getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;

  protected internalClose(): Promise<void> | void {}

  close() {
    if (!this._closing) {
      this._state.closed = true;
      this._closing = this.allReady().then(() => this.internalClose());
    }
    return this._closing;
  }

  get closed() {
    return this._state.closed;
  }

  protected get<T extends IDable, CollectionT extends Collection<T>>(
    name: string,
    keys: DBKeys<T> = {},
    factory: (options: CollectionOptions<T>) => CollectionT,
  ): CollectionT {
    if (this._state.closed) {
      throw new Error('Connection closed');
    }
    const cached = this._cache.get(name);
    const normKeys = canonicalJSON(keys);
    if (cached) {
      const [cachedNormKeys, cachedCol] = cached;
      if (normKeys !== cachedNormKeys) {
        throw new Error(`Cannot requuest collection '${name}' with different keys`);
      }
      return cachedCol as CollectionT;
    }
    const created = factory({ name, keys, state: this._state });
    this._cache.set(name, [normKeys, created]);
    return created;
  }

  protected async allReady() {
    const toAwait = [...this._cache.values()].map(([, c]) =>
      (c as AsyncCollection<IDable>).internalReady?.(),
    );
    await Promise.allSettled(toAwait);
  }
}

interface AsyncCollection<T extends IDable> extends Collection<T> {
  internalReady?: () => Promise<void>;
}
