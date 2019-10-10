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

  public get<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<Readonly<T> | null>;

  public get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    key: K,
    value: T[K],
    fields: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null>;

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (!this.isIndexed(keyName)) {
      throw new Error(`No index for ${keyName}`);
    }
    await this.preAct();
    return this.internalGet(keyName, key, fields);
  }

  public getAll(): Promise<Readonly<T>[]>;

  public getAll<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<Readonly<T>[]>;

  public getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[],
  >(
    key: K,
    value: T[K],
    fields: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (keyName && !this.isIndexed(keyName)) {
      throw new Error(`No index for ${keyName}`);
    }
    await this.preAct();
    return this.internalGetAll(keyName, key, fields);
  }

  public async update<K extends keyof T & string>(
    key: K,
    value: T[K],
    update: Partial<T>,
    options: UpdateOptions = {},
  ): Promise<void> {
    if (key === 'id' && update.id !== undefined && update.id !== value) {
      throw new Error('Cannot update id');
    }
    if (options.upsert) {
      if (key !== 'id') {
        throw new Error(`Can only upsert by ID, not ${key}`);
      }
      await this.preAct();
      return this.internalUpsert(value as T['id'], update, options);
    }
    if (!this.isIndexed(key)) {
      throw new Error(`No index for ${key}`);
    }
    if (
      !this.isIndexUnique(key) &&
      Object.keys(update).some((k) => this.isIndexUnique(k))
    ) {
      throw new Error('duplicate');
    }

    await this.preAct();
    return this.internalUpdate(key, value, update, options);
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    if (!this.isIndexed(key)) {
      throw new Error(`No index for ${key}`);
    }
    await this.preAct();
    return this.internalRemove(key, value);
  }

  protected isIndexed(key: string): boolean {
    return key === 'id' || (this.keys[key as keyof DBKeys<T>] !== undefined);
  }

  protected isIndexUnique(key: string): boolean {
    const keyOptions = this.keys[key as keyof DBKeys<T>];
    return key === 'id' || Boolean(keyOptions && keyOptions.unique);
  }

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-empty-function
  protected preAct(): Promise<void> | void {}

  protected async internalGet<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const all = await this.internalGetAll(keyName, key, fields);
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
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  protected abstract internalUpdate<K extends keyof T & string>(
    key: K,
    value: T[K],
    update: Partial<T>,
    options: UpdateOptions,
  ): Promise<void>;

  protected abstract internalRemove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number>;
}
