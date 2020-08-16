import MemoryDb from './memory/MemoryDb';
import MongoDb from './mongo/MongoDb';
import DynamoDb from './dynamodb/DynamoDb';
import RedisDb from './redis/RedisDb';
import PostgresDb from './postgresql/PostgresDb';
import type { DB } from './interfaces/DB';

export default class CollectionStorage {
  public static async connect(url: string): Promise<DB> {
    let dbClass;
    if (url.startsWith('memory')) {
      dbClass = MemoryDb;
    } else if (url.startsWith('mongodb')) {
      dbClass = MongoDb;
    } else if (url.startsWith('dynamodb')) {
      dbClass = DynamoDb;
    } else if (url.startsWith('redis')) {
      dbClass = RedisDb;
    } else if (url.startsWith('postgres')) {
      dbClass = PostgresDb;
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
