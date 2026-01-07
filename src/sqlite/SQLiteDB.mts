import { DatabaseSync } from 'node:sqlite';
import { type DBKeys, BaseDB, type IDable } from 'collection-storage/index.mts';
import { SQLiteCollection } from './SQLiteCollection.mts';

export class SQLiteDB extends BaseDB {
  /** @internal */ private readonly _db: DatabaseSync;
  /** @internal */ private readonly _pathname: string | null;

  /** @internal */ private constructor(db: DatabaseSync, pathname: string | null) {
    super();
    this._db = db;
    this._pathname = pathname;
  }

  static async connect(url: string): Promise<SQLiteDB> {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== '') {
      throw new Error('SQLite DB must be on the local filesystem');
    }
    const params = parsedUrl.searchParams;
    const options = {
      timeout: params.has('timeout') ? Number(params.get('timeout')) : undefined,
      returnArrays: true,
      allowBareNamedParameters: false,
      defensive: true, // Node.js 25.1+
    };
    const db = new DatabaseSync(
      parsedUrl.pathname === '/' ? ':memory:' : parsedUrl.pathname,
      options,
    );
    return new SQLiteDB(db, parsedUrl.pathname === '/' ? null : parsedUrl.pathname);
  }

  override getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): SQLiteCollection<T> {
    return this.get(name, keys, (options) => new SQLiteCollection(options, this._db));
  }

  getDB() {
    return this._db;
  }

  getFilePath() {
    return this._pathname;
  }

  /** @internal */ protected override internalClose() {
    this._db.close();
  }
}
