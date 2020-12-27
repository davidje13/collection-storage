export function safeAdd<K extends keyof any, V>(o: Record<K, V>, k: K, value: V): void {
  /* eslint-disable no-param-reassign */ // purpose of this function
  if (o[k]) {
    Object.defineProperty(o, k, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } else {
    o[k] = value;
  }
  /* eslint-enable no-param-reassign */
}

function safeGet<T, K extends keyof T>(o: T, k: K): T[K] | undefined;
/* eslint-disable-next-line @typescript-eslint/ban-types */ // "any non-nullish value" is intended
function safeGet(o: object, k: string): unknown;

/* eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types */ // types above
function safeGet(o: any, k: keyof any): unknown {
  if (!Object.prototype.hasOwnProperty.call(o, k)) {
    return undefined;
  }
  return o[k];
}

export { safeGet };

export function makeKeyValue<V>(key: string, value: V): { [k: string]: V } {
  const result = {} as Record<string, V>;
  safeAdd(result, key, value);
  return result;
}

export function mapEntries<K extends keyof any, A, B>(
  input: Record<K, A>,
  map: (a: A) => B,
  keyMapper?: (k: K) => K,
): Record<K, B> {
  const result = {} as Record<K, B>;
  Object.entries(input).forEach(([k, v]) => {
    const value = map(v as A);
    const newKey = keyMapper ? keyMapper(k as K) : (k as K);
    safeAdd(result, newKey, value);
  });
  return result;
}
