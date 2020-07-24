import type { Db as MongoDbT } from 'mongodb';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
import type MongoCollectionT from './MongoCollection';
export default class MongoDb extends BaseDB {
    private readonly client;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollectionT<T>;
    close(): Promise<void>;
    getDb(): MongoDbT;
}
//# sourceMappingURL=MongoDb.d.ts.map