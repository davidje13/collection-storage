export function safeSet<T extends object, K extends keyof T>(o: T, k: K, value: T[K]) {
  if (k in o) {
    Object.defineProperty(o, k, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } else {
    o[k] = value;
  }
}

export function safeGet<T, K extends keyof T>(o: T, k: K): T[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(o, k)) {
    return undefined;
  }
  return o[k];
}

export function makeKeyValue<V>(key: string, value: V): { [k: string]: V } {
  return Object.fromEntries([[key, value]]);
}

export function mapEntries<T extends object, B, KOut extends string = keyof T & string>(
  input: T,
  valueMapper: (a: T[any]) => B,
  keyMapper = (k: keyof T & string): KOut => k as string as KOut,
): Record<KOut, B> {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [keyMapper(k as keyof T & string), valueMapper(v)]),
  ) as Record<KOut, B>;
}
