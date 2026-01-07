import { CollectionStorage } from 'collection-storage';
import { PostgresDB } from './PostgresDB.mts';

CollectionStorage.register(['postgresql'], PostgresDB.connect);

export { PostgresDB };
