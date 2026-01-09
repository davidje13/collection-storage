import type { Collection, UpdateOptions, Indices, Filtered } from '../interfaces/Collection.mts';
import type { IDable } from '../interfaces/IDable.mts';
import { makeKeyValue } from '../helpers/safeAccess.mts';

export type Wrapped<T extends IDable, Fields extends keyof T, Storage> = {
  [K in keyof T]: K extends 'id' ? T[K] : K extends Fields ? Storage : T[K];
};

export interface Wrapper<T extends IDable, K extends keyof T, Storage, CustomData> {
  wrap: (attribute: K, value: T[K], processed: CustomData) => Promise<Storage> | Storage;

  unwrap: (attribute: K, value: Storage, processed: CustomData) => Promise<T[K]> | T[K];

  preWrap?: (record: Readonly<Partial<T>>) => Promise<CustomData> | CustomData;

  preUnwrap?: (
    record: Readonly<Partial<Wrapped<T, K, Storage>>>,
  ) => Promise<CustomData> | CustomData;

  preRemove?: (record: Readonly<Pick<Wrapped<T, K, Storage>, 'id'>>) => Promise<void> | void;
}

function hasAnyAttribute(value: Record<string, unknown>, attributes: readonly string[]): boolean {
  return attributes.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export class WrappedCollection<
  T extends IDable,
  WF extends readonly (keyof Omit<T, 'id'> & string)[],
  Storage,
  E,
  Inner extends Wrapped<T, WF[number], Storage> = Wrapped<T, WF[number], Storage>,
> implements Collection<T> {
  /** @internal */ private readonly _baseCollection: Collection<Inner>;
  /** @internal */ private readonly _attributes: WF;
  /** @internal */ private readonly _wrapper: Wrapper<T, WF[number], Storage, E>;

  constructor(
    baseCollection: Collection<Inner>,
    attributes: WF,
    wrapper: Wrapper<T, WF[number], Storage, E>,
  ) {
    this._baseCollection = baseCollection;
    this._attributes = attributes;
    this._wrapper = wrapper;
    for (const attribute of attributes) {
      if (baseCollection.indices.isUniqueIndex(attribute)) {
        throw new Error(`Cannot wrap unique index ${attribute}`);
      }
    }
  }

  get name() {
    return this._baseCollection.name;
  }

  get indices() {
    return this._baseCollection.indices as Indices<T>;
  }

  get closed() {
    return this._baseCollection.closed;
  }

  async add(...records: T[]) {
    return this._baseCollection.add(
      ...(await Promise.all(records.map((record) => this._wrapAll(record)))),
    );
  }

  /** @internal */ private _wrapFilter(
    baseFilter: Filtered<Inner>,
    extra: Record<string, unknown> | undefined,
  ): Filtered<T> {
    const self = this;
    return {
      ...baseFilter,

      async get() {
        const record = await baseFilter.get();
        return record === null ? null : self._unwrapAll(record, extra);
      },
      async *values() {
        for await (const record of baseFilter.values()) {
          yield await self._unwrapAll(record, extra);
        }
      },
      async remove() {
        if (!self._wrapper.preRemove) {
          return baseFilter.remove();
        }

        let n = 0;
        for await (const record of baseFilter.attrs(['id']).values()) {
          await self._wrapper.preRemove!(record);
          await self._baseCollection.where('id', record.id).remove();
          ++n;
        }
        return n;
      },
      async update(delta: Partial<T>, options?: UpdateOptions) {
        const converted = await self._wrapAll(delta, extra);
        return baseFilter.update(converted, options);
      },
      attrs<F extends readonly (string & keyof T)[]>(attributes: F) {
        return {
          async get() {
            const record = await baseFilter.attrs(attributes).get();
            return record === null ? null : self._unwrapAll(record, extra);
          },
          async *values() {
            for await (const record of baseFilter.attrs(attributes).values()) {
              yield await self._unwrapAll(record, extra);
            }
          },
        };
      },
    };
  }

  all(): Filtered<T> {
    return this._wrapFilter(this._baseCollection.all(), undefined);
  }

  where<K extends string & keyof T>(attribute: K, value: T[K]): Filtered<T> {
    if (this._attributes.includes(attribute as any)) {
      throw new Error('Cannot filter by wrapped value');
    }

    return this._wrapFilter(
      this._baseCollection.where(attribute, value as unknown as Inner[K]),
      makeKeyValue(attribute, value),
    );
  }

  removeAllAndDestroy() {
    return this._baseCollection.removeAllAndDestroy();
  }

  /** @internal */ private async _wrapAll(
    record: Readonly<T>,
    extra?: Record<string, unknown>,
  ): Promise<Inner>;

  /** @internal */ private async _wrapAll(
    record: Readonly<Partial<T>>,
    extra?: Record<string, unknown>,
  ): Promise<Partial<Inner>>;

  /** @internal */ private async _wrapAll(
    record: Readonly<Partial<T>>,
    extra?: Record<string, unknown>,
  ): Promise<Partial<Inner>> {
    if (!hasAnyAttribute(record, this._attributes)) {
      return record as Partial<Inner>;
    }
    let processed: E;
    if (this._wrapper.preWrap) {
      const allAttributes = extra ? { ...extra, ...record } : record;
      processed = await this._wrapper.preWrap(allAttributes);
    }
    const converted = { ...record } as any;
    await Promise.all(
      this._attributes.map(async (attr) => {
        if (Object.prototype.hasOwnProperty.call(record, attr)) {
          // this is safe because converted is initialised from record, and attr is in record
          converted[attr] = await this._wrapper.wrap(attr, (record as any)[attr], processed);
        }
      }),
    );
    return converted;
  }

  /** @internal */ private async _unwrapAll(
    record: Readonly<Inner>,
    extra?: Record<string, unknown>,
  ): Promise<T>;

  /** @internal */ private async _unwrapAll<K extends keyof T>(
    record: Readonly<Pick<Inner, K>>,
    extra?: Record<string, unknown>,
  ): Promise<Pick<T, K>>;

  /** @internal */ private async _unwrapAll<K extends keyof T>(
    record: Readonly<Pick<Inner, K>>,
    extra?: Record<string, unknown>,
  ): Promise<Pick<T, K>> {
    if (!hasAnyAttribute(record, this._attributes)) {
      return record as unknown as Pick<T, K>;
    }
    let processed: E;
    if (this._wrapper.preUnwrap) {
      const allAttributes = extra ? { ...extra, ...record } : record;
      processed = await this._wrapper.preUnwrap(allAttributes as any);
    }
    const converted = { ...record } as any;
    await Promise.all(
      this._attributes.map(async (attr) => {
        if (Object.prototype.hasOwnProperty.call(record, attr)) {
          // this is safe because converted is initialised from record, and attr is in record
          converted[attr] = await this._wrapper.unwrap(attr, (record as any)[attr], processed);
        }
      }),
    );
    return converted;
  }
}
