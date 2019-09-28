import { Redis } from 'ioredis';
import { ExtendedRedis } from './helpers';
export interface ScriptExtensions {
    add(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
    update(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
    remove(keyCount: number, ...keysAndArgs: any[]): Promise<void>;
}
export declare type ERedis = ExtendedRedis<ScriptExtensions>;
export default function defineAllScripts(client: Redis): Promise<ERedis>;
