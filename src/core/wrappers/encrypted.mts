import type { IDable, IDableBy, IDType } from '../interfaces/IDable.mts';
import type { Collection } from '../interfaces/Collection.mts';
import { LruCache } from '../helpers/LruCache.mts';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser.mts';
import { WrappedCollection, type Wrapped } from './WrappedCollection.mts';
import type { Encryption } from './encryption/Encryption.mts';
import { nodeEncryptionSync } from './encryption/nodeEncryptionSync.mts';
import { cache, type CacheOptions } from './cached.mts';

export interface KeyRecord<ID extends IDType, KeyT> {
  id: ID;
  key: KeyT;
}

export type Encrypted<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;

type EncryptableAttributes<T> = readonly (keyof Omit<T, 'id'> & string)[];

type Encrypter<ID extends IDType> = <T extends IDableBy<ID>>() => <
  F extends EncryptableAttributes<T>,
>(
  attributes: F,
  baseCollection: Collection<Encrypted<T, F[number]>>,
) => Collection<T>;

// makeEncrypter provides optional 2-tier function call due to
// https://github.com/Microsoft/TypeScript/issues/26242

function makeEncrypter<ID extends IDType>(
  wrapper: <T extends IDableBy<ID>, F extends EncryptableAttributes<T>>(
    attributes: F,
    baseCollection: Collection<Encrypted<T, F[number]>>,
  ) => Collection<T>,
): Encrypter<ID> {
  return (attributes?: any, baseCollection?: Collection<any>): any => {
    if (attributes && baseCollection) {
      // non-typescript API (remove need for extra ())
      return wrapper(attributes, baseCollection) as any;
    }
    return wrapper;
  };
}

export interface EncryptionOptions<KeyT = Buffer, SerialisedKeyT = Buffer> {
  allowRaw?: boolean;
  encryption?: Encryption<KeyT, SerialisedKeyT>;
}

export interface RecordEncryptionOptions {
  keyCache?: CacheOptions;
}

interface CustomEncryptionOptions<KeyT, SerialisedKeyT> extends EncryptionOptions<
  KeyT,
  SerialisedKeyT
> {
  encryption: Encryption<KeyT, SerialisedKeyT>;
}

function encryptByKey(sKey: Buffer, options?: EncryptionOptions): Encrypter<IDType>;

function encryptByKey<KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  options: CustomEncryptionOptions<KeyT, SerialisedKeyT>,
): Encrypter<IDType>;

function encryptByKey<KeyT, SerialisedKeyT>(
  sKey: SerialisedKeyT,
  {
    encryption = nodeEncryptionSync as any,
    allowRaw = false,
  }: EncryptionOptions<KeyT, SerialisedKeyT> = {},
): Encrypter<IDType> {
  const key = encryption.deserialiseKey(sKey);

  return makeEncrypter(
    <T extends IDable, F extends EncryptableAttributes<T>>(
      attributes: F,
      baseCollection: Collection<Encrypted<T, F[number]>>,
    ) =>
      new WrappedCollection<T, F, Buffer, never>(baseCollection, attributes, {
        wrap: (_, v): Promise<Buffer> | Buffer => encryption.encrypt(key, serialiseValueBin(v)),
        unwrap: async (_, v): Promise<any> => {
          if (!(v instanceof Buffer)) {
            if (allowRaw) {
              return v; // probably an old record before encryption was added
            }
            throw new Error('unencrypted data');
          }
          return deserialiseValueBin(await encryption.decrypt(key, v));
        },
      }),
  );
}

function encryptByRecord<ID extends IDType>(
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  options?: EncryptionOptions & RecordEncryptionOptions,
): Encrypter<ID>;

function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  options: CustomEncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions,
): Encrypter<ID>;

function encryptByRecord<ID extends IDType, KeyT, SerialisedKeyT>(
  keyCollection: Collection<KeyRecord<ID, SerialisedKeyT>>,
  {
    encryption = nodeEncryptionSync as any,
    allowRaw = false,
    keyCache,
    ...extraOptions
  }: EncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions = {},
): Encrypter<ID> {
  if ((extraOptions as any).cacheSize) {
    throw new Error(
      '{ cacheSize: size } is deprecated; use { keyCache: { capacity: size } } instead',
    );
  }

  if (keyCache) {
    keyCollection = cache(keyCollection, keyCache);
  }

  const rawKeyCache = new LruCache<SerialisedKeyT, KeyT>(1024);

  const loadKey = async (
    generateIfNeeded: boolean,
    record: { id?: ID | undefined },
  ): Promise<KeyT> => {
    const { id } = record;

    if (id === undefined) {
      throw new Error('Must provide ID for encryption');
    }

    const item = await keyCollection.where('id', id).attrs(['key']).get();
    if (item) {
      return rawKeyCache.cached(item.key, () => encryption.deserialiseKey(item.key));
    }
    if (!generateIfNeeded) {
      throw new Error('No encryption key found for record');
    }
    const key = await encryption.generateKey();
    const serialisedKey = encryption.serialiseKey(key);
    await keyCollection.add({ id, key: serialisedKey });
    rawKeyCache.add(serialisedKey, key);
    return key;
  };

  const removeKey = async ({ id }: { id: ID }): Promise<void> => {
    await keyCollection.where('id', id).remove();
  };

  // https://github.com/microsoft/TypeScript/issues/39080
  return makeEncrypter<ID>(
    <T extends IDableBy<ID>, F extends EncryptableAttributes<T>>(
      attributes: F,
      baseCollection: Collection<Encrypted<T, F[number]>>,
    ) =>
      new WrappedCollection<T, F, Buffer, KeyT>(baseCollection, attributes, {
        wrap: (_, v, key): Promise<Buffer> | Buffer =>
          encryption.encrypt(key, serialiseValueBin(v)),
        unwrap: async (_, v, key): Promise<any> => {
          if (!(v instanceof Buffer)) {
            if (allowRaw) {
              return v; // probably an old record before encryption was added
            }
            throw new Error('unencrypted data');
          }
          return deserialiseValueBin(await encryption.decrypt(key, v));
        },
        preWrap: loadKey.bind(null, true),
        preUnwrap: loadKey.bind(null, false),
        preRemove: removeKey,
      }),
  );
}

function encryptByRecordWithMasterKey<ID extends IDType>(
  sMasterKey: Buffer,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  options?: EncryptionOptions & RecordEncryptionOptions,
): Encrypter<ID>;

function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  options: CustomEncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions,
): Encrypter<ID>;

function encryptByRecordWithMasterKey<ID extends IDType, KeyT, SerialisedKeyT>(
  sMasterKey: SerialisedKeyT,
  keyCollection: Collection<KeyRecord<ID, Buffer>>,
  options: EncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions = {},
): Encrypter<ID> {
  const opts = options as CustomEncryptionOptions<KeyT, SerialisedKeyT> & RecordEncryptionOptions;
  const keyEnc = encryptByKey(sMasterKey, opts);
  const encKeyCollection = keyEnc<KeyRecord<ID, SerialisedKeyT>>()(['key'], keyCollection);
  return encryptByRecord(encKeyCollection, opts);
}

export { encryptByKey, encryptByRecord, encryptByRecordWithMasterKey };
