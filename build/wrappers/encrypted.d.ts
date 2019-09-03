/// <reference types="node" />
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
import Encryption from './encryption/Encryption';
declare type EncT = Buffer;
export declare type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, EncT>;
export interface KeyRecord<ID> {
    id: ID;
    key: string;
}
export declare const encryptByKey: <T extends IDable>(sKey: string, cr?: Encryption<Buffer, unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], Buffer>>) => Collection<T>;
export declare const encryptByRecord: <T extends IDable>(keyCollection: Collection<KeyRecord<T["id"]>>, cacheSize?: number, cr?: Encryption<Buffer, unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], Buffer>>) => Collection<T>;
export declare const encryptByRecordWithMasterKey: <T extends IDable>(sMasterKey: string, keyCollection: Collection<Wrapped<KeyRecord<T["id"]>, "key", Buffer>>, cacheSize?: number, cr?: Encryption<Buffer, unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], Buffer>>) => Collection<T>;
export {};
