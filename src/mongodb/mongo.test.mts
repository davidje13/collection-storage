import { contract } from '../test-helpers/db.contract-test.mts';
import { MongoDB } from './MongoDB.mts';

const url = process.env['MONGO_URL'] || 'mongodb://localhost:27017/collection-storage-tests';

describe('MongoDB', () => {
  beforeAll(async () => {
    const db = await MongoDB.connect(url);
    await db.getDb().command({ dropDatabase: 1 });
    await db.close();
  });

  contract({ factory: () => MongoDB.connect(url) });
});
