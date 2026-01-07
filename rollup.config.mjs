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

const EXTERNAL = [/node:.*/, 'collection-storage', 'mongodb', 'pg', 'ioredis'];

export default [
  ...MODULES.map((m) => ({
    input: `./src/${m}/index.mts`,
    output: { file: `build/${m}/index.mjs`, format: 'esm' },
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
    output: { file: `build/${m}/index.d.mts`, format: 'esm' },
    external: EXTERNAL,
    plugins: [dts()],
  })),
];
