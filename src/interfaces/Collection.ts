import type { IDable } from './IDable';

export interface KeyOptions {
  unique?: boolean;
}

export interface UpdateOptions {
  upsert?: boolean;
}

export interface Indices<T> {
  getIndices(): (string & keyof T)[];

  getUniqueIndices(): (string & keyof T)[];

  getCustomIndices(): (string & keyof T)[];

  isIndex(attribute: string | keyof T): boolean;

  isUniqueIndex(attribute: string | keyof T): boolean;
}

export interface Collection<T extends IDable> {
  readonly indices: Readonly<Indices<T>>;

  add(entry: T): Promise<void>;

  get<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<Readonly<T> | null>;

  get<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null>;

  getAll(): Promise<Readonly<T>[]>;

  getAll<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<Readonly<T>[]>;

  getAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]>;

  update<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void>;

  remove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number>;
}
