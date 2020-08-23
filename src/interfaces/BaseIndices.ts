import type { Indices } from './Collection';
import type { DBKeys } from './DB';

export default class BaseIndices implements Indices {
  constructor(private readonly keys: DBKeys<any>) {}

  public getIndices(): string[] {
    return ['id', ...Object.keys(this.keys)];
  }

  public getUniqueIndices(): string[] {
    return ['id', ...Object.entries(this.keys).filter(([, o]) => o?.unique).map(([n]) => n)];
  }

  public getCustomIndices(): string[] {
    return Object.keys(this.keys);
  }

  public isIndex(attribute: string): boolean {
    return (
      attribute === 'id' ||
      this.keys[attribute] !== undefined
    );
  }

  public isUniqueIndex(attribute: string): boolean {
    return (
      attribute === 'id' ||
      Boolean(this.keys[attribute]?.unique)
    );
  }
}
