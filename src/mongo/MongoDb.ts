import type { Db as MongoDbT, MongoClient as MongoClientT } from 'mongodb';
import type { DB, DBKeys } from '../interfaces/DB';
import type { IDable } from '../interfaces/IDable';
import type MongoCollectionT from './MongoCollection';

function escapeName(name: string): string {
  return encodeURIComponent(name);
}

export default class MongoDb implements DB {
  private readonly stateRef = { closed: false };

  private constructor(
    private readonly client: MongoClientT,
    private readonly MongoCollection: typeof MongoCollectionT,
  ) {}

  public static async connect(url: string): Promise<MongoDb> {
    const { MongoClient } = await import('mongodb');
    const {
      default: MongoCollection,
    } = await import(/* webpackMode: "eager" */ './MongoCollection');
    const client = await MongoClient.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    return new MongoDb(client, MongoCollection);
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): MongoCollectionT<T> {
    const collection = this.client.db().collection(escapeName(name));
    return new this.MongoCollection(collection, keys, this.stateRef);
  }

  public async close(): Promise<void> {
    this.stateRef.closed = true;
    return this.client.close();
  }

  public getDb(): MongoDbT {
    return this.client.db();
  }
}
