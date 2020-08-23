/// <reference types="node" />
import type { IDable, IDableBy, IDType } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
import type Encryption from './encryption/Encryption';
import { CacheOptions } from './cached';
export interface KeyRecord<ID extends IDType, KeyT> {
    id: ID;
    key: KeyT;
}
export declare type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;
declare type EncryptableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];
declare type Encrypter<ID extends IDType> = <T extends IDableBy<ID>>() => <F extends EncryptableKeys<T>>(fields: F, baseCollection: Collection<Encrypted<T, F[-1]>>) => Collection<T>;
export interface EncryptionOptions<KeyT = Buffer, SerialisedKeyT = Buffer> {
    allowRaw?: boolean;
    encryption?: Encryption<KeyT, SerialisedKeyT>;
}
export interface RecordEncryptionOptions {
    keyCache?: CacheOptions;
}
interface CustomEncryptionOptions<KeyT, SerialisedKeyT> extends EncryptionOptions<KeyT, SerialisedKeyT> {
    encryption: Encryption<KeyT, SerialisedKeyT>;
}
declare function encryptByKey(sKey: Buffer, options?: EncryptionOptions): Encrypter<IDType>;
declare function encryptByKey<KeyT, SerialisedKeyT>(sKey: SerialisedKeyT, options: CustomEncryptionOptions<KeyT, SerialisedKeyT>): Encrypter<IDType>;
declare function encryptByRecord<ID extends IDType>(keyCollection: Collection<KeyRecord<ID, Buffer>>, options?: EncryptionOptions & RecordEncryptionOptions): Encrypter<ID>;
declare function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>, options: CustomEncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions): Encrypter<ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType>(sMasterKey: Buffer, keyCollection: Collection<KeyRecord<ID, Buffer>>, options?: EncryptionOptions & RecordEncryptionOptions): Encrypter<ID>;
declare function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(sMasterKey: SerialisedKeyT, keyCollection: Collection<KeyRecord<ID, Buffer>>, options: CustomEncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions): Encrypter<ID>;
export { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey, };
//# sourceMappingURL=encrypted.d.ts.map