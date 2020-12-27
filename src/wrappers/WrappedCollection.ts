import type { Collection, UpdateOptions, Indices } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
import { makeKeyValue } from '../helpers/safeAccess';

export type Wrapped<T extends IDable, Fields extends keyof T, FieldStorage> = {
  [K in keyof T]: K extends 'id' ? T[K] : K extends Fields ? FieldStorage : T[K];
};

export interface Wrapper<T extends IDable, K extends keyof T, FieldStorage, CustomData> {
  wrap: (
    key: K,
    value: T[K],
    processed: CustomData,
  ) => Promise<FieldStorage> | FieldStorage;

  unwrap: (
    key: K,
    value: FieldStorage,
    processed: CustomData,
  ) => Promise<T[K]> | T[K];

  preWrap?: (
    record: Readonly<Partial<T>>,
  ) => Promise<CustomData> | CustomData;

  preUnwrap?: (
    record: Readonly<Partial<Wrapped<T, K, FieldStorage>>>,
  ) => Promise<CustomData> | CustomData;

  preRemove?: (
    record: Readonly<Pick<Wrapped<T, K, FieldStorage>, 'id'>>,
  ) => Promise<void> | void;
}

function hasAnyField(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields
    .some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export default class WrappedCollection<
  T extends IDable,
  WF extends readonly (keyof Omit<T, 'id'> & string)[],
  FieldStorage,
  E,
  Inner extends Wrapped<T, WF[-1], FieldStorage> = Wrapped<T, WF[-1], FieldStorage>
> implements Collection<T> {
  public constructor(
    private readonly baseCollection: Collection<Inner>,
    private readonly fields: WF,
    private readonly wrapper: Wrapper<T, WF[-1], FieldStorage, E>,
  ) {
    fields.forEach((field) => {
      if (baseCollection.indices.isUniqueIndex(field)) {
        throw new Error(`Cannot wrap unique index ${field}`);
      }
    });
  }

  public async add(entry: T): Promise<void> {
    return this.baseCollection.add(await this.wrapAll(entry));
  }

  public async get<
    K extends keyof T & keyof Inner & string,
    F extends readonly (string & keyof T)[]
  >(
    key: K,
    value: T[K] & Inner[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot get by wrapped value');
    }
    const raw = await this.baseCollection.get(key, value, fields!);
    return raw ? this.unwrapAll(raw, makeKeyValue(key, value)) : null;
  }

  public async getAll<
    K extends keyof T & keyof Inner & string,
    F extends readonly (string & keyof T)[]
  >(
    key?: K,
    value?: T[K] & Inner[NonNullable<K>],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (key !== undefined && this.fields.includes(key as any)) {
      throw new Error('Cannot get by wrapped value');
    }
    const raw = await this.baseCollection.getAll(key!, value!, fields!);
    const extra = (key !== undefined) ? makeKeyValue(key, value) : undefined;
    return Promise.all(raw.map((v) => this.unwrapAll(v, extra)));
  }

  public async update<K extends keyof T & keyof Inner & string>(
    key: K,
    value: T[K] & Inner[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot update by wrapped value');
    }
    const converted = await this.wrapAll(update, makeKeyValue(key, value));
    return this.baseCollection.update(key, value, converted, options);
  }

  public async remove<K extends string & keyof T>(
    key: K,
    value: T[K] & Inner[K],
  ): Promise<number> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot remove by wrapped value');
    }
    if (!this.wrapper.preRemove) {
      return this.baseCollection.remove(key, value);
    }

    const items = await this.baseCollection.getAll(key, value, ['id']);
    await Promise.all(items.map(async (item) => {
      await this.wrapper.preRemove!(item);
      await this.baseCollection.remove('id', item.id);
    }));
    return items.length;
  }

  public get indices(): Indices<T> {
    return this.baseCollection.indices as Indices<T>;
  }

  private async wrapAll(
    v: Readonly<T>,
    extra?: Record<string, unknown>,
  ): Promise<Inner>;

  private async wrapAll(
    v: Readonly<Partial<T>>,
    extra?: Record<string, unknown>,
  ): Promise<Partial<Inner>>;

  private async wrapAll(
    v: Readonly<Partial<T>>,
    extra?: Record<string, unknown>,
  ): Promise<Partial<Inner>> {
    let processed: E;
    if (this.wrapper.preWrap && hasAnyField(v, this.fields)) {
      const allFields = extra ? { ...extra, ...v } : v;
      processed = await this.wrapper.preWrap(allFields);
    }
    const converted = { ...v } as any;
    await Promise.all(this.fields.map(async (k) => {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        // this is safe because converted is initialised from v, and k is in v
        converted[k] = await this.wrapper.wrap(k, (v as any)[k], processed);
      }
    }));
    return converted;
  }

  private async unwrapAll(
    v: Readonly<Inner>,
    extra?: Record<string, unknown>,
  ): Promise<T>;

  private async unwrapAll<K extends keyof T>(
    v: Readonly<Pick<Inner, K>>,
    extra?: Record<string, unknown>,
  ): Promise<Pick<T, K>>;

  private async unwrapAll<K extends keyof T>(
    v: Readonly<Pick<Inner, K>>,
    extra?: Record<string, unknown>,
  ): Promise<Pick<T, K>> {
    let processed: E;
    if (this.wrapper.preUnwrap && hasAnyField(v, this.fields)) {
      const allFields = extra ? { ...extra, ...v } : v;
      processed = await this.wrapper.preUnwrap(allFields as any);
    }
    const converted = { ...v } as any;
    await Promise.all(this.fields.map(async (k) => {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        // this is safe because converted is initialised from v, and k is in v
        converted[k] = await this.wrapper.unwrap(k, (v as any)[k], processed);
      }
    }));
    return converted;
  }
}
