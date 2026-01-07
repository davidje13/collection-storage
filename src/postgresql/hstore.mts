export function quoteHValue(v: string): string {
  return `"${v.replace(/(["\\])/g, '\\$1')}"`;
}

export function encodeHStore(record: Map<string, string>): string {
  return [...record.entries()].map(([k, v]) => `${quoteHValue(k)}=>${quoteHValue(v)}`).join(',');
}

export function decodeHStore(hstore: string): Map<string, string> {
  const result = new Map<string, string>();
  let current = '';
  let currentKey = '';
  let quote = false;
  for (let p = 0; p < hstore.length; ) {
    const c = hstore[p];
    switch (c) {
      case ' ':
      case '\r':
      case '\n':
      case '\t':
        if (quote) {
          current += c;
        }
        break;
      case '\\':
        current += hstore[p + 1];
        ++p;
        break;
      case '"':
        quote = !quote;
        break;
      case '=':
        if (quote) {
          current += c;
        } else if (hstore[p + 1] === '>') {
          currentKey = current;
          current = '';
          ++p;
        }
        break;
      case ',':
        if (quote) {
          current += c;
        } else {
          result.set(currentKey, current);
          currentKey = '';
          current = '';
        }
        break;
      default:
        current += c;
        break;
    }
    ++p;
  }
  if (currentKey) {
    result.set(currentKey, current);
  }
  return result;
}
