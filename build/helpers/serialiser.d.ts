export declare function serialiseValue(value: unknown): string;
export declare function deserialiseValue(value: string): unknown;
export declare function serialiseRecord<T>(record: T): Record<string, string>;
export declare function deserialiseRecord(record: Record<string, string | null>): Record<string, unknown>;
