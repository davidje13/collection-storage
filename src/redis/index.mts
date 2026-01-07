import { CollectionStorage } from 'collection-storage';
import { RedisDB } from './RedisDB.mts';

CollectionStorage.register(['redis'], RedisDB.connect);
CollectionStorage.register(['rediss'], RedisDB.connect);

export { RedisDB };
