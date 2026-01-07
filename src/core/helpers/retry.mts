const sleep = (millis: number) => new Promise<void>((resolve) => setTimeout(resolve, millis));

export const retry = (
  shouldRetry: (e: unknown) => boolean,
  {
    timeoutMillis = 60000,
    initialDelayMillis = 20,
    maxDelayMillis = 5000,
    delayGrowth = 2,
    jitter = true,
  } = {},
) => ({
  promise: async <T,>(fn: () => Promise<T> | T): Promise<T> => {
    const limit = Date.now() + timeoutMillis;
    let currentDelay = initialDelayMillis;
    for (let attempt = 1; ; ++attempt) {
      try {
        return await fn();
      } catch (e) {
        if (!shouldRetry(e)) {
          throw e;
        }

        const delay = Math.min(currentDelay, maxDelayMillis) * (jitter ? Math.random() : 1);
        currentDelay *= delayGrowth;

        if (Date.now() + delay > limit) {
          if (e instanceof Error) {
            e.message += ` (timeout after ${attempt} attempts)`;
          }
          throw e;
        }

        await sleep(delay);
      }
    }
  },

  generator: async function* <T>(
    fn: () => AsyncGenerator<T, void, undefined>,
  ): AsyncGenerator<T, void, undefined> {
    const limit = Date.now() + timeoutMillis;
    let currentDelay = initialDelayMillis;
    for (let attempt = 1; ; ++attempt) {
      let any = false;
      try {
        for await (const item of fn()) {
          any = true;
          yield item;
        }
        return;
      } catch (e) {
        if (any || !shouldRetry(e)) {
          throw e;
        }

        const delay = Math.min(currentDelay, maxDelayMillis) * (jitter ? Math.random() : 1);
        currentDelay *= delayGrowth;

        if (Date.now() + delay > limit) {
          if (e instanceof Error) {
            e.message += ` (timeout after ${attempt} attempts)`;
          }
          throw e;
        }

        await sleep(delay);
      }
    }
  },
});
