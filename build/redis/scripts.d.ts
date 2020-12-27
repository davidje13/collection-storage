import type { Redis as RedisT } from 'ioredis';
import { ExtendedRedis } from './helpers';
export interface ScriptExtensions {
    add(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
    update(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
    checkUpdate(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
    updateWithoutCheck(keyCount: number, ...keysAndArgs: unknown[]): Promise<void>;
    remove(keyCount: number, ...keysAndArgs: unknown[]): Promise<void>;
}
export declare type ERedis = ExtendedRedis<ScriptExtensions>;
export default function defineAllScripts(client: RedisT): ERedis;
//# sourceMappingURL=scripts.d.ts.map