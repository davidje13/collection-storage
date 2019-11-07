import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped as TypeWrapped } from './wrappers/WrappedCollection';
import TypeEncryption from './wrappers/encryption/Encryption';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from './wrappers/encrypted';
import TypeDB from './interfaces/DB';
import TypeCollection from './interfaces/Collection';
import IDable from './interfaces/IDable';

// https://github.com/microsoft/TypeScript/issues/34750
export type DB = TypeDB;
export type Collection<T extends IDable> = TypeCollection<T>;
export type Wrapped<T extends IDable, WF extends keyof T, W> =
  TypeWrapped<T, WF, W>;
export type Encrypted<T extends IDable, WF extends keyof T> =
  TypeWrapped<T, WF, Buffer>;
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
};
export {
  default as nodeEncryptionSync,
} from './wrappers/encryption/nodeEncryptionSync';
export default CollectionStorage;
