import type { Indices, KeyOptions } from './Collection.mts';
import type { IDable } from './IDable.mts';
import type { DBKeys } from './DB.mts';

export class BaseIndices<T extends IDable> implements Indices<T> {
  // Note: private properties & methods in this class must not be mangled by terser,
  // as it can lead to name collisions if sub-classed and (separately) mangled

  /** @internal */ private readonly csKeys: Map<string | keyof T, KeyOptions>;
  /** @internal */ private readonly csCustom: (string & keyof T)[];
  /** @internal */ private readonly csUnique: (string & keyof T)[];

  constructor(keys: DBKeys<T>) {
    this.csKeys = new Map([['id', { unique: true }], ...Object.entries(keys).filter(([, v]) => v)]);
    this.csCustom = Object.keys(keys) as (string & keyof T)[];
    this.csUnique = ['id', ...this.csCustom.filter((k) => this.csKeys.get(k)?.unique)];
  }

  getIndices(): readonly (string & keyof T)[] {
    return ['id', ...this.csCustom];
  }

  getUniqueIndices(): readonly (string & keyof T)[] {
    return this.csUnique;
  }

  getCustomIndices(): readonly (string & keyof T)[] {
    return this.csCustom;
  }

  isIndex(attribute: string | keyof T): boolean {
    return this.csKeys.has(attribute);
  }

  isUniqueIndex(attribute: string | keyof T): boolean {
    return Boolean(this.csKeys.get(attribute)?.unique);
  }
}
