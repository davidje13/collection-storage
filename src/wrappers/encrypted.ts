import type { IDable, IDableBy, IDType } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import LruCache from '../helpers/LruCache';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser';
import WrappedCollection, { Wrapped } from './WrappedCollection';
import type Encryption from './encryption/Encryption';
import nodeEncryptionSync from './encryption/nodeEncryptionSync';

export interface KeyRecord<ID extends IDType, KeyT> {
  id: ID;
  key: KeyT;
}

type EncryptableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];

type Encrypter<EncT, ID extends IDType> = <T extends IDableBy<ID>>(
) => <F extends EncryptableKeys<T>>(
  fields: F,
  baseCollection: Collection<Wrapped<T, F[-1], EncT>>,
) => Collection<T>;

// makeEncrypter provides optional 2-tier function call due to
// https://github.com/Microsoft/TypeScript/issues/26242

function makeEncrypter<EncT, ID extends IDType>(
  wrapper: <T extends IDableBy<ID>, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Wrapped<T, F[-1], EncT>>,
  ) => Collection<T>,
): Encrypter<EncT, ID> {
  return (fields?: any, baseCollection?: Collection<any>): any => {
    if (fields && baseCollection) {
      // non-typescript API (remove need for extra ())
      return wrapper(fields, baseCollection) as any;
    }
    return wrapper;
  };
}

function encryptByKey(sKey: Buffer): Encrypter<Buffer, IDType>;

function encryptByKey<EncT, KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  cr: Encryption<EncT, KeyT, SerialisedKeyT>,
): Encrypter<EncT, IDType>;

function encryptByKey<EncT, KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  cr: Encryption<EncT, KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<EncT, IDType> {
  const key = cr.deserialiseKey(sKey);

  return makeEncrypter(<T extends IDable, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Wrapped<T, F[-1], EncT>>,
  ) => new WrappedCollection<T, F, EncT, never>(baseCollection, fields, {
    wrap: (k, v): Promise<EncT> | EncT => cr.encrypt(key, serialiseValueBin(v)),
    unwrap: async (k, v): Promise<any> => deserialiseValueBin(await cr.decrypt(key, v)),
  }));
}

function encryptByRecord<ID extends IDType>(
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  cacheSize?: number,
): Encrypter<Buffer, ID>;

function encryptByRecord<ID extends IDType, EncT, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  cacheSize: number,
  cr: Encryption<EncT, KeyT, SerialisedKeyT>,
): Encrypter<EncT, ID>;

function encryptByRecord<ID extends IDType, EncT, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  cacheSize = 0,
  cr: Encryption<EncT, KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<EncT, ID> {
  const cache = new LruCache<ID, KeyT>(cacheSize);

  const loadKey = async (
    generateIfNeeded: boolean,
    record: { id?: ID },
  ): Promise<KeyT> => {
    const { id } = record;

    if (id === undefined) {
      throw new Error('Must provide ID for encryption');
    }

    const cached = cache.get(id);
    if (cached) {
      return cached;
    }
    let key: KeyT;
    const item = await keyCollection.get('id', id, ['key']);
    if (item) {
      key = cr.deserialiseKey(item.key);
    } else {
      if (!generateIfNeeded) {
        throw new Error('No encryption key found for record');
      }
      key = await cr.generateKey();
      await keyCollection.add({ id, key: cr.serialiseKey(key) });
    }
    cache.set(id, key);
    return key;
  };

  const removeKey = async ({ id }: { id: ID }): Promise<void> => {
    await keyCollection.remove('id', id);
    cache.remove(id);
  };

  // https://github.com/microsoft/TypeScript/issues/39080
  return makeEncrypter<EncT, ID>(<T extends IDableBy<ID>, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Wrapped<T, F[-1], EncT>>,
  ) => new WrappedCollection<T, F, EncT, KeyT>(baseCollection, fields, {
    wrap: (k, v, key): Promise<EncT> | EncT => cr.encrypt(key, serialiseValueBin(v)),
    unwrap: async (k, v, key): Promise<any> => deserialiseValueBin(await cr.decrypt(key, v)),
    preWrap: loadKey.bind(null, true),
    preUnwrap: loadKey.bind(null, false),
    preRemove: removeKey,
  }));
}

function encryptByRecordWithMasterKey<ID extends IDType>(
  sMasterKey: Buffer,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  cacheSize?: number,
): Encrypter<Buffer, ID>;

function encryptByRecordWithMasterKey<ID extends IDType, EncT, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, EncT>>,
  cacheSize: number,
  cr: Encryption<EncT, KeyT, SerialisedKeyT>,
): Encrypter<EncT, ID>;

function encryptByRecordWithMasterKey<ID extends IDType, EncT, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, EncT>>,
  cacheSize = 0,
  cr: Encryption<EncT, KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<EncT, ID> {
  const keyEnc = encryptByKey(sMasterKey, cr);
  const encKeyCollection = keyEnc<KeyRecord<ID, SerialisedKeyT>>()(
    ['key'],
    keyCollection,
  );
  return encryptByRecord(encKeyCollection, cacheSize, cr);
}

export {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
};
