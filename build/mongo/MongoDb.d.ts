import { Db as MDb } from 'mongodb';
import MongoCollection from './MongoCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
export default class MongoDb implements DB {
    private readonly client;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollection<T>;
    close(): Promise<void>;
    getDb(): MDb;
}
//# sourceMappingURL=MongoDb.d.ts.map