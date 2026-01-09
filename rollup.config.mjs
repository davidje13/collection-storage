import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';

const MODULES = [
  'core',
  'dynamodb',
  'mongodb',
  'postgresql',
  'redis',
  'sqlite',
];

const TERSER_OPTS = {
  ecma: 2015,
  module: true,
  format: { ascii_only: true, preserve_annotations: true },
  mangle: {
    properties: {
      regex: /^_/,
      reserved: [
        '__type', // used in AWS API responses
      ],
    },
  },
};

const EXTERNAL = [
  /node:.*/,
  /^.*\/core\/index\.mts$/, // Once Node 20 is dropped, this can change to 'collection-storage'
  'mongodb',
  'pg',
  'ioredis',
];

// this is only needed for Node 20 support - once dropped, the imports can
// be re-written as collection-storage and this mapping can be removed
const PATHS = (p) =>
  /^.*\/core\/index\.mts$/.test(p) ? 'collection-storage' : p;

export default [
  ...MODULES.map((m) => ({
    input: `./src/${m}/index.mts`,
    output: { file: `build/${m}/index.mjs`, format: 'esm', paths: PATHS },
    makeAbsoluteExternalsRelative: false, // TODO: remove once Node 20 is dropped
    external: EXTERNAL,
    plugins: [
      typescript({
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rewriteRelativeImportExtensions: true,
          rootDir: '.',
          declarationDir: `./build/${m}/types`,
        },
        exclude: ['**/*.test.*', 'src/test-helpers/**'],
        tslib: {},
      }),
      terser(TERSER_OPTS),
    ],
  })),
  ...MODULES.map((m) => ({
    input: `./build/${m}/types/src/${m}/index.d.mts`,
    output: { file: `build/${m}/index.d.mts`, format: 'esm', paths: PATHS },
    makeAbsoluteExternalsRelative: false, // TODO: remove once Node 20 is dropped
    external: EXTERNAL,
    plugins: [dts()],
  })),
];
