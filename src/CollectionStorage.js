import MemoryDb from './memory/MemoryDb';
import MongoDb from './mongo/MongoDb';

export default class CollectionStorage {
  static async connect(url) {
    let dbClass;
    if (url.startsWith('memory')) {
      dbClass = MemoryDb;
    } else if (url.startsWith('mongodb')) {
      dbClass = MongoDb;
    } else {
      throw new Error(`Unsupported database connection string: ${url}`);
    }

    try {
      return await dbClass.connect(url);
    } catch (e) {
      throw new Error(`Failed to connect to database "${url}": ${e.message}`);
    }
  }
}
