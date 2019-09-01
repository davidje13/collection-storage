import MemoryCollection from './MemoryCollection';
import DB, { DBKeys } from '../DB';
import IDable from '../IDable';
export default class MemoryDb implements DB {
    private readonly simulatedLatency;
    private readonly mapTables;
    constructor({ simulatedLatency }?: {
        simulatedLatency?: number | undefined;
    });
    static connect(url: string): MemoryDb;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MemoryCollection<T>;
}
