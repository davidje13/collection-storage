import type { Redis as RedisT } from 'ioredis';
import { minifyLuaScript, type ExtendedRedis } from './helpers.mts';

export interface ScriptExtensions {
  add(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
  update(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
  checkUpdate(keyCount: number, ...keysAndArgs: unknown[]): Promise<number>;
  updateWithoutCheck(keyCount: number, ...keysAndArgs: unknown[]): Promise<void>;
  remove(keyCount: number, ...keysAndArgs: unknown[]): Promise<void>;
}

export type ERedis = ExtendedRedis<ScriptExtensions>;

// KEYS = [id, ...uniqueKeys, ...nonUniqueKeys]
const SCRIPT_ADD = minifyLuaScript(
  [
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
  ],
  'uniqueKeyCount',
);

const FRAG_CHECK_UPDATE = [
  'for k=2,1+tonumber($uniqueKeyCount) do',
  '  if redis.call("exists",KEYS[k])==1 then',
  '    return 0',
  '  end',
  'end',
];

const FRAG_UPDATE = [
  'local tkc=tonumber($totalKeyCount)',
  'redis.call("hset",KEYS[1],unpack(ARGV, 4))',
  'for k=1,tkc do',
  '  redis.call("smove",KEYS[1+tkc+k],KEYS[1+k],$id)',
  'end',
];

// KEYS = [id, ...patchUniqueKeys, ...patchNonUniqueKeys, ...oldUniqueKeys, ...oldNonUniqueKeys]
const SCRIPT_CHECK_UPDATE = minifyLuaScript(
  [...FRAG_CHECK_UPDATE, 'return 1'],
  'uniqueKeyCount',
  'totalKeyCount',
  'id',
);

// KEYS = [id, ...patchUniqueKeys, ...patchNonUniqueKeys, ...oldUniqueKeys, ...oldNonUniqueKeys]
const SCRIPT_UPDATE_WITHOUT_CHECK = minifyLuaScript(
  [...FRAG_UPDATE],
  'uniqueKeyCount',
  'totalKeyCount',
  'id',
);

// KEYS = [id, ...patchUniqueKeys, ...patchNonUniqueKeys, ...oldUniqueKeys, ...oldNonUniqueKeys]
const SCRIPT_UPDATE = minifyLuaScript(
  [...FRAG_CHECK_UPDATE, ...FRAG_UPDATE, 'return 1'],
  'uniqueKeyCount',
  'totalKeyCount',
  'id',
);

// KEYS = [id, ...keys]
const SCRIPT_REMOVE = minifyLuaScript(
  ['redis.call("del",KEYS[1])', 'for k=2,#KEYS do', '  redis.call("srem",KEYS[k],$id)', 'end'],
  'id',
);

export function defineAllScripts(client: RedisT): ERedis {
  client.defineCommand('add', { lua: SCRIPT_ADD });
  client.defineCommand('update', { lua: SCRIPT_UPDATE });
  client.defineCommand('checkUpdate', { lua: SCRIPT_CHECK_UPDATE });
  client.defineCommand('updateWithoutCheck', {
    lua: SCRIPT_UPDATE_WITHOUT_CHECK,
  });
  client.defineCommand('remove', { lua: SCRIPT_REMOVE });

  return client as ERedis;
}
