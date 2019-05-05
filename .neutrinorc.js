const airbnbBase = require('@neutrinojs/airbnb-base');
const library = require('@neutrinojs/library');
const jest = require('@neutrinojs/jest');

module.exports = {
  options: {
    root: __dirname,
    tests: 'src',
  },
  use: [
    airbnbBase({
      eslint: {
        rules: {
          'arrow-parens': ['error', 'always'],
          'operator-linebreak': ['error', 'after'],
          'object-curly-newline': ['error', {
            'multiline': true,
            'consistent': true,
            'minProperties': 5,
          }],
        },
      },
    }),
    library({
      name: 'websocket-express',
      target: 'node',
      babel: {
        presets: [
          ['@babel/preset-env', {
            useBuiltIns: false,
            targets: {
              node: '10.15',
            },
          }],
        ],
        plugins: [
          'transform-dynamic-import',
        ],
      },
    }),
    jest()
  ]
};
