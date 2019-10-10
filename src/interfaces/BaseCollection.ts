import Collection, { UpdateOptions } from './Collection';
import IDable from './IDable';
import { DBKeys } from './DB';

export default abstract class BaseCollection<T extends IDable> implements Collection<T> {
  protected constructor(
    protected readonly keys: DBKeys<T>,
  ) {}

  public async add(entry: T): Promise<void> {
    await this.preAct();
    return this.internalAdd(entry);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (!this.isIndexed(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.preAct();
    return this.internalGet(searchAttribute, searchValue, returnAttributes);
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (searchAttribute && !this.isIndexed(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.preAct();
    return this.internalGetAll(searchAttribute, searchValue, returnAttributes);
  }

  public async update<K extends keyof T & string>(
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
      await this.preAct();
      let withoutId = update;
      if (Object.prototype.hasOwnProperty.call(update, 'id')) {
        withoutId = { ...update };
        delete withoutId.id;
      }
      return this.internalUpsert(searchValue as T['id'], withoutId, options);
    }
    if (!this.isIndexed(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    if (
      !this.isIndexUnique(searchAttribute) &&
      Object.keys(update).some((k) => this.isIndexUnique(k))
    ) {
      throw new Error('duplicate');
    }

    await this.preAct();
    return this.internalUpdate(searchAttribute, searchValue, update, options);
  }

  public async remove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    if (!this.isIndexed(searchAttribute)) {
      throw new Error(`No index for ${searchAttribute}`);
    }
    await this.preAct();
    return this.internalRemove(searchAttribute, searchValue);
  }

  protected isIndexed(attribute: string): boolean {
    return (
      attribute === 'id' ||
      this.keys[attribute as keyof DBKeys<T>] !== undefined
    );
  }

  protected isIndexUnique(attribute: string): boolean {
    const keyOptions = this.keys[attribute as keyof DBKeys<T>];
    return (
      attribute === 'id' ||
      Boolean(keyOptions && keyOptions.unique)
    );
  }

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-empty-function
  protected preAct(): Promise<void> | void {}

  protected async internalGet<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const all = await this.internalGetAll(searchAttribute, searchValue, returnAttributes);
    return (all.length > 0) ? all[0] : null;
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
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  protected abstract internalUpdate<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options: UpdateOptions,
  ): Promise<void>;

  protected abstract internalRemove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number>;
}
