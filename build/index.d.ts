/// <reference types="node" />
import CollectionStorage from './CollectionStorage';
import WrappedCollection, { Wrapped as TypeWrapped } from './wrappers/WrappedCollection';
import TypeEncryption from './wrappers/encryption/Encryption';
import { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey } from './wrappers/encrypted';
import TypeDB from './interfaces/DB';
import TypeCollection from './interfaces/Collection';
import IDable from './interfaces/IDable';
export declare type DB = TypeDB;
export declare type Collection<T extends IDable> = TypeCollection<T>;
export declare type Wrapped<T extends IDable, WF extends keyof T, W> = TypeWrapped<T, WF, W>;
export declare type Encrypted<T extends IDable, WF extends keyof T> = TypeWrapped<T, WF, Buffer>;
export declare type Encryption<EncT, KeyT, SerialisedKeyT> = TypeEncryption<EncT, KeyT, SerialisedKeyT>;
export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
export { default as RedisDb } from './redis/RedisDb';
export { default as LruCache } from './helpers/LruCache';
export { WrappedCollection, encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, };
export { default as nodeEncryptionSync, } from './wrappers/encryption/nodeEncryptionSync';
export default CollectionStorage;
//# sourceMappingURL=index.d.ts.map