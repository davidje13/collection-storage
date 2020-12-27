/// <reference types="node" />
export declare function canonicalJSON(o: Record<string, unknown> | undefined): string;
export declare function serialiseValue(value: unknown): string;
export declare function deserialiseValue(value: string): unknown;
export declare function serialiseValueBin(value: unknown): Buffer;
export declare function deserialiseValueBin(value: Buffer | string): unknown;
export declare type Serialised<T> = Map<string & keyof T, string>;
export declare function serialiseRecord<T>(item: T): Serialised<T>;
export declare function deserialiseRecord<T>(serialised: Serialised<T>): T;
export declare function partialDeserialiseRecord<T, F extends readonly (string & keyof T)[]>(serialised: Serialised<T>, fields?: F): Pick<T, F[-1]>;
//# sourceMappingURL=serialiser.d.ts.map