/// <reference types="node" />
declare type Method = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
interface RequestOptions {
    method: Method;
    url: URL | string;
    region: string;
    service: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown> | Buffer;
    date?: Date;
}
interface FetchResponse {
    status: number;
    json: unknown;
}
export default class AWS {
    private readonly keyID;
    private readonly baseKey;
    private readonly keyCacheDate;
    private readonly keyCacheRegion;
    private readonly keyCache;
    private readonly inflight;
    private closed;
    constructor(keyID: string, secret: string);
    do<T>(fn: () => Promise<T>): Promise<T>;
    request({ method, url, region, service, headers, body, date, }: RequestOptions): Promise<FetchResponse>;
    close(): Promise<void>;
    private fetch;
    private getKey;
}
export {};
//# sourceMappingURL=AWS.d.ts.map