import type { Indices, KeyOptions } from './Collection.mts';
import type { IDable } from './IDable.mts';
import type { DBKeys } from './DB.mts';

export class BaseIndices<T extends IDable> implements Indices<T> {
  /** @internal */ private readonly _keys: Map<string | keyof T, KeyOptions>;
  /** @internal */ private readonly _customIndices: (string & keyof T)[];
  /** @internal */ private readonly _uniqueIndices: (string & keyof T)[];

  constructor(keys: DBKeys<T>) {
    this._keys = new Map([['id', { unique: true }], ...Object.entries(keys).filter(([, v]) => v)]);
    this._customIndices = Object.keys(keys) as (string & keyof T)[];
    this._uniqueIndices = ['id', ...this._customIndices.filter((k) => this._keys.get(k)?.unique)];
  }

  getIndices(): readonly (string & keyof T)[] {
    return ['id', ...this._customIndices];
  }

  getUniqueIndices(): readonly (string & keyof T)[] {
    return this._uniqueIndices;
  }

  getCustomIndices(): readonly (string & keyof T)[] {
    return this._customIndices;
  }

  isIndex(attribute: string | keyof T): boolean {
    return this._keys.has(attribute);
  }

  isUniqueIndex(attribute: string | keyof T): boolean {
    return Boolean(this._keys.get(attribute)?.unique);
  }
}
