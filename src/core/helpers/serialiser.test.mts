import {
  serialiseValue,
  deserialiseValue,
  serialiseValueBin,
  deserialiseValueBin,
} from './serialiser.mts';
import 'lean-test';

const TEST_VALUES = [
  'test',
  123,
  -7,
  0.5,
  0,
  true,
  false,
  null,
  { a: 1 },
  ['a', 2],
  Buffer.of(1, 2, 3, 4),
  Buffer.of(),
  Buffer.from('true', 'utf8'),
];

describe(
  'string serialisers',
  () => {
    it('deserialises to the same value', (input) => {
      const serialised = serialiseValue(input);
      const deserialised = deserialiseValue(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });

    it('deserialises raw JSON', (input) => {
      if (!(input instanceof Buffer)) {
        const serialised = JSON.stringify(input);
        const deserialised = deserialiseValue(serialised);
        expect(deserialised).toEqual(input);
      }
    });
  },
  { parameters: TEST_VALUES },
);

describe(
  'binary serialisers',
  () => {
    it('deserialises to the same value', (input) => {
      const serialised = serialiseValueBin(input);
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });

    it('deserialises string-serialised values', (input) => {
      const serialised = serialiseValue(input);
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });

    it('deserialises binary string-serialised values', (input) => {
      const serialised = Buffer.from(serialiseValue(input));
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });

    it('deserialises binary raw JSON', (input) => {
      if (!(input instanceof Buffer)) {
        const serialised = Buffer.from(JSON.stringify(input));
        const deserialised = deserialiseValueBin(serialised);
        expect(deserialised).toEqual(input);
      }
    });
  },
  { parameters: TEST_VALUES },
);
