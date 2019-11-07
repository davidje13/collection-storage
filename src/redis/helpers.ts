import { Redis, Pipeline, MultiOptions } from 'ioredis';

// Thanks, https://stackoverflow.com/a/50014868/1180785
type ArgumentTypes<T> = T extends (...args: infer U) => any ? U : never;

type PipelineVersions<I> = {
  [K in keyof I]: (...args: ArgumentTypes<I[K]>) => Pipeline & PipelineVersions<I>;
};

interface RedisWithExtendedPipeline<I> extends Redis {
  multi(commands?: string[][], options?: MultiOptions): Pipeline & PipelineVersions<I>;
  multi(options: { pipeline: false }): Promise<string>;
}

export type ExtendedRedis<I> = I & RedisWithExtendedPipeline<I>;

export async function multiExec(
  client: Redis,
  commands: string[][],
): Promise<[unknown, any][] | null> {
  if (!commands.length) {
    return [];
  }
  return client.multi(commands).exec();
}

export function minifyLuaScript(
  lines: string[],
  ...argNames: string[]
): string {
  let combined = lines.map((ln) => ln.trim()).join(' ');
  argNames.forEach((name, i) => {
    combined = combined.replace(new RegExp(`\\$${name}\\b`, 'g'), `ARGV[${i + 1}]`);
  });
  return combined;
}
