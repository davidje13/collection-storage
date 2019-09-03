import IDable from '../interfaces/IDable';
import Collection, { UpdateOptions } from '../interfaces/Collection';

export type Wrapped<T extends IDable, WF extends keyof T, W> = {
  [K in keyof T]: K extends 'id' ? T[K] : K extends WF ? W : T[K];
};

export interface Wrapper<T extends IDable, K extends keyof T, W, E> {
  wrap: (
    key: K,
    value: T[K],
    processed: E,
  ) => Promise<W> | W;

  unwrap: (
    key: K,
    value: W,
    processed: E,
  ) => Promise<T[K]> | T[K];

  preWrap?: (
    record: Readonly<Partial<T>>,
  ) => Promise<E> | E;

  preUnwrap?: (
    record: Readonly<Partial<Wrapped<T, K, W>>>,
  ) => Promise<E> | E;

  preRemove?: (
    record: Readonly<Pick<Wrapped<T, K, W>, 'id'>>,
  ) => Promise<void> | void;
}

function hasAnyField(value: object, fields: readonly string[]): boolean {
  return fields
    .some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export default class WrappedCollection<
  T extends IDable,
  WF extends readonly (keyof Omit<T, 'id'> & string)[],
  W,
  E,
  Inner extends Wrapped<T, WF[-1], W> = Wrapped<T, WF[-1], W>
> implements Collection<T> {
  public constructor(
    private readonly baseCollection: Collection<Inner>,
    private readonly fields: WF,
    private readonly wrapper: Wrapper<T, WF[-1], W, E>,
  ) {}

  public async add(entry: T): Promise<void> {
    return this.baseCollection.add(await this.wrapAll(entry));
  }

  public async get<
    K extends keyof T & keyof Inner & string,
    F extends readonly (keyof T & string)[]
  >(
    key: K,
    value: T[K] & Inner[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot get by encrypted value');
    }
    const raw = await this.baseCollection.get(key, value, fields!);
    return raw ? this.unwrapAll(raw) : null;
  }

  public async getAll<
    K extends keyof T & keyof Inner & string,
    F extends readonly (keyof T & string)[]
  >(
    key?: K,
    value?: T[K] & Inner[NonNullable<K>],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (key !== undefined && this.fields.includes(key as any)) {
      throw new Error('Cannot get by encrypted value');
    }
    const raw = await this.baseCollection.getAll(key!, value!, fields!);
    return Promise.all(raw.map((v) => this.unwrapAll(v)));
  }

  public async update<K extends keyof T & keyof Inner & string>(
    key: K,
    value: T[K] & Inner[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot update by encrypted value');
    }
    const converted = await this.wrapAll(update);
    return this.baseCollection.update(key, value, converted, options);
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K] & Inner[K],
  ): Promise<number> {
    if (this.fields.includes(key as any)) {
      throw new Error('Cannot remove by encrypted value');
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

  private async wrapAll(v: Readonly<T>): Promise<Inner>;

  private async wrapAll(
    v: Readonly<Partial<T>>,
  ): Promise<Partial<Inner>>;

  private async wrapAll(
    v: Readonly<Partial<T>>,
  ): Promise<Partial<Inner>> {
    let processed: E;
    if (this.wrapper.preWrap && hasAnyField(v, this.fields)) {
      processed = await this.wrapper.preWrap(v);
    }
    const converted = Object.assign({}, v) as any;
    await Promise.all(this.fields.map(async (k) => {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        converted[k] = await this.wrapper.wrap(k, (v as any)[k], processed);
      }
    }));
    return converted;
  }

  private async unwrapAll(v: Readonly<Inner>): Promise<T>;

  private async unwrapAll<K extends keyof T>(
    v: Readonly<Pick<Inner, K>>,
  ): Promise<Pick<T, K>>;

  private async unwrapAll<K extends keyof T>(
    v: Readonly<Pick<Inner, K>>,
  ): Promise<Pick<T, K>> {
    let processed: E;
    if (this.wrapper.preUnwrap && hasAnyField(v, this.fields)) {
      processed = await this.wrapper.preUnwrap(v as any);
    }
    const converted = Object.assign({}, v) as any;
    await Promise.all(this.fields.map(async (k) => {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        converted[k] = await this.wrapper.unwrap(k, (v as any)[k], processed);
      }
    }));
    return converted;
  }
}
