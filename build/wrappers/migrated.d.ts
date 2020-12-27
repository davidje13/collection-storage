import type { Collection } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
declare type MigrationFuncs<T, ExtraFetchFields extends readonly (string & keyof T)[]> = {
    [K in keyof T]?: (stored: T[K] | undefined, record: Readonly<Pick<T, K | ExtraFetchFields[-1]>>) => T[K];
};
declare function migrate<T extends IDable>(migrations: MigrationFuncs<T, []>, baseCollection: Collection<T>): Collection<T>;
declare function migrate<T extends IDable, ExtraFetchFields extends readonly (string & keyof T)[]>(extraFetchFields: ExtraFetchFields, migrations: MigrationFuncs<T, ExtraFetchFields>, baseCollection: Collection<T>): Collection<T>;
export default migrate;
//# sourceMappingURL=migrated.d.ts.map