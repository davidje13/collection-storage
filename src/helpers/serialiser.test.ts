import { serialiseValue, deserialiseValue, serialiseValueBin, deserialiseValueBin } from './serialiser';

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

describe('string serialisers', () => {
  it('deserialises to the same value', () => {
    TEST_VALUES.forEach((input) => {
      const serialised = serialiseValue(input);
      const deserialised = deserialiseValue(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });
  });

  it('deserialises raw JSON', () => {
    TEST_VALUES.forEach((input) => {
      if (!(input instanceof Buffer)) {
        const serialised = JSON.stringify(input);
        const deserialised = deserialiseValue(serialised);
        expect(deserialised).toEqual(input);
      }
    });
  });
});

describe('binary serialisers', () => {
  it('deserialises to the same value', () => {
    TEST_VALUES.forEach((input) => {
      const serialised = serialiseValueBin(input);
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });
  });

  it('deserialises string-serialised values', () => {
    TEST_VALUES.forEach((input) => {
      const serialised = serialiseValue(input);
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });
  });

  it('deserialises binary-coded string-serialised values', () => {
    TEST_VALUES.forEach((input) => {
      const serialised = Buffer.from(serialiseValue(input));
      const deserialised = deserialiseValueBin(serialised);

      if (input instanceof Buffer) {
        expect(deserialised instanceof Buffer).toBeTruthy();
        expect(input.equals(deserialised as Buffer)).toBeTruthy();
      } else {
        expect(deserialised).toEqual(input);
      }
    });
  });

  it('deserialises binary-coded raw JSON', () => {
    TEST_VALUES.forEach((input) => {
      if (!(input instanceof Buffer)) {
        const serialised = Buffer.from(JSON.stringify(input));
        const deserialised = deserialiseValueBin(serialised);
        expect(deserialised).toEqual(input);
      }
    });
  });
});
