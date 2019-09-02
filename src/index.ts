import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped } from './wrappers/WrappedCollection';
import Encryption from './wrappers/encryption/Encryption';
import DB from './DB';
import Collection from './Collection';
import IDable from './IDable';

export type DB = DB;
export type Collection<T extends IDable> = Collection<T>;
export type Wrapped<T extends IDable, WF extends keyof T, W> = Wrapped<T, WF, W>;
export type Encryption<Key> = Encryption<Key>;

export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
export { default as LruCache } from './helpers/LruCache';
export { WrappedCollection };
export {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from './wrappers/encrypted';
export {
  default as nodeEncryptionSync,
} from './wrappers/encryption/nodeEncryptionSync';
export default CollectionStorage;
