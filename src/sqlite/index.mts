import { CollectionStorage } from 'collection-storage';
import { SQLiteDB } from './SQLiteDB.mts';

CollectionStorage.register(['sqlite'], SQLiteDB.connect);

export { SQLiteDB };
