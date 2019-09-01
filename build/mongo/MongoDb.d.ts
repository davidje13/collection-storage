import MongoCollection from './MongoCollection';
import DB, { DBKeys } from '../DB';
import IDable from '../IDable';
export default class MongoDb implements DB {
    private readonly db;
    private constructor();
    static connect(url: string): Promise<MongoDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollection<T>;
}
