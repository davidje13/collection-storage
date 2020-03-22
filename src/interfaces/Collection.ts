import type { IDable } from './IDable';

export interface KeyOptions {
  unique?: boolean;
}

export interface UpdateOptions {
  upsert?: boolean;
}

export interface Collection<T extends IDable> {
  add(entry: T): Promise<void>;

  get<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<Readonly<T> | null>;

  get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null>;

  getAll(): Promise<Readonly<T>[]>;

  getAll<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<Readonly<T>[]>;

  getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[],
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  update<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void>;

  remove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number>;
}
