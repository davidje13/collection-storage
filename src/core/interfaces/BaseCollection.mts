import type { Collection, UpdateOptions, Indices, Filtered } from './Collection.mts';
import type { CollectionOptions } from './CollectionOptions.mts';
import type { IDable } from './IDable.mts';
import { BaseIndices } from './BaseIndices.mts';

export abstract class BaseCollection<T extends IDable> implements Collection<T> {
  readonly name: string;
  /** @internal */ private readonly _state: { readonly closed: boolean };
  /** @internal */ private _innerPreAct: () => Promise<void> | void;
  readonly indices: Readonly<Indices<T>>;

  // actually read publicly by CollectionCache but we don't want this to be a user-accessible property
  /** @internal */ protected internalReady: (() => Promise<void>) | undefined;

  protected constructor(options: CollectionOptions<T>) {
    this._innerPreAct = async () => {
      await this.preAct();
      if (this._state.closed) {
        throw new Error('Connection closed');
      }
    };
    this.name = options.name;
    this._state = options.state;
    this.indices = new BaseIndices(options.keys);
  }

  get closed() {
    return this._state.closed;
  }

  async add(...records: T[]): Promise<void> {
    await this._innerPreAct();
    return this.internalAddBatch(records);
  }

  all(): Filtered<T> {
    return this.where(undefined as any, undefined);
  }

  where<K extends string & keyof T>(filterAttribute: K, filterValue: T[K]): Filtered<T> {
    if (filterAttribute !== undefined && !this.indices.isIndex(filterAttribute)) {
      throw new Error(`No index for ${filterAttribute}`);
    }
    const c = this;

    return {
      async get() {
        await c._innerPreAct();
        return c.internalGet(filterAttribute, filterValue) as Promise<Readonly<T> | null>;
      },
      async *values() {
        await c._innerPreAct();
        yield* c.internalGetAll(filterAttribute, filterValue) as AsyncGenerator<
          Readonly<T>,
          void,
          undefined
        >;
      },
      async count() {
        await c._innerPreAct();
        return c.internalCount(filterAttribute, filterValue);
      },
      async exists() {
        await c._innerPreAct();
        return c.internalExists(filterAttribute, filterValue);
      },
      async remove() {
        await c._innerPreAct();
        return c.internalRemove(filterAttribute, filterValue);
      },
      async update(delta: Partial<T>, options: UpdateOptions = {}) {
        if (filterAttribute === undefined) {
          throw new Error('Cannot apply update to all items');
        }
        if (filterAttribute === 'id' && delta.id !== undefined && delta.id !== filterValue) {
          throw new Error('Cannot update ID');
        }
        if (options.upsert) {
          if (filterAttribute !== 'id') {
            throw new Error(`Can only upsert by ID, not ${filterAttribute}`);
          }
          let withoutId = delta;
          if (Object.prototype.hasOwnProperty.call(delta, 'id')) {
            withoutId = { ...delta };
            delete withoutId.id;
          }
          await c._innerPreAct();
          return c.internalUpsert(filterValue as T['id'], withoutId, options);
        }
        if (!c.indices.isIndex(filterAttribute)) {
          throw new Error(`No index for ${filterAttribute}`);
        }
        if (
          !c.indices.isUniqueIndex(filterAttribute) &&
          Object.keys(delta).some((k) => c.indices.isUniqueIndex(k))
        ) {
          throw new Error('Updating multiple records will create duplicates');
        }
        await c._innerPreAct();
        return c.internalUpdate(filterAttribute, filterValue, delta, options);
      },
      attrs<F extends readonly (string & keyof T)[]>(attributes: F) {
        return {
          async get() {
            await c._innerPreAct();
            return c.internalGet(filterAttribute, filterValue, attributes);
          },
          async *values() {
            await c._innerPreAct();
            yield* c.internalGetAll(filterAttribute, filterValue, attributes);
          },
        };
      },
    };
  }

  // Subclass constructors can call this with a promise that will resolve when
  // they are ready to be used. BaseCollection will automatically ensure that
  // other interactions are queued until this promise resolves.
  protected initAsync(wait: Promise<unknown>) {
    const pending: [() => void, (e: Error) => void][] = [];
    const addPending = () =>
      new Promise<void>((resolve, reject) => pending.push([resolve, reject]));
    this.internalReady = addPending;
    this._innerPreAct = async (): Promise<void> => {
      await addPending();
      await this.preAct();
      if (this._state.closed) {
        throw new Error('Connection closed');
      }
    };
    (async () => {
      try {
        await wait;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.internalReady = () => Promise.reject(e);
        this._innerPreAct = () => {
          throw err;
        };
        pending.forEach((f) => f[1](err));
        return;
      }
      if (this._state.closed) {
        const err = new Error('Connection closed');
        this._innerPreAct = () => {
          throw err;
        };
        pending.forEach((f) => f[1](err));
        return;
      }
      this.internalReady = undefined;
      this._innerPreAct = async () => {
        await this.preAct();
        if (this._state.closed) {
          throw new Error('Connection closed');
        }
      };
      pending.forEach((f) => f[0]());
    })();
  }

  protected preAct(): Promise<void> | void {}

  protected async internalGet<K extends string & keyof T, F extends readonly (string & keyof T)[]>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[number]>> | null> {
    for await (const value of this.internalGetAll(filterAttribute, filterValue, returnAttributes)) {
      return value;
    }
    return null;
  }

  protected async internalExists<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<boolean> {
    for await (const _ of this.internalGetAll(filterAttribute, filterValue, [])) {
      return true;
    }
    return false;
  }

  protected internalUpsert(
    id: T['id'],
    delta: Partial<T>,
    options: UpdateOptions,
  ): Promise<void> | void {
    return this.internalUpdate('id', id, delta, options);
  }

  protected abstract internalAddBatch(records: T[]): Promise<void> | void;

  protected abstract internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
    returnAttributes?: F,
  ):
    | AsyncGenerator<Readonly<Pick<T, F[number]>>, void, undefined>
    | Generator<Readonly<Pick<T, F[number]>>, void, undefined>;

  protected async internalCount<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<number> {
    let count = 0;
    for await (const _ of this.internalGetAll(filterAttribute, filterValue, [])) {
      ++count;
    }
    return count;
  }

  protected abstract internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
    options: UpdateOptions,
  ): Promise<void> | void;

  protected abstract internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<number> | number;
}
