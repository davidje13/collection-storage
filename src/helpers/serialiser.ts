// B = base64 binary
// b = raw binary (*Bin functions only)
// s = raw utf8 string
// t = true
// f = false
// n = null
// J = JSON (also accepts any plain JSON value for compatibility)

import { safeAdd } from './safeAccess';

const JSON_INIT_CHARS = '{["0123456789-'; // t/f/n are dedicated values
const MARK_BINARY = 'b'.charCodeAt(0);
const MARK_STRING = 's'.charCodeAt(0);

const MARK_BINARY_BUFF = Uint8Array.of(MARK_BINARY);

export function canonicalJSON(o: Record<string, unknown> | undefined): string {
  if (!o) {
    return 'null';
  }
  const content = Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`)
    .join(',');
  return `{${content}}`;
}

export function serialiseValue(value: unknown): string {
  if (value instanceof Buffer) {
    return `B${value.toString('base64')}`;
  }
  if (typeof value === 'string') {
    return `s${value}`;
  }
  if (typeof value === 'boolean') {
    return value ? 't' : 'f';
  }
  if (value === null) {
    return 'n';
  }
  return `J${JSON.stringify(value)}`;
}

export function deserialiseValue(value: string): unknown {
  const type = value[0];
  const data = value.substr(1);
  switch (type) {
    case 'B': return Buffer.from(data, 'base64');
    case 's': return data;
    case 't': return true;
    case 'f': return false;
    case 'n': return null;
    case 'J': return JSON.parse(data);
    default:
      if (JSON_INIT_CHARS.includes(type)) {
        return JSON.parse(value);
      }
      throw new Error(`Unknown data type ${type}`);
  }
}

export function serialiseValueBin(value: unknown): Buffer {
  if (value instanceof Buffer) {
    return Buffer.concat([MARK_BINARY_BUFF, value]);
  }
  return Buffer.from(serialiseValue(value), 'utf8');
}

export function deserialiseValueBin(value: Buffer | string): unknown {
  if (typeof value === 'string') {
    return deserialiseValue(value);
  }

  const type = value[0];
  if (type === MARK_BINARY) {
    return value.subarray(1);
  }
  if (type === MARK_STRING) {
    return value.subarray(1).toString('utf8');
  }
  return deserialiseValue(value.toString('utf8'));
}

export type Serialised<T> = Map<string & keyof T, string>;

export function serialiseRecord<T>(item: T): Serialised<T> {
  return new Map(Object.entries(item)
    .map(([k, v]) => [k as string & keyof T, serialiseValue(v)]));
}

export function deserialiseRecord<T>(serialised: Serialised<T>): T {
  const result = {} as T;
  serialised.forEach((v, k) => safeAdd(result, k, deserialiseValue(v)));
  return result;
}

export function partialDeserialiseRecord<T, F extends readonly (string & keyof T)[]>(
  serialised: Serialised<T>,
  fields?: F,
): Pick<T, F[-1]> {
  if (!fields) {
    return deserialiseRecord(serialised);
  }
  const result = {} as T;
  fields.forEach((k) => {
    const raw = serialised.get(k);
    if (raw) {
      safeAdd(result, k, deserialiseValue(raw));
    }
  });
  return result;
}
