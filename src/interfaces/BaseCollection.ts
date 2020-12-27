import type { Collection, UpdateOptions, Indices } from './Collection';
import type { IDable } from './IDable';
import type { DBKeys } from './DB';
import BaseIndices from './BaseIndices';

export default abstract class BaseCollection<T extends IDable> implements Collection<T> {
  public readonly indices: Readonly<Indices<T>>;

  // actually read publicly by BaseDB but we don't want this to be a user-accessible property
  protected internalReady?: () => Promise<void>;

  private innerPreAct: () => Promise<void> | void;

  protected constructor(keys: DBKeys<T>) {
    this.innerPreAct = this.preAct.bind(this);
    this.indices = new BaseIndices(keys);
  }

  public async add(entry: T): Promise<void> {
    await this.innerPreAct();
    return this.internalAdd(entry);
  }

  public async get<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (!this.indices.isIndex(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.innerPreAct();
    return this.internalGet(searchAttribute, searchValue, returnAttributes);
  }

  public async getAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (searchAttribute && !this.indices.isIndex(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.innerPreAct();
    return this.internalGetAll(searchAttribute, searchValue, returnAttributes);
  }

  public async update<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options: UpdateOptions = {},
  ): Promise<void> {
    if (searchAttribute === 'id' && update.id !== undefined && update.id !== searchValue) {
      throw new Error('Cannot update ID');
    }
    if (options.upsert) {
      if (searchAttribute !== 'id') {
        throw new Error(`Can only upsert by ID, not ${searchAttribute}`);
      }
      let withoutId = update;
      if (Object.prototype.hasOwnProperty.call(update, 'id')) {
        withoutId = { ...update };
        delete withoutId.id;
      }
      await this.innerPreAct();
      return this.internalUpsert(searchValue as T['id'], withoutId, options);
    }
    if (!this.indices.isIndex(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    if (
      !this.indices.isUniqueIndex(searchAttribute) &&
      Object.keys(update).some((k) => this.indices.isUniqueIndex(k))
    ) {
      throw new Error('duplicate');
    }

    await this.innerPreAct();
    return this.internalUpdate(searchAttribute, searchValue, update, options);
  }

  public async remove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    if (!this.indices.isIndex(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.innerPreAct();
    return this.internalRemove(searchAttribute, searchValue);
  }

  // Subclass constructors can call this with a promise that will resolve when
  // they are ready to be used. BaseCollection will automatically ensure that
  // other interactions are queued until this promise resolves.
  // (this call will always succeed; you can safely ignore the promise returned)
  protected async initAsync(wait: Promise<unknown>): Promise<void> {
    const pending: [() => void, (e: Error) => void][] = [];
    const addPending = (): Promise<void> => new Promise((resolve, reject) => {
      pending.push([resolve, reject]);
    });
    this.internalReady = addPending;
    this.innerPreAct = async (): Promise<void> => {
      await addPending();
      return this.preAct();
    };
    try {
      await wait;
    } catch (e) {
      this.internalReady = (): Promise<void> => Promise.reject(e);
      this.innerPreAct = (): void => { throw e; };
      pending.forEach((f) => f[1](e));
      return;
    }
    this.internalReady = undefined;
    this.innerPreAct = this.preAct.bind(this);
    pending.forEach((f) => f[0]());
  }

  // eslint-disable-next-line class-methods-use-this
  protected preAct(): Promise<void> | void {}

  protected async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const all = await this.internalGetAll(searchAttribute, searchValue, returnAttributes);
    return all[0] ?? null;
  }

  protected internalUpsert(
    id: T['id'],
    update: Partial<T>,
    options: UpdateOptions,
  ): Promise<void> {
    return this.internalUpdate('id', id, update, options);
  }

  protected abstract internalAdd(entry: T): Promise<void>;

  protected abstract internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  protected abstract internalUpdate<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options: UpdateOptions,
  ): Promise<void>;

  protected abstract internalRemove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number>;
}
