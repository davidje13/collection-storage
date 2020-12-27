import MongoDb from './MongoDb';
import contract from '../db.contract-test';

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/collection-storage-tests';

describe('MongoDb', () => contract({
  beforeAll: async (): Promise<void> => {
    const db = await MongoDb.connect(url);
    await db.getDb().command({ dropDatabase: 1 });
    await db.close();
  },
  factory: (): Promise<MongoDb> => MongoDb.connect(url),

  // MongoDB client library does not handle fields with dots or named __proto__
  // See https://github.com/mongodb/js-bson/issues/420
  testNastyValues: false,
}));
