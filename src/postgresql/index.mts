import { CollectionStorage } from '../core/index.mts';
import { PostgresDB } from './PostgresDB.mts';

CollectionStorage.register(['postgresql'], PostgresDB.connect);

export { PostgresDB };
