import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped } from './wrappers/WrappedCollection';
import Encryption from './wrappers/encryption/Encryption';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from './wrappers/encrypted';
import DB from './interfaces/DB';
import Collection from './interfaces/Collection';
import IDable from './interfaces/IDable';

export type DB = DB;
export type Collection<T extends IDable> = Collection<T>;
export type Wrapped<T extends IDable, WF extends keyof T, W> =
  Wrapped<T, WF, W>;
export type Encrypted<T extends IDable, WF extends keyof T> =
  Wrapped<T, WF, Buffer>;
export type Encryption<EncT, KeyT, SerialisedKeyT> =
  Encryption<EncT, KeyT, SerialisedKeyT>;

export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
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
