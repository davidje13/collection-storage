import { Redis } from 'ioredis';
import { minifyLuaScript, ExtendedRedis } from './helpers';

export interface ScriptExtensions {
  add(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
  update(keyCount: number, ...keysAndArgs: any[]): Promise<number>;
  remove(keyCount: number, ...keysAndArgs: any[]): Promise<void>;
}

export type ERedis = ExtendedRedis<ScriptExtensions>;

// KEYS = [id, ...uniqueKeys, ...nonUniqueKeys]
const SCRIPT_ADD_ITEM = minifyLuaScript([
  'if redis.call("exists",KEYS[1])==1 then',
  '  return 0',
  'end',
  'for k=2,1+tonumber($uniqueKeyCount) do',
  '  if redis.call("exists",KEYS[k])==1 then',
  '    return 0',
  '  end',
  'end',
  'redis.call("hset",KEYS[1],unpack(ARGV, 2))',
  'for k=2,#KEYS do',
  '  redis.call("sadd",KEYS[k],ARGV[3])',
  'end',
  'return 1',
], 'uniqueKeyCount');

// KEYS = [id, ...patchUniqueKeys, ...patchNonUniqueKeys, ...oldUniqueKeys, ...oldNonUniqueKeys]
const SCRIPT_UPDATE_ITEM = minifyLuaScript([
  'local tkc=tonumber($totalKeyCount)',
  'for k=2,1+tonumber($uniqueKeyCount) do',
  '  if redis.call("exists",KEYS[k])==1 then',
  '    return 0',
  '  end',
  'end',
  'redis.call("hset",KEYS[1],unpack(ARGV, 4))',
  'for k=1,tkc do',
  '  redis.call("smove",KEYS[1+tkc+k],KEYS[1+k],$id)',
  'end',
  'return 1',
], 'uniqueKeyCount', 'totalKeyCount', 'id');

// KEYS = [id, ...keys]
const SCRIPT_REMOVE_ITEM = minifyLuaScript([
  'redis.call("del",KEYS[1])',
  'for k=2,#KEYS do',
  '  redis.call("srem",KEYS[k],$id)',
  'end',
], 'id');

export default async function defineAllScripts(
  client: Redis,
): Promise<ERedis> {
  await client.defineCommand('add', { lua: SCRIPT_ADD_ITEM });
  await client.defineCommand('update', { lua: SCRIPT_UPDATE_ITEM });
  await client.defineCommand('remove', { lua: SCRIPT_REMOVE_ITEM });

  return client as ERedis;
}
