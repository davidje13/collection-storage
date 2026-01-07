import type { Collection, KeyOptions } from './Collection.mts';
import type { IDable } from './IDable.mts';

export type DBKeys<T> = {
  [K in keyof T]?: KeyOptions;
};

export interface DB {
  getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;

  close(): Promise<void>;

  readonly closed: boolean;
}
