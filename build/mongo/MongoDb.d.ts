import type { Db as MongoDbT } from 'mongodb';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
import type MongoCollectionT from './MongoCollection';
export default class MongoDb extends BaseDB {
    private readonly client;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollectionT<T>;
    getDb(): MongoDbT;
    protected internalClose(): Promise<void>;
}
//# sourceMappingURL=MongoDb.d.ts.map