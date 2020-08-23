import type { Collection, UpdateOptions, Indices } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';

type MigrationFuncs<T, ExtraFetchFields extends readonly (keyof T & string)[]> = {
  [K in keyof T]?: (
    stored: T[K] | undefined,
    record: Readonly<Pick<T, K | ExtraFetchFields[-1]>>,
  ) => T[K];
};

class MigratedCollection<
  T extends IDable,
  ExtraFetchFields extends readonly (keyof T & string)[],
> implements Collection<T> {
  public constructor(
    private readonly baseCollection: Collection<T>,
    private readonly migrations: MigrationFuncs<T, ExtraFetchFields>,
    private readonly extraFetchFields?: ExtraFetchFields,
  ) {}

  public async add(entry: T): Promise<void> {
    return this.baseCollection.add(entry);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const raw = await this.baseCollection.get(
      searchAttribute,
      searchValue,
      this.extendAttributes(returnAttributes)!,
    );
    return raw ? this.applyMigration(raw, returnAttributes) : null;
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[],
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const raws = await this.baseCollection.getAll(
      searchAttribute!,
      searchValue as any,
      this.extendAttributes(returnAttributes)!,
    );
    return raws.map((raw) => this.applyMigration(raw, returnAttributes));
  }

  public async update<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    options?: UpdateOptions,
  ): Promise<void> {
    return this.baseCollection.update(searchAttribute, searchValue, update, options);
  }

  public async remove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    return this.baseCollection.remove(searchAttribute, searchValue);
  }

  public get indices(): Indices {
    return this.baseCollection.indices;
  }

  private extendAttributes<
    F extends readonly (keyof T & string)[]
  >(returnAttributes?: F): readonly (keyof T & string)[] | undefined {
    if (returnAttributes && this.extraFetchFields) {
      return [...returnAttributes, ...this.extraFetchFields];
    }
    return returnAttributes;
  }

  private applyMigration<F extends readonly (keyof T & string)[]>(
    raw: Readonly<Pick<T, ExtraFetchFields[-1] | F[-1]>>,
    returnAttributes?: F,
  ): Readonly<Pick<T, F[-1]>> {
    if (returnAttributes && !returnAttributes.some((attr) => this.migrations[attr])) {
      return raw;
    }
    const result: Pick<T, F[-1]> = { ...raw };
    const attrs = returnAttributes || Object.keys(this.migrations);
    attrs.forEach((key: string) => {
      const attr = key as keyof Pick<T, F[-1]>;
      const migration = this.migrations[attr];
      if (migration) {
        result[attr] = migration(raw[attr], raw);
      }
    });
    return result;
  }
}

function migrate<T extends IDable>(
  migrations: MigrationFuncs<T, []>,
  baseCollection: Collection<T>,
): Collection<T>;

function migrate<
  T extends IDable,
  ExtraFetchFields extends readonly (keyof T & string)[],
>(
  extraFetchFields: ExtraFetchFields,
  migrations: MigrationFuncs<T, ExtraFetchFields>,
  baseCollection: Collection<T>,
): Collection<T>;

function migrate<
  T extends IDable,
  ExtraFetchFields extends readonly (keyof T & string)[],
>(
  extraFetchFields: MigrationFuncs<T, []> | ExtraFetchFields,
  migrations: MigrationFuncs<T, ExtraFetchFields> | Collection<T>,
  baseCollection?: Collection<T>,
): Collection<T> {
  if (baseCollection) {
    return new MigratedCollection(
      baseCollection,
      migrations as MigrationFuncs<T, ExtraFetchFields>,
      extraFetchFields as ExtraFetchFields,
    );
  }
  return new MigratedCollection(
    migrations as Collection<T>,
    extraFetchFields as MigrationFuncs<T, []>,
  );
}

export default migrate;
