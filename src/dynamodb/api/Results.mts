import type { AWS } from './AWS.mts';

export interface Results<I> {
  batched(consumer: (items: Readonly<I[]>) => Promise<void> | void): Promise<void> | void;

  all(): Promise<Readonly<I[]>> | Readonly<I[]>;
}

export class Paged<K, I> implements Results<I> {
  /** @internal */ private readonly _aws: AWS;
  /** @internal */ private readonly _fn: (start: K | undefined) => Promise<[I[], K]>;
  /** @internal */ private readonly _pageLimit = Number.POSITIVE_INFINITY;

  constructor(
    aws: AWS,
    fn: (start: K | undefined) => Promise<[I[], K]>,
    pageLimit = Number.POSITIVE_INFINITY,
  ) {
    this._aws = aws;
    this._fn = fn;
    this._pageLimit = pageLimit;
  }

  batched(consumer: (items: I[]) => Promise<void> | void): Promise<void> {
    return this._aws.do(async () => {
      let lastKey: K | undefined;
      for (let page = 0; page < this._pageLimit; ++page) {
        const [pageItems, nextKey]: [I[], K] = await this._fn(lastKey);
        await consumer(pageItems);
        lastKey = nextKey;
        if (!lastKey) {
          return;
        }
      }
      throw new Error('Too many items');
    });
  }

  async all(): Promise<I[]> {
    const items: I[] = [];
    await this.batched((i) => {
      items.push(...i);
    });
    return items;
  }
}
