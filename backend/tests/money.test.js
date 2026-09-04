const { toCents, isChargeable } = require('../src/lib/money');

describe('toCents', () => {
  const cases = [
    { input: 19.99, expected: 1999 },
    { input: 0.1, expected: 10 },
    { input: 0.29, expected: 29 },
    { input: 1980.0, expected: 198000 },
    { input: 850, expected: 85000 },
    { input: 0, expected: 0 },
    { input: '19.99', expected: 1999 },
    { input: '1980.00', expected: 198000 },
  ];

  it.each(cases)('converts $input to $expected cents', ({ input, expected }) => {
    expect(toCents(input)).toBe(expected);
  });

  it('never produces a fractional cent', () => {
    for (let dollars = 0; dollars < 2000; dollars += 0.01) {
      expect(Number.isInteger(toCents(dollars))).toBe(true);
    }
  });

  // A half-cent input does NOT round up: 1.005 * 100 is 100.49999999999999 in
  // IEEE-754, so Math.round yields 100. Prices are whole cents in practice, so
  // this is recorded rather than fixed — a real fix means never letting a
  // sub-cent price into the database.
  it('rounds a half-cent down, because the float is already below the midpoint', () => {
    expect(1.005 * 100).toBe(100.49999999999999);
    expect(toCents(1.005)).toBe(100);
  });

  it('rounds rather than truncating', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE-754; truncation undercharges.
    expect(19.99 * 100).not.toBe(1999);
    expect(toCents(19.99)).toBe(1999);
  });

  it('returns NaN for a non-numeric price', () => {
    expect(toCents(undefined)).toBeNaN();
    expect(toCents(null)).toBe(0); // Number(null) === 0 — caught by isChargeable
    expect(toCents('free')).toBeNaN();
  });
});

describe('isChargeable', () => {
  const rejected = [NaN, 0, -1, -0.5, Infinity, -Infinity, 1.5, undefined, null];

  it.each(rejected)('rejects %s', (value) => {
    expect(isChargeable(value)).toBe(false);
  });

  it.each([1, 1999, 198000])('accepts %i', (value) => {
    expect(isChargeable(value)).toBe(true);
  });

  it('rejects a price that rounds to zero', () => {
    expect(isChargeable(toCents(0.001))).toBe(false);
  });

  it('rejects a missing product price', () => {
    expect(isChargeable(toCents(undefined))).toBe(false);
    expect(isChargeable(toCents(null))).toBe(false);
  });
});
