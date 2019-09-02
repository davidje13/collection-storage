import IDable from '../IDable';
import Collection from '../Collection';
import { Wrapped } from './WrappedCollection';
import Encryption from './encryption/Encryption';
export interface KeyRecord<ID> {
    id: ID;
    key: string;
}
export declare const encryptByKey: <T extends IDable>(sKey: string, cr?: Encryption<unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], string>>) => Collection<T>;
export declare const encryptByRecord: <T extends IDable>(keyCollection: Collection<KeyRecord<T["id"]>>, cacheSize?: number, cr?: Encryption<unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], string>>) => Collection<T>;
export declare const encryptByRecordWithMasterKey: <T extends IDable>(sMasterKey: string, keyCollection: Collection<KeyRecord<T["id"]>>, cacheSize?: number, cr?: Encryption<unknown>) => <F extends readonly (Exclude<keyof T, "id"> & string)[]>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], string>>) => Collection<T>;
