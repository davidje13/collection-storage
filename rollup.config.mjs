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
    properties: { regex: /^_/ },
  },
};

const EXTERNAL = [
  /node:.*/,
  'collection-storage/index.mts', // Once Node 20 is dropped, this can change to collection-storage
  'mongodb',
  'pg',
  'ioredis',
];

// these are only needed for Node 20 support - once dropped, the imports can
// be re-written as collection-storage and this mapping and warning suppression can be removed
const PATHS = (p) =>
  p === 'collection-storage/index.mts' ? 'collection-storage' : p;
const SUPPRESS_ABSOLUTE_MTS = (warning, warn) => {
  if (warning.plugin !== 'typescript' || warning.pluginCode !== 'TS2877') {
    warn(warning);
  }
};

export default [
  ...MODULES.map((m) => ({
    input: `./src/${m}/index.mts`,
    output: { file: `build/${m}/index.mjs`, format: 'esm', paths: PATHS },
    onwarn: SUPPRESS_ABSOLUTE_MTS,
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
    external: EXTERNAL,
    plugins: [dts()],
  })),
];
