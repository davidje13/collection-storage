import type { Redis as RedisT, Pipeline as PipelineT, MultiOptions as MultiOptionsT } from 'ioredis';
declare type ArgumentTypes<T> = T extends (...args: infer U) => any ? U : never;
declare type PipelineVersions<I> = {
    [K in keyof I]: (...args: ArgumentTypes<I[K]>) => PipelineT & PipelineVersions<I>;
};
interface RedisWithExtendedPipeline<I> extends RedisT {
    multi(commands?: string[][], options?: MultiOptionsT): PipelineT & PipelineVersions<I>;
    multi(options: {
        pipeline: false;
    }): Promise<string>;
}
export declare type ExtendedRedis<I> = I & RedisWithExtendedPipeline<I>;
export declare function multiExec(client: RedisT, commands: string[][]): Promise<[unknown, any][] | null>;
export declare function minifyLuaScript(lines: string[], ...argNames: string[]): string;
export {};
//# sourceMappingURL=helpers.d.ts.map