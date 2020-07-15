import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped } from './wrappers/WrappedCollection';
import type Encryption from './wrappers/encryption/Encryption';
import { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, Encrypted } from './wrappers/encrypted';
import { compress, Compressed, CompressOptions } from './wrappers/compressed';
import migrate from './wrappers/migrated';
import type { DB } from './interfaces/DB';
import type { Collection } from './interfaces/Collection';
export type { DB, Collection, Wrapped, Encryption, Encrypted, Compressed, CompressOptions, };
export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
export { default as RedisDb } from './redis/RedisDb';
export { default as LruCache } from './helpers/LruCache';
export { WrappedCollection, encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, compress, migrate, };
export { default as nodeEncryptionSync, } from './wrappers/encryption/nodeEncryptionSync';
export default CollectionStorage;
//# sourceMappingURL=index.d.ts.map