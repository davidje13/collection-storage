import type { Collection } from './Collection';
import type { IDable } from './IDable';
import type { DB, DBKeys } from './DB';
export default abstract class BaseDB implements DB {
    private readonly makeCollection;
    private readonly collectionCache;
    constructor(makeCollection: <T extends IDable>(name: string, keys?: DBKeys<T>) => Collection<T>);
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;
    abstract close(): Promise<void> | void;
}
//# sourceMappingURL=BaseDB.d.ts.map