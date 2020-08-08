import type { AWS } from './AWS';

export interface Results<I> {
  batched(consumer: (items: Readonly<I[]>) => (Promise<void> | void)): Promise<void> | void;

  all(): Promise<Readonly<I[]>> | Readonly<I[]>;
}

export class Paged<K, I> implements Results<I> {
  constructor(
    private readonly aws: AWS,
    private readonly fn: (start: K | undefined) => Promise<[I[], K]>,
    private readonly pageLimit = Number.POSITIVE_INFINITY,
  ) {}

  batched(consumer: (items: I[]) => (Promise<void> | void)): Promise<void> {
    return this.aws.do(async () => {
      let lastKey: K | undefined;
      /* eslint-disable no-await-in-loop */ // pagination must be serial
      for (let page = 0; page < this.pageLimit; page += 1) {
        const [pageItems, nextKey]: [I[], K] = await this.fn(lastKey);
        await consumer(pageItems);
        lastKey = nextKey;
        if (!lastKey) {
          return;
        }
      }
      /* eslint-enable no-await-in-loop */
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
