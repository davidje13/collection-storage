import { CollectionStorage } from '../core/index.mts';
import { RedisDB } from './RedisDB.mts';

CollectionStorage.register(['redis'], RedisDB.connect);
CollectionStorage.register(['rediss'], RedisDB.connect);

export { RedisDB };
