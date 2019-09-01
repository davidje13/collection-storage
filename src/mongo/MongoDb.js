import MongoCollection from './MongoCollection';

export default class MongoDb {
  constructor(db) {
    this.db = db;
  }

  static async connect(url) {
    const { MongoClient } = await import('mongodb');
    const client = await MongoClient.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    return new MongoDb(client.db());
  }

  getCollection(name, keys) {
    const collection = this.db.collection(name);
    return new MongoCollection(collection, keys);
  }
}
