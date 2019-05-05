import MongoDb from './MongoDb';
import contract from '../db.contract-test';

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/collection-storage-tests';

describe('MongoDb', () => contract({
  factory: async () => {
    const db = await MongoDb.connect(url);
    await db.db.command({ dropDatabase: 1 });
    return db;
  },
}));
