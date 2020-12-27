import type { Indices, KeyOptions } from './Collection';
import type { IDable } from './IDable';
import type { DBKeys } from './DB';

export default class BaseIndices<T extends IDable> implements Indices<T> {
  private readonly keys: Map<string & keyof T, KeyOptions>;

  constructor(keys: DBKeys<T>) {
    this.keys = new Map<any, any>(Object.entries(keys).filter(([, v]) => v));
  }

  public getIndices(): (string & keyof T)[] {
    return ['id', ...this.keys.keys()];
  }

  public getUniqueIndices(): (string & keyof T)[] {
    return ['id', ...[...this.keys.entries()].filter(([, o]) => o?.unique).map(([n]) => n)];
  }

  public getCustomIndices(): (string & keyof T)[] {
    return [...this.keys.keys()];
  }

  public isIndex(attribute: string | keyof T): boolean {
    return (attribute === 'id' || this.keys.has(attribute as (string & keyof T)));
  }

  public isUniqueIndex(attribute: string | keyof T): boolean {
    return Boolean(
      attribute === 'id' ||
      this.keys.get(attribute as (string & keyof T))?.unique,
    );
  }
}
