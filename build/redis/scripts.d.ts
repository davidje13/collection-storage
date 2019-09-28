import { Redis } from 'ioredis';
import { ExtendedRedis } from './helpers';
export interface ScriptExtensions {
    add(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
    update(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
    remove(keyCount: number, ...keysAndArgs: any[]): Promise<void>;
}
export default function defineAllScripts(client: Redis): ExtendedRedis<ScriptExtensions>;
