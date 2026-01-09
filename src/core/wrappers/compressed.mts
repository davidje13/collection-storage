import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { IDable } from '../interfaces/IDable.mts';
import type { Collection } from '../interfaces/Collection.mts';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser.mts';
import { debugType } from '../helpers/debugType.mts';
import { WrappedCollection, type Wrapped } from './WrappedCollection.mts';

type CompressableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];

export type Compressed<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;

export interface CompressOptions {
  allowRaw?: boolean;
  allowRawBuffer?: boolean;
  compressionThresholdBytes?: number;
}

const gzipCompress = promisify<Buffer, Buffer>(zlib.gzip);
const gzipDecompress = promisify<Buffer, Buffer>(zlib.gunzip);

const MARK_UNCOMPRESSED = Buffer.of(0);

async function compressValue(
  v: unknown,
  { compressionThresholdBytes = 200 }: CompressOptions,
): Promise<Buffer> {
  const serialised = serialiseValueBin(v);
  if (serialised.length >= compressionThresholdBytes) {
    const gzipped = await gzipCompress(serialised);
    if (gzipped.length < serialised.length + 1) {
      return gzipped;
    }
  }
  return Buffer.concat([MARK_UNCOMPRESSED, serialised]);
}

async function decompressValue(
  collectionName: string,
  attr: string,
  v: Buffer,
  { allowRaw = true, allowRawBuffer = false }: CompressOptions,
): Promise<any> {
  if (!(v instanceof Buffer)) {
    if (allowRaw) {
      return v; // probably an old record before compression was added
    }
    throw new Error(`uncompressed data in ${collectionName}.${attr}: ${debugType(v)}`);
  }
  if (v[0] === 0x1f && v[1] === 0x8b) {
    // gzip "magic number"
    return deserialiseValueBin(await gzipDecompress(v));
  }
  if (v[0] === MARK_UNCOMPRESSED[0]) {
    return deserialiseValueBin(v.subarray(1));
  }
  if (allowRaw && allowRawBuffer) {
    return v;
  }
  throw new Error(
    `unknown compression format or uncompressed byte data in ${collectionName}.${attr}`,
  );
}

export function compress<T extends IDable, F extends CompressableKeys<T>>(
  attributes: F,
  baseCollection: Collection<Compressed<T, F[number]>>,
  options: CompressOptions = {},
): Collection<T> {
  return new WrappedCollection<T, F, Buffer, never>(baseCollection, attributes, {
    wrap: (_, v): Promise<Buffer> => compressValue(v, options),
    unwrap: (attr, v): Promise<any> => decompressValue(baseCollection.name, attr, v, options),
  });
}
