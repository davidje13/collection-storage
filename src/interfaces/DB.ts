import type { Collection, KeyOptions } from './Collection';
import type { IDable } from './IDable';

export type DBKeys<T> = {
  [K in keyof T & string]?: KeyOptions;
};

export interface DB {
  getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): Collection<T>;

  close(): Promise<void> | void;
}
