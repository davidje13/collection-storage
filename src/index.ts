import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped } from './wrappers/WrappedCollection';
import type TypeEncryption from './wrappers/encryption/Encryption';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from './wrappers/encrypted';
import migrate from './wrappers/migrated';
import type { DB } from './interfaces/DB';
import type { Collection } from './interfaces/Collection';
import type { IDable } from './interfaces/IDable';

export type { DB, Collection, Wrapped };
export type Encrypted<T extends IDable, WF extends keyof T> =
  Wrapped<T, WF, Buffer>;
export type Encryption<EncT, KeyT, SerialisedKeyT> =
  TypeEncryption<EncT, KeyT, SerialisedKeyT>;

export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
export { default as RedisDb } from './redis/RedisDb';
export { default as LruCache } from './helpers/LruCache';
export {
  WrappedCollection,
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  migrate,
};
export {
  default as nodeEncryptionSync,
} from './wrappers/encryption/nodeEncryptionSync';
export default CollectionStorage;
