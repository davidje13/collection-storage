import MemoryCollection from './MemoryCollection';
import type { DBKeys } from '../interfaces/DB';
import type { IDable } from '../interfaces/IDable';
import BaseDB from '../interfaces/BaseDB';
export default class MemoryDb extends BaseDB {
    private readonly stateRef;
    constructor({ simulatedLatency }?: {
        simulatedLatency?: number;
    });
    static connect(url: string): MemoryDb;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MemoryCollection<T>;
    close(): void;
}
//# sourceMappingURL=MemoryDb.d.ts.map