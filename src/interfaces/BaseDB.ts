import type { Collection } from './Collection';
import type { IDable } from './IDable';
import type { DB, DBKeys } from './DB';
import { canonicalJSON } from '../helpers/serialiser';

export interface StateRef {
  closed: boolean;
}

interface AsyncCollection<T extends IDable> extends Collection<T> {
  internalReady?: () => Promise<void>;
}

export default abstract class BaseDB implements DB {
  protected readonly stateRef: StateRef = { closed: false };

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
    const created = this.makeCollection(name, keys) as AsyncCollection<T>;
    this.collectionCache.set(name, [normKeys, created]);
    return created;
  }

  close(): Promise<void> | void {
    if (this.stateRef.closed) {
      return undefined;
    }
    this.syncClose();
    const toAwait = [...this.collectionCache.values()]
      .map(([, c]) => (c as AsyncCollection<IDable>).internalReady?.());
    return Promise.allSettled(toAwait).then(() => this.internalClose());
  }

  protected syncClose(): void {
    this.stateRef.closed = true;
  }

  // eslint-disable-next-line class-methods-use-this
  protected internalClose(): Promise<void> | void {}
}
