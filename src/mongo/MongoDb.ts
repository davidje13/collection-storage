import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';

function escapeName(name: string): string {
  return encodeURIComponent(name);
}

export default class MongoDb implements DB {
  private readonly stateRef = { closed: false };

  private constructor(
    private readonly client: import('mongodb').MongoClient,
    private readonly MongoCollection: typeof import('./MongoCollection').default,
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
  ): import('./MongoCollection').default<T> {
    const collection = this.client.db().collection(escapeName(name));
    return new this.MongoCollection(collection, keys, this.stateRef);
  }

  public async close(): Promise<void> {
    this.stateRef.closed = true;
    return this.client.close();
  }

  public getDb(): import('mongodb').Db {
    return this.client.db();
  }
}
