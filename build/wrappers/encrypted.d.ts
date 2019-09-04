/// <reference types="node" />
import { IDableBy, IDType } from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
import Encryption from './encryption/Encryption';
export interface KeyRecord<ID extends IDType, KeyT> {
    id: ID;
    key: KeyT;
}
declare type EncryptableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];
declare type Encrypter<EncT, ID extends IDType> = <T extends IDableBy<ID>>() => <F extends EncryptableKeys<T>>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], EncT>>) => Collection<T>;
declare function encryptByKey(sKey: Buffer): Encrypter<Buffer, IDType>;
declare function encryptByKey<EncT, KeyT, SerialisedKeyT>(sKey: SerialisedKeyT, cr: Encryption<EncT, KeyT, SerialisedKeyT>): Encrypter<EncT, IDType>;
declare function encryptByRecord<ID extends IDType>(keyCollection: Collection<KeyRecord<ID, Buffer>>, cacheSize?: number): Encrypter<Buffer, ID>;
declare function encryptByRecord<ID extends IDType, EncT, KeyT, SerialisedKeyT>(keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>, cacheSize: number, cr: Encryption<EncT, KeyT, SerialisedKeyT>): Encrypter<EncT, ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType>(sMasterKey: Buffer, keyCollection: Collection<KeyRecord<ID, Buffer>>, cacheSize?: number): Encrypter<Buffer, ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType, EncT, KeyT, SerialisedKeyT>(sMasterKey: SerialisedKeyT, keyCollection: Collection<KeyRecord<ID, EncT>>, cacheSize: number, cr: Encryption<EncT, KeyT, SerialisedKeyT>): Encrypter<EncT, ID>;
export { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, };
