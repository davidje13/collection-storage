import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
export default class MemoryCollection<T extends IDable> extends BaseCollection<T> {
    private readonly simulatedLatency;
    private readonly stateRef;
    private readonly data;
    private readonly customIndexData;
    private readonly uniqueIndexDataPtrs;
    constructor(keys?: DBKeys<T>, simulatedLatency?: number, stateRef?: StateRef);
    protected preAct(): Promise<void> | void;
    protected internalAdd(value: T): Promise<void>;
    protected internalUpsert(id: T['id'], update: Partial<T>): Promise<void>;
    protected internalUpdate<K extends string & keyof T>(searchAttribute: K, searchValue: T[K], update: Partial<T>): Promise<void>;
    protected internalGetAll<K extends string & keyof T, F extends readonly (string & keyof T)[]>(searchAttribute?: K, searchValue?: T[K], returnAttributes?: F): Promise<Readonly<Pick<T, F[-1]>>[]>;
    protected internalRemove<K extends string & keyof T>(searchAttribute: K, searchValue: T[K]): Promise<number>;
    private internalGetSerialisedIds;
    private internalCheckDuplicates;
    private internalPopulateIndices;
    private internalRemoveIndices;
}
//# sourceMappingURL=MemoryCollection.d.ts.map