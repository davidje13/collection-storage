import { MongoClient as MClient, Db as MDb } from 'mongodb';
import MongoCollection from './MongoCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';

export default class MongoDb implements DB {
  private readonly stateRef = { closed: false };

  private constructor(
    private readonly client: MClient,
  ) {}

  public static async connect(url: string): Promise<MongoDb> {
    const { MongoClient } = await import('mongodb');
    const client = await MongoClient.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    return new MongoDb(client);
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): MongoCollection<T> {
    const collection = this.client.db().collection(name);
    return new MongoCollection(collection, keys, this.stateRef);
  }

  public async close(): Promise<void> {
    this.stateRef.closed = true;
    return this.client.close();
  }

  public getDb(): MDb {
    return this.client.db();
  }
}
