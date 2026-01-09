import { CollectionStorage } from './CollectionStorage.mts';
import { MemoryDB } from './memory/MemoryDB.mts';

export { CollectionStorageFactory } from './CollectionStorage.mts';
export { DuplicateError } from './DuplicateError.mts';
export type { IDable } from './interfaces/IDable.mts';
export type { DB, DBKeys } from './interfaces/DB.mts';
export { BaseDB } from './interfaces/BaseDB.mts';
export type { KeyOptions, Collection, UpdateOptions } from './interfaces/Collection.mts';
export { BaseCollection } from './interfaces/BaseCollection.mts';
export type { CollectionOptions } from './interfaces/CollectionOptions.mts';

export { WrappedCollection, type Wrapped } from './wrappers/WrappedCollection.mts';
export { cache } from './wrappers/cached.mts';
export { compress, type Compressed, type CompressOptions } from './wrappers/compressed.mts';
export {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  type EncryptionOptions,
  type Encrypted,
} from './wrappers/encrypted.mts';
export { migrate } from './wrappers/migrated.mts';

export type { Encryption } from './wrappers/encryption/Encryption.mts';
export { nodeEncryptionSync } from './wrappers/encryption/nodeEncryptionSync.mts';

export { LruCache } from './helpers/LruCache.mts';
export { retry } from './helpers/retry.mts';
export { makeKeyValue, mapEntries, safeSet, safeGet } from './helpers/safeAccess.mts';
export {
  canonicalJSON,
  serialiseValue,
  deserialiseValue,
  serialiseValueBin,
  deserialiseValueBin,
  serialiseRecord,
  deserialiseRecord,
  partialDeserialiseRecord,
  type Serialised,
} from './helpers/serialiser.mts';

CollectionStorage.register(['memory'], MemoryDB.connect);

export { CollectionStorage, MemoryDB };
