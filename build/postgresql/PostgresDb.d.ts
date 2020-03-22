import type { Pool as PgPoolT } from 'pg';
import PostgresCollection from './PostgresCollection';
import type { DB, DBKeys } from '../interfaces/DB';
import type { IDable } from '../interfaces/IDable';
export default class PostgresDb implements DB {
    private readonly pool;
    private readonly stateRef;
    private constructor();
    static connect(url: string): Promise<PostgresDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): PostgresCollection<T>;
    close(): Promise<void>;
    getConnectionPool(): PgPoolT;
}
//# sourceMappingURL=PostgresDb.d.ts.map