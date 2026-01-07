import { CollectionStorage } from '../core/index.mts';
import { SQLiteDB } from './SQLiteDB.mts';

CollectionStorage.register(['sqlite'], SQLiteDB.connect);

export { SQLiteDB };
