import type { Redis, Pipeline, MultiOptions, Ok } from 'ioredis';
declare type ArgumentTypes<T> = T extends (...args: infer U) => any ? U : never;
declare type PipelineVersions<I> = {
    [K in keyof I]: (...args: ArgumentTypes<I[K]>) => Pipeline & PipelineVersions<I>;
};
interface RedisWithExtendedPipeline<I> extends Redis {
    multi(commands?: string[][], options?: MultiOptions): Pipeline & PipelineVersions<I>;
    multi(options: {
        pipeline: false;
    }): Promise<Ok>;
}
export declare type ExtendedRedis<I> = I & RedisWithExtendedPipeline<I>;
export declare function multiExec(client: Redis, commands: string[][]): Promise<[unknown, any][] | null>;
export declare function minifyLuaScript(lines: string[], ...argNames: string[]): string;
export {};
//# sourceMappingURL=helpers.d.ts.map