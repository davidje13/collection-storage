import type { Collection } from './Collection';
import type { IDable } from './IDable';
import type { DB, DBKeys } from './DB';
export interface StateRef {
    closed: boolean;
}
export default abstract class BaseDB implements DB {
    private readonly makeCollection;
    protected readonly stateRef: StateRef;
    private readonly collectionCache;
    constructor(makeCollection: <T extends IDable>(name: string, keys?: DBKeys<T>) => Collection<T>);
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;
    close(): Promise<void> | void;
    protected syncClose(): void;
    protected internalClose(): Promise<void> | void;
}
//# sourceMappingURL=BaseDB.d.ts.map