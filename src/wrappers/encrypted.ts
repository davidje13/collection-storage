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

export type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;

type EncryptableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];

type Encrypter<ID extends IDType> = <T extends IDableBy<ID>>(
) => <F extends EncryptableKeys<T>>(
  fields: F,
  baseCollection: Collection<Encrypted<T, F[-1]>>,
) => Collection<T>;

// makeEncrypter provides optional 2-tier function call due to
// https://github.com/Microsoft/TypeScript/issues/26242

function makeEncrypter<ID extends IDType>(
  wrapper: <T extends IDableBy<ID>, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Encrypted<T, F[-1]>>,
  ) => Collection<T>,
): Encrypter<ID> {
  return (fields?: any, baseCollection?: Collection<any>): any => {
    if (fields && baseCollection) {
      // non-typescript API (remove need for extra ())
      return wrapper(fields, baseCollection) as any;
    }
    return wrapper;
  };
}

function encryptByKey(sKey: Buffer): Encrypter<IDType>;

function encryptByKey<KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  cr: Encryption<KeyT, SerialisedKeyT>,
): Encrypter<IDType>;

function encryptByKey<KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  cr: Encryption<KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<IDType> {
  const key = cr.deserialiseKey(sKey);

  return makeEncrypter(<T extends IDable, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Encrypted<T, F[-1]>>,
  ) => new WrappedCollection<T, F, Buffer, never>(baseCollection, fields, {
    wrap: (k, v): Promise<Buffer> | Buffer => cr.encrypt(key, serialiseValueBin(v)),
    unwrap: async (k, v): Promise<any> => deserialiseValueBin(await cr.decrypt(key, v)),
  }));
}

function encryptByRecord<ID extends IDType>(
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  cacheSize?: number,
): Encrypter<ID>;

function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  cacheSize: number,
  cr: Encryption<KeyT, SerialisedKeyT>,
): Encrypter<ID>;

function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  cacheSize = 0,
  cr: Encryption<KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<ID> {
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
  return makeEncrypter<ID>(<T extends IDableBy<ID>, F extends EncryptableKeys<T>>(
    fields: F,
    baseCollection: Collection<Encrypted<T, F[-1]>>,
  ) => new WrappedCollection<T, F, Buffer, KeyT>(baseCollection, fields, {
    wrap: (k, v, key): Promise<Buffer> | Buffer => cr.encrypt(key, serialiseValueBin(v)),
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
): Encrypter<ID>;

function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  cacheSize: number,
  cr: Encryption<KeyT, SerialisedKeyT>,
): Encrypter<ID>;

function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  cacheSize = 0,
  cr: Encryption<KeyT, SerialisedKeyT> = nodeEncryptionSync as any,
): Encrypter<ID> {
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
