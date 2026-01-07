import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { LruCache, retry } from '../../core/index.mts';
import { PromiseTracker } from '../helpers/PromiseTracker.mts';
import { AWSError } from './AWSError.mts';

type Method = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';

const EMPTY_BUFFER = Buffer.alloc(0);
const ISO_TIME_STRIP = /(-|:|\.[0-9]*)/g;
const ALGORITHM = 'AWS4-HMAC-SHA256';

const withTransientErrorRetry = retry((e) => !(e instanceof AWSError) || e.isTransient());

function sha256(v: Buffer): string {
  const hash = createHash('sha256');
  hash.update(v);
  return hash.digest('hex');
}

function hmac(key: Buffer, data: string): Buffer {
  const hash = createHmac('sha256', key);
  hash.update(data, 'utf8');
  return hash.digest();
}

interface RequestOptions {
  method: Method;
  url: URL | string;
  region: string;
  service: string;
  headers?: Record<string, string> | undefined;
  body?: string | Record<string, unknown> | Buffer | undefined;
  date?: Date | undefined;
}

interface FetchResponse {
  status: number;
  json: unknown;
}

interface AWSErrorResponse {
  __type: string;
  message: string;
}

export class AWS {
  /** @internal */ private readonly _keyID: string;
  /** @internal */ private readonly _baseKey: Buffer;
  /** @internal */ private readonly _keyCacheDate = new LruCache<string, Buffer>(1);
  /** @internal */ private readonly _keyCacheRegion = new LruCache<string, Buffer>(4);
  /** @internal */ private readonly _keyCache = new LruCache<string, Buffer>(16);
  /** @internal */ private readonly _inflight = new PromiseTracker();
  /** @internal */ private _closed = false;

  constructor(keyID: string, secret: string) {
    this._keyID = keyID;
    this._baseKey = Buffer.from(`AWS4${secret}`, 'utf8');
  }

  do<T>(fn: () => Promise<T>): Promise<T> {
    return this._inflight.do(fn);
  }

  request({
    method,
    url,
    region,
    service,
    headers = {},
    body = EMPTY_BUFFER,
    date = new Date(),
  }: RequestOptions): Promise<FetchResponse> {
    // https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html

    const parsedURL = url instanceof URL ? url : new URL(url);
    if (parsedURL.search) {
      throw new Error('AWS urls with query strings are not supported');
    }
    if (this._closed) {
      throw new Error('Connection _closed');
    }

    let binaryBody: Buffer;
    if (body instanceof Buffer) {
      binaryBody = body;
    } else if (typeof body === 'string') {
      binaryBody = Buffer.from(body, 'utf8');
    } else {
      binaryBody = Buffer.from(JSON.stringify(body), 'utf8');
    }

    const canonicalTime = date.toISOString().replace(ISO_TIME_STRIP, ''); // YYYYMMDD'T'HHmmSS'Z'
    const canonicalDate = canonicalTime.substr(0, 8); // YYYYMMDD
    const credentialScope = `${canonicalDate}/${region}/${service}/aws4_request`;
    const key = this._getKey(canonicalDate, region, service);

    // AWS requires double-uri-encoding, and pathname uses non-standard encoding
    const canonicalPath = encodeURI(encodeURI(decodeURI(parsedURL.pathname))) || '/';
    const canonicalQueryString = '';

    const allHeaders: Record<string, string> = {
      ...headers,
      Host: parsedURL.host,
      'X-Amz-Date': canonicalTime,
    };

    const headerNames = Object.keys(allHeaders)
      .map((header) => header.toLowerCase())
      .sort();

    const canonicalHeaders = headerNames
      .map((header) => `${header}:${allHeaders[header]}\n`)
      .join('');
    const signedHeaders = headerNames.join(';');

    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      sha256(binaryBody),
    ].join('\n');

    const stringToSign = [
      ALGORITHM,
      canonicalTime,
      credentialScope,
      sha256(Buffer.from(canonicalRequest, 'utf8')),
    ].join('\n');

    const signature = hmac(key, stringToSign).toString('hex');

    allHeaders['Authorization'] = [
      `${ALGORITHM} Credential=${this._keyID}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    delete allHeaders['Host']; // will be auto-added by node

    return this._fetch(parsedURL, binaryBody, {
      method,
      headers: allHeaders,
    });
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    await this._inflight.wait();
    this._closed = true;
  }

  /** @internal */ private _fetch(
    url: URL,
    body: Buffer,
    options: http.RequestOptions,
  ): Promise<FetchResponse> {
    if (this._closed) {
      throw new Error('Connection _closed');
    }

    const protocol = url.protocol === 'https' ? https : http;
    return this._inflight.do(() =>
      withTransientErrorRetry.promise(
        () =>
          new Promise((resolve, reject) => {
            const req = protocol.request(url, options, (res) => {
              const parts: Buffer[] = [];
              res.on('data', (chunk) => parts.push(chunk));
              res.on('end', () => {
                try {
                  const text = Buffer.concat(parts).toString('utf8');
                  parts.length = 0;
                  const json = JSON.parse(text) as AWSErrorResponse;
                  if (!res.statusCode || res.statusCode >= 300) {
                    reject(new AWSError(res.statusCode || 0, json.__type, json.message));
                  } else {
                    resolve({ status: res.statusCode, json });
                  }
                } catch (e) {
                  reject(e);
                }
              });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
          }),
      ),
    );
  }

  /** @internal */ private _getKey(canonicalDate: string, region: string, service: string): Buffer {
    return this._keyCache.cached(`${canonicalDate}/${region}/${service}`, () => {
      const kRegion = this._keyCacheRegion.cached(`${canonicalDate}/${region}`, () =>
        hmac(
          this._keyCacheDate.cached(canonicalDate, () => hmac(this._baseKey, canonicalDate)),
          region,
        ),
      );
      return hmac(hmac(kRegion, service), 'aws4_request');
    });
  }
}
