import MemoryDb from './memory/MemoryDb';
import MongoDb from './mongo/MongoDb';
import DB from './DB';

export default class CollectionStorage {
  public static async connect(url: string): Promise<DB> {
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
