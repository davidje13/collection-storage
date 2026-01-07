import { CollectionStorage } from 'collection-storage/index.mts';
import { SQLiteDB } from './SQLiteDB.mts';

CollectionStorage.register(['sqlite'], SQLiteDB.connect);

export { SQLiteDB };
