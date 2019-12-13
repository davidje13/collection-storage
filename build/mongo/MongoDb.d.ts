import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
export default class MongoDb implements DB {
    private readonly client;
    private readonly MongoCollection;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): import('./MongoCollection').default<T>;
    close(): Promise<void>;
    getDb(): import('mongodb').Db;
}
//# sourceMappingURL=MongoDb.d.ts.map