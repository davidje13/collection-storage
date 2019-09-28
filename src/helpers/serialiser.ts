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
