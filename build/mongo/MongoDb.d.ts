import type { Db as MongoDbT } from 'mongodb';
import type { DB, DBKeys } from '../interfaces/DB';
import type { IDable } from '../interfaces/IDable';
import type { MongoCollection as MongoCollectionT } from './MongoCollection';
export default class MongoDb implements DB {
    private readonly client;
    private readonly MongoCollection;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollectionT<T>;
    close(): Promise<void>;
    getDb(): MongoDbT;
}
//# sourceMappingURL=MongoDb.d.ts.map