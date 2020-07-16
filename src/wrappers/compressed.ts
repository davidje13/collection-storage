import zlib from 'zlib';
import { promisify } from 'util';
import type { IDable } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser';
import WrappedCollection, { Wrapped } from './WrappedCollection';

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

async function compressValue(v: unknown, {
  compressionThresholdBytes = 200,
}: CompressOptions): Promise<Buffer> {
  const serialised = serialiseValueBin(v);
  if (serialised.length >= compressionThresholdBytes) {
    const gzipped = await gzipCompress(serialised);
    if (gzipped.length < serialised.length + 1) {
      return gzipped;
    }
  }
  return Buffer.concat([MARK_UNCOMPRESSED, serialised]);
}

async function decompressValue(v: Buffer, {
  allowRaw = true,
  allowRawBuffer = false,
}: CompressOptions): Promise<any> {
  if (!(v instanceof Buffer)) {
    if (allowRaw) {
      return v; // probably an old record before compression was added
    }
    throw new Error('unknown compression type');
  }
  if (v[0] === 0x1F && v[1] === 0x8B) { // gzip "magic number"
    return deserialiseValueBin(await gzipDecompress(v));
  }
  if (v[0] === MARK_UNCOMPRESSED[0]) {
    return deserialiseValueBin(v.subarray(1));
  }
  if (allowRaw && allowRawBuffer) {
    return v;
  }
  throw new Error('unknown compression type');
}

export function compress<T extends IDable, F extends CompressableKeys<T>>(
  fields: F,
  baseCollection: Collection<Compressed<T, F[-1]>>,
  options: CompressOptions = {},
): Collection<T> {
  return new WrappedCollection<T, F, Buffer, never>(baseCollection, fields, {
    wrap: (k, v): Promise<Buffer> => compressValue(v, options),
    unwrap: (k, v): Promise<any> => decompressValue(v, options),
  });
}
