export function serialiseValue(
  value: unknown,
): string {
  if (value instanceof Buffer) {
    return `B${value.toString('base64')}`;
  }
  return `J${JSON.stringify(value)}`;
}

export function deserialiseValue(
  value: string,
): unknown {
  const type = value[0];
  const data = value.substr(1);
  if (type === 'B') {
    return Buffer.from(data, 'base64');
  }
  if (type === 'J') {
    return JSON.parse(data);
  }
  throw new Error(`Unknown data type ${type}`);
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
