declare module 'collection-storage' {
  interface UpdateOptions {
    upsert?: boolean;
  }

  export interface Collection<T> {
    add(entry: T): Promise<void>;

    get(key: string, value: string): Promise<Readonly<T> | null>;
    get<K extends readonly (keyof T)[]>(
      key: string,
      value: string,
      fields: K,
    ): Promise<Readonly<Pick<T, K[-1]>> | null>;

    getAll(): Promise<Readonly<T>[]>;
    getAll(key: string, value: string): Promise<Readonly<T>[]>;
    getAll<K extends readonly (keyof T)[]>(
      key: string,
      value: string,
      fields: K,
    ): Promise<Readonly<Pick<T, K[-1]>>[]>;

    update(
      key: string,
      value: string,
      update: Partial<T>,
      options?: UpdateOptions,
    ): Promise<void>;
  }

  interface KeyOptions {
    unique?: boolean;
  }

  export interface DB {
    getCollection<T>(
      name: string,
      keys?: { [K in keyof T]?: KeyOptions },
    ): Collection<T>;
  }

  export class MemoryDb implements DB {
    public static connect(url: string): MemoryDb;

    public constructor(options?: {
      simulatedLatency?: number;
    });

    public getCollection<T>(
      name: string,
      keys?: { [K in keyof T]?: KeyOptions },
    ): Collection<T>;
  }

  export class MongoDb implements DB {
    public static connect(url: string): Promise<MongoDb>;

    public getCollection<T>(
      name: string,
      keys?: { [K in keyof T]?: KeyOptions },
    ): Collection<T>;
  }

  export default class CollectionStorage {
    public static connect(url: string): Promise<DB>;
  }
}
