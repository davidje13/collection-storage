import { MongoClient, type Db as MDb } from 'mongodb';
import { type DBKeys, type IDable, BaseDB } from '../core/index.mts';
import { MongoCollection } from './MongoCollection.mts';

function escapeName(name: string): string {
  return encodeURIComponent(name);
}

export class MongoDB extends BaseDB {
  /** @internal */ declare private readonly _client: MongoClient;

  private constructor(client: MongoClient) {
    super();
    this._client = client;
  }

  static async connect(url: string): Promise<MongoDB> {
    return new MongoDB(await MongoClient.connect(url));
  }

  getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollection<T> {
    return this.get(
      name,
      keys,
      (options) =>
        new MongoCollection(options, this._client.db().collection(escapeName(options.name))),
    );
  }

  getDb(): MDb {
    return this._client.db();
  }

  /** @internal */ protected override internalClose() {
    return this._client.close();
  }
}
