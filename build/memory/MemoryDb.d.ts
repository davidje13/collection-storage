import MemoryCollection from './MemoryCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
export default class MemoryDb implements DB {
    private readonly simulatedLatency;
    private readonly mapTables;
    private readonly stateRef;
    constructor({ simulatedLatency }?: {
        simulatedLatency?: number | undefined;
    });
    static connect(url: string): MemoryDb;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MemoryCollection<T>;
    close(): void;
}
