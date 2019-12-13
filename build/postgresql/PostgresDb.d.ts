import PostgresCollection from './PostgresCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
export default class PostgresDb implements DB {
    private readonly pool;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<PostgresDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): PostgresCollection<T>;
    close(): Promise<void>;
    getConnectionPool(): import('pg').Pool;
}
//# sourceMappingURL=PostgresDb.d.ts.map