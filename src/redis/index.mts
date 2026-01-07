import { CollectionStorage } from 'collection-storage/index.mts';
import { RedisDB } from './RedisDB.mts';

CollectionStorage.register(['redis'], RedisDB.connect);
CollectionStorage.register(['rediss'], RedisDB.connect);

export { RedisDB };
