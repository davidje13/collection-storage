import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import LruCache from '../helpers/LruCache';
import { serialiseValue, deserialiseValue } from '../helpers/serialiser';
import WrappedCollection, { Wrapped } from './WrappedCollection';
import Encryption from './encryption/Encryption';
import nodeEncryptionSync from './encryption/nodeEncryptionSync';

type EncT = Buffer;

export type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, EncT>;

export interface KeyRecord<ID> {
  id: ID;
  key: string;
}

export const encryptByKey = <T extends IDable>(
  sKey: string,
  cr: Encryption<EncT, unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  fields: F,
  baseCollection: Collection<Encrypted<T, F[-1]>>,
): Collection<T> => {
  const key = cr.deserialiseKey(sKey);

  return new WrappedCollection<T, F, EncT, never>(baseCollection, fields, {
    wrap: (k, v): Promise<EncT> | EncT => cr.encrypt(key, serialiseValue(v)),
    unwrap: async (k, v): Promise<any> => deserialiseValue(await cr.decrypt(key, v)),
  });
};

export const encryptByRecord = <T extends IDable>(
  keyCollection: Collection<KeyRecord<T['id']>>,
  cacheSize: number = 0,
  cr: Encryption<EncT, unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  fields: F,
  baseCollection: Collection<Encrypted<T, F[-1]>>,
): Collection<T> => {
  const cache = new LruCache<T['id'], unknown>(cacheSize);

  const loadKey = async (
    generateIfNeeded: boolean,
    record: Partial<Pick<T, 'id'>>,
  ): Promise<unknown> => {
    const { id } = record;

    if (id === undefined) {
      throw new Error('Must provide ID for encryption');
    }

    const cached = cache.get(id);
    if (cached) {
      return cached;
    }
    let key: unknown;
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

  const removeKey = async ({ id }: Pick<T, 'id'>): Promise<void> => {
    await keyCollection.remove('id', id);
    cache.remove(id);
  };

  return new WrappedCollection<T, F, EncT, unknown>(baseCollection, fields, {
    wrap: (k, v, key): Promise<EncT> | EncT => cr.encrypt(key, JSON.stringify(v)),
    unwrap: async (k, v, key): Promise<any> => JSON.parse(await cr.decrypt(key, v)),
    preWrap: loadKey.bind(null, true),
    preUnwrap: loadKey.bind(null, false),
    preRemove: removeKey,
  });
};

export const encryptByRecordWithMasterKey = <T extends IDable>(
  sMasterKey: string,
  keyCollection: Collection<Encrypted<KeyRecord<T['id']>, 'key'>>,
  cacheSize: number = 0,
  cr: Encryption<EncT, unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  fields: F,
  baseCollection: Collection<Encrypted<T, F[-1]>>,
): Collection<T> => encryptByRecord<T>(
  encryptByKey<KeyRecord<T['id']>>(sMasterKey, cr)(['key'], keyCollection),
  cacheSize,
  cr,
)(fields, baseCollection);
