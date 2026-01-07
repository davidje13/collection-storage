import type { Collection, Filtered } from '../interfaces/Collection.mts';
import type { IDable } from '../interfaces/IDable.mts';
import { safeGet } from '../helpers/safeAccess.mts';

type MigrationFunc = (stored: unknown | undefined, record: Readonly<any>) => any;

type MigrationFuncs<T, ExtraFetchAttributes extends readonly (string & keyof T)[]> = {
  [K in keyof T]?: (
    stored: T[K] | undefined,
    record: Readonly<Pick<T, K | ExtraFetchAttributes[number]>>,
  ) => T[K];
};

class MigratedCollection<
  T extends IDable,
  ExtraFetchAttributes extends readonly (string & keyof T)[],
> implements Collection<T> {
  /** @internal */ private readonly _baseCollection: Collection<T>;
  /** @internal */ private readonly _extraFetchAttributes: ExtraFetchAttributes | undefined;
  /** @internal */ private readonly _migrations: Map<string & keyof T, MigrationFunc>;

  constructor(
    baseCollection: Collection<T>,
    migrations: MigrationFuncs<T, ExtraFetchAttributes>,
    extraFetchAttributes?: ExtraFetchAttributes,
  ) {
    this._baseCollection = baseCollection;
    this._migrations = new Map(Object.entries(migrations)) as Map<string & keyof T, MigrationFunc>;
    this._extraFetchAttributes = extraFetchAttributes;
  }

  get name() {
    return this._baseCollection.name;
  }

  get indices() {
    return this._baseCollection.indices;
  }

  get closed() {
    return this._baseCollection.closed;
  }

  add(...entries: T[]) {
    return this._baseCollection.add(...entries);
  }

  /** @internal */ private _wrapFilter(baseFilter: Filtered<T>): Filtered<T> {
    const self = this;
    return {
      ...baseFilter,

      async get() {
        const record = await baseFilter.get();
        return record === null ? null : (self._applyMigration(record) as T);
      },
      async *values() {
        for await (const record of baseFilter.values()) {
          yield self._applyMigration(record) as T;
        }
      },
      attrs<F extends readonly (string & keyof T)[]>(attributes: F) {
        return {
          async get() {
            if (!attributes.some((attr) => self._migrations.has(attr))) {
              return baseFilter.attrs(attributes).get();
            }
            const record = await baseFilter.attrs(self._extendAttributes(attributes)).get();
            return record === null ? null : self._applyMigration(record, attributes);
          },
          async *values() {
            if (!attributes.some((attr) => self._migrations.has(attr))) {
              yield* baseFilter.attrs(attributes).values();
              return;
            }
            for await (const record of baseFilter
              .attrs(self._extendAttributes(attributes))
              .values()) {
              yield self._applyMigration(record, attributes);
            }
          },
        };
      },
    };
  }

  all(): Filtered<T> {
    return this._wrapFilter(this._baseCollection.all());
  }

  where<K extends string & keyof T>(attribute: K, value: T[K]): Filtered<T> {
    return this._wrapFilter(this._baseCollection.where(attribute, value));
  }

  /** @internal */ private _extendAttributes<F extends readonly (string & keyof T)[]>(
    attributes: F,
  ): readonly (string & keyof T)[] {
    if (this._extraFetchAttributes) {
      return [...attributes, ...this._extraFetchAttributes];
    }
    return attributes;
  }

  /** @internal */ private _applyMigration<F extends readonly (string & keyof T)[]>(
    raw: Readonly<Pick<T, ExtraFetchAttributes[number] | F[number]>>,
    attributes?: F,
  ): Readonly<Pick<T, F[number]>> {
    if (attributes) {
      const result = {} as Pick<T, F[number]>;
      for (const attr of attributes) {
        const migration = this._migrations.get(attr);
        const original = safeGet(raw, attr);
        result[attr] = migration ? migration(original, raw) : original;
      }
      return result;
    } else {
      const result: Pick<T, F[number]> = { ...raw };
      for (const [attr, migration] of this._migrations) {
        result[attr] = migration(safeGet(raw, attr), raw);
      }
      return result;
    }
  }
}

export function migrate<T extends IDable>(
  migrations: MigrationFuncs<T, []>,
  baseCollection: Collection<T>,
): Collection<T>;

export function migrate<
  T extends IDable,
  ExtraFetchAttributes extends readonly (string & keyof T)[],
>(
  extraFetchAttributes: ExtraFetchAttributes,
  migrations: MigrationFuncs<T, ExtraFetchAttributes>,
  baseCollection: Collection<T>,
): Collection<T>;

export function migrate<
  T extends IDable,
  ExtraFetchAttributes extends readonly (string & keyof T)[],
>(
  extraFetchAttributes: MigrationFuncs<T, []> | ExtraFetchAttributes,
  migrations: MigrationFuncs<T, ExtraFetchAttributes> | Collection<T>,
  baseCollection?: Collection<T>,
): Collection<T> {
  if (baseCollection) {
    return new MigratedCollection(
      baseCollection,
      migrations as MigrationFuncs<T, ExtraFetchAttributes>,
      extraFetchAttributes as ExtraFetchAttributes,
    );
  }
  return new MigratedCollection(
    migrations as Collection<T>,
    extraFetchAttributes as MigrationFuncs<T, []>,
  );
}
