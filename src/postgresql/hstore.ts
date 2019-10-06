export function quoteHValue(v: string): string {
  return `"${v.replace(/(["\\])/g, '\\$1')}"`;
}

export function encodeHStore(record: Record<string, string>): string {
  const result: string[] = [];
  Object.keys(record).forEach((k) => {
    result.push(`${quoteHValue(k)}=>${quoteHValue(record[k])}`);
  });
  return result.join(',');
}

export function decodeHStore(hstore: string): Record<string, string> {
  const result: Record<string, string> = {};
  let current = '';
  let currentKey = '';
  let quote = false;
  for (let p = 0; p < hstore.length;) {
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
        p += 1;
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
          p += 1;
        }
        break;
      case ',':
        if (quote) {
          current += c;
        } else {
          result[currentKey] = current;
          currentKey = '';
          current = '';
        }
        break;
      default:
        current += c;
        break;
    }
    p += 1;
  }
  if (currentKey) {
    result[currentKey] = current;
  }
  return result;
}
