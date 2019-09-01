import { Db as MDb } from 'mongodb';
import MongoCollection from './MongoCollection';
import DB, { DBKeys } from '../DB';
import IDable from '../IDable';

export default class MongoDb implements DB {
  private constructor(
    private readonly db: MDb,
  ) {}

  public static async connect(url: string): Promise<MongoDb> {
    const { MongoClient } = await import('mongodb');
    const client = await MongoClient.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    return new MongoDb(client.db());
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): MongoCollection<T> {
    const collection = this.db.collection(name);
    return new MongoCollection(collection, keys);
  }
}
