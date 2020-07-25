import type { Db as MongoDbT, MongoClient as MongoClientT } from 'mongodb';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
import type MongoCollectionT from './MongoCollection';

function escapeName(name: string): string {
  return encodeURIComponent(name);
}

export default class MongoDb extends BaseDB {
  private constructor(
    private readonly client: MongoClientT,
    MongoCollection: typeof MongoCollectionT,
  ) {
    super((name, keys) => new MongoCollection(
      this.client.db().collection(escapeName(name)),
      keys,
      this.stateRef,
    ));
  }

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

  public getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MongoCollectionT<T> {
    return super.getCollection(name, keys) as MongoCollectionT<T>;
  }

  public getDb(): MongoDbT {
    return this.client.db();
  }

  protected internalClose(): Promise<void> {
    return this.client.close();
  }
}
