/// <reference types="node" />
import type { IDable, IDableBy, IDType } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
import type Encryption from './encryption/Encryption';
export interface KeyRecord<ID extends IDType, KeyT> {
    id: ID;
    key: KeyT;
}
export declare type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;
declare type EncryptableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];
declare type Encrypter<ID extends IDType> = <T extends IDableBy<ID>>() => <F extends EncryptableKeys<T>>(fields: F, baseCollection: Collection<Encrypted<T, F[-1]>>) => Collection<T>;
declare function encryptByKey(sKey: Buffer): Encrypter<IDType>;
declare function encryptByKey<KeyT, SerialisedKeyT>(sKey: SerialisedKeyT, cr: Encryption<KeyT, SerialisedKeyT>): Encrypter<IDType>;
declare function encryptByRecord<ID extends IDType>(keyCollection: Collection<KeyRecord<ID, Buffer>>, cacheSize?: number): Encrypter<ID>;
declare function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>, cacheSize: number, cr: Encryption<KeyT, SerialisedKeyT>): Encrypter<ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType>(sMasterKey: Buffer, keyCollection: Collection<KeyRecord<ID, Buffer>>, cacheSize?: number): Encrypter<ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(sMasterKey: SerialisedKeyT, keyCollection: Collection<KeyRecord<ID, Buffer>>, cacheSize: number, cr: Encryption<KeyT, SerialisedKeyT>): Encrypter<ID>;
export { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, };
//# sourceMappingURL=encrypted.d.ts.map