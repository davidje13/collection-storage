export interface KeyOptions {
  unique?: boolean;
}

export interface UpdateOptions {
  upsert?: boolean;
}

export interface Indices<T> {
  getIndices(): readonly (string & keyof T)[];

  getUniqueIndices(): readonly (string & keyof T)[];

  getCustomIndices(): readonly (string & keyof T)[];

  isIndex(attribute: string | keyof T): boolean;

  isUniqueIndex(attribute: string | keyof T): boolean;
}

export interface Collection<T> {
  readonly name: string;
  readonly indices: Readonly<Indices<T>>;
  readonly closed: boolean;

  add(...records: T[]): Promise<void>;

  all(): Filtered<T>;

  where<K extends string & keyof T>(attribute: K, value: T[K]): Filtered<T>;
}

export interface Filtered<T> extends EntryReader<T> {
  count(): Promise<number>;
  exists(): Promise<boolean>;
  remove(): Promise<number>;
  update(delta: Partial<T>, options?: UpdateOptions): Promise<void>;
  attrs<F extends readonly (string & keyof T)[]>(attributes: F): EntryReader<Pick<T, F[number]>>;
}

export interface EntryReader<T> {
  get(): Promise<Readonly<T> | null>;
  values(): AsyncGenerator<Readonly<T>, void, undefined>;
}
