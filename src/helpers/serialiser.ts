// B = base64 binary
// b = raw binary (*Bin functions only)
// s = raw utf8 string
// t = true
// f = false
// n = null
// J = JSON (also accepts any plain JSON value for compatibility)

const JSON_INIT_CHARS = '{["0123456789-'; // t/f/n are dedicated values
const MARK_BINARY = 'b'.charCodeAt(0);
const MARK_STRING = 's'.charCodeAt(0);

const MARK_BINARY_BUFF = Uint8Array.of(MARK_BINARY);

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

export function serialiseRecord<T>(
  record: T,
): Record<string, string> {
  const result: Record<string, string> = {};
  Object.keys(record).forEach((k) => {
    result[k] = serialiseValue((record as any)[k]);
  });
  return result;
}

export function deserialiseRecord(
  record: Record<string, string | null>,
): Record<string, unknown> {
  const result: Record<string, any> = {};
  Object.keys(record).forEach((k) => {
    const v = record[k];
    if (v) {
      result[k] = deserialiseValue(v);
    }
  });
  return result;
}
