type It = typeof global.it;
type Describe = typeof global.describe;

interface Converted {
  it: It;
  describe: Describe;
}

export type TestWrapper<T> = (
  testPath: string[],
  fn: () => Promise<void> | void,
  data: T,
) => Promise<void>;

const testPathStack: string[] = [];

function makeJestItProxy<T>(it: It, wrap: TestWrapper<T>, data: T): It {
  return new Proxy(it, {
    apply: (target, thisArg, [name, fn, timeout]): void => {
      const testPath = [...testPathStack, name];
      target(name, () => wrap(testPath, fn, data), timeout);
    },
    get: (target, p): any => makeJestItProxy((target as any)[p], wrap, data),
  });
}

function makeJestDescribeProxy(describe: Describe): Describe {
  return new Proxy(describe, {
    apply: (target, thisArg, [name, fn]): any => target(name, (): void => {
      testPathStack.push(name);
      fn();
      testPathStack.pop();
    }),
    get: (target, p): any => makeJestDescribeProxy((target as any)[p]),
  });
}

export function wrapJest<T>(
  wrap: TestWrapper<T> | undefined,
  data: T,
): Converted {
  if (!wrap) {
    return {
      it: global.it,
      describe: global.describe,
    };
  }
  return {
    it: makeJestItProxy(global.it, wrap, data),
    describe: makeJestDescribeProxy(global.describe),
  };
}
