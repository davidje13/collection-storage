import IDable from '../IDable';
import Collection from '../Collection';
import LruCache from '../helpers/LruCache';
import WrappedCollection, { Wrapped } from './WrappedCollection';
import Encryption from './encryption/Encryption';
import nodeEncryptionSync from './encryption/nodeEncryptionSync';

export interface KeyRecord<ID> {
  id: ID;
  key: string;
}

export const encryptByKey = <T extends IDable>(
  sKey: string,
  cr: Encryption<unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  baseCollection: Collection<Wrapped<T, F[-1], string>>,
  fields: F,
): Collection<T> => {
  const key = cr.deserialiseKey(sKey);

  return new WrappedCollection<T, F, string, never>(baseCollection, fields, {
    wrap: (k, v): Promise<string> | string => cr.encrypt(key, JSON.stringify(v)),
    unwrap: async (k, v): Promise<any> => JSON.parse(await cr.decrypt(key, v)),
  });
};

export const encryptByRecord = <T extends IDable>(
  keyCollection: Collection<KeyRecord<T['id']>>,
  cacheSize: number = 0,
  cr: Encryption<unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  baseCollection: Collection<Wrapped<T, F[-1], string>>,
  fields: F,
): Collection<T> => {
  const cache = new LruCache<T['id'], unknown>(cacheSize);

  const loadKey = async (record: Partial<Pick<T, 'id'>>): Promise<unknown> => {
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
      key = await cr.generateKey();
      await keyCollection.add({ id, key: cr.serialiseKey(key) });
    }
    cache.set(id, key);
    return key;
  };

  return new WrappedCollection<T, F, string, unknown>(baseCollection, fields, {
    wrap: (k, v, key): Promise<string> | string => cr.encrypt(key, JSON.stringify(v)),
    unwrap: async (k, v, key): Promise<any> => JSON.parse(await cr.decrypt(key, v)),
    preWrap: loadKey,
    preUnwrap: loadKey,
  });
};

export const encryptByRecordWithMasterKey = <T extends IDable>(
  sMasterKey: string,
  keyCollection: Collection<KeyRecord<T['id']>>,
  cacheSize: number = 0,
  cr: Encryption<unknown> = nodeEncryptionSync,
) => <F extends readonly (keyof Omit<T, 'id'> & string)[]>(
  baseCollection: Collection<Wrapped<T, F[-1], string>>,
  fields: F,
): Collection<T> => encryptByRecord<T>(
  encryptByKey<KeyRecord<T['id']>>(sMasterKey, cr)(keyCollection, ['key']),
  cacheSize,
  cr,
)(baseCollection, fields);
