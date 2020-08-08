import { createHash, createHmac } from 'crypto';
import https from 'https';
import http from 'http';
import PromiseTracker from '../../helpers/PromiseTracker';
import LruCache from '../../helpers/LruCache';
import retry from '../../helpers/retry';

type Method = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';

const EMPTY_BUFFER = Buffer.alloc(0);
const ISO_TIME_STRIP = /(-|:|\.[0-9]*)/g;
const ALGORITHM = 'AWS4-HMAC-SHA256';

const withErrorRetry = retry(() => true);

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
  headers?: Record<string, string>;
  body?: string | object | Buffer;
  date?: Date;
}

interface FetchResponse {
  status: number;
  text: string;
}

export interface AWSErrorResponse {
  __type: string;
  message: string;
}

export class AWS {
  private readonly baseKey: Buffer;

  private readonly keyCacheDate = new LruCache<string, Buffer>(1);

  private readonly keyCacheRegion = new LruCache<string, Buffer>(4);

  private readonly keyCache = new LruCache<string, Buffer>(16);

  private readonly inflight = new PromiseTracker();

  private closed = false;

  constructor(
    private readonly keyID: string,
    secret: string,
  ) {
    this.baseKey = Buffer.from(`AWS4${secret}`, 'utf8');
  }

  do<T>(fn: () => Promise<T>): Promise<T> {
    return this.inflight.do(fn);
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

    const parsedURL = (url instanceof URL) ? url : new URL(url);
    if (parsedURL.search) {
      throw new Error('AWS urls with query strings are not supported');
    }
    if (this.closed) {
      throw new Error('connection closed');
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
    const key = this.getKey(canonicalDate, region, service);

    // AWS requires double-uri-encoding, and pathname uses non-standard encoding
    const canonicalPath = encodeURI(encodeURI(decodeURI(parsedURL.pathname))) || '/';
    const canonicalQueryString = '';

    const allHeaders: Record<string, string> = {
      ...headers,
      Host: parsedURL.host,
      'X-Amz-Date': canonicalTime,
    };

    // string comparison is intended
    /* eslint-disable-next-line @typescript-eslint/require-array-sort-compare */
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

    allHeaders.Authorization = [
      `${ALGORITHM} Credential=${this.keyID}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    delete allHeaders.Host; // will be auto-added by node

    return this.fetch(parsedURL, binaryBody, {
      method,
      headers: allHeaders,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.inflight.wait();
    this.closed = true;
  }

  private fetch(
    url: URL,
    body: Buffer,
    options: http.RequestOptions,
  ): Promise<FetchResponse> {
    if (this.closed) {
      throw new Error('connection closed');
    }

    const protocol = (url.protocol === 'https') ? https : http;
    return this.inflight.do(() => withErrorRetry(() => new Promise((resolve, reject) => {
      const req = protocol.request(url, options, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (chunk) => parts.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          parts.length = 0;
          resolve({ status: res.statusCode || 0, text });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    })));
  }

  private getKey(
    canonicalDate: string,
    region: string,
    service: string,
  ): Buffer {
    return this.keyCache.cached(`${canonicalDate}/${region}/${service}`, () => {
      const kRegion = this.keyCacheRegion.cached(`${canonicalDate}/${region}`, () => hmac(
        this.keyCacheDate.cached(canonicalDate, () => hmac(this.baseKey, canonicalDate)),
        region,
      ));
      return hmac(hmac(kRegion, service), 'aws4_request');
    });
  }
}
