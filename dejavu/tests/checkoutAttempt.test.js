import { describe, it, expect } from 'vitest';
import { cartAttemptSignature, getCheckoutAttempt } from '../src/lib/checkoutAttempt';

const items = (overrides = []) => [
  { variantId: 'v1', quantity: 1 },
  { variantId: 'v2', quantity: 2 },
  ...overrides,
];

// Deterministic, incrementing stand-in for crypto.randomUUID in tests.
const sequentialKeyGenerator = () => {
  let n = 0;
  return () => `key-${(n += 1)}`;
};

describe('cartAttemptSignature', () => {
  it('is order-independent', () => {
    const a = [
      { variantId: 'v1', quantity: 1 },
      { variantId: 'v2', quantity: 2 },
    ];
    const b = [
      { variantId: 'v2', quantity: 2 },
      { variantId: 'v1', quantity: 1 },
    ];
    expect(cartAttemptSignature(a)).toBe(cartAttemptSignature(b));
  });

  it('differs when a quantity changes', () => {
    expect(cartAttemptSignature(items())).not.toBe(
      cartAttemptSignature(
        items().map((i) => (i.variantId === 'v1' ? { ...i, quantity: 2 } : i)),
      ),
    );
  });
});

describe('getCheckoutAttempt', () => {
  it('generates a key on the first attempt', () => {
    const generateKey = sequentialKeyGenerator();
    const attempt = getCheckoutAttempt(null, items(), generateKey);
    expect(attempt.key).toBe('key-1');
    expect(attempt.signature).toBe(cartAttemptSignature(items()));
  });

  it('reuses the same key on a retry of the same cart (double-click, or a retry after a network error)', () => {
    const generateKey = sequentialKeyGenerator();
    const first = getCheckoutAttempt(null, items(), generateKey);
    const retry = getCheckoutAttempt(first, items(), generateKey);

    expect(retry.key).toBe(first.key);
  });

  it('does not call generateKey again for a retry', () => {
    let calls = 0;
    const generateKey = () => {
      calls += 1;
      return `key-${calls}`;
    };

    const first = getCheckoutAttempt(null, items(), generateKey);
    getCheckoutAttempt(first, items(), generateKey);

    expect(calls).toBe(1);
  });

  it('issues a new key once the cart contents change', () => {
    const generateKey = sequentialKeyGenerator();
    const first = getCheckoutAttempt(null, items(), generateKey);
    const changedCart = items().map((i) =>
      i.variantId === 'v1' ? { ...i, quantity: 5 } : i,
    );
    const second = getCheckoutAttempt(first, changedCart, generateKey);

    expect(second.key).not.toBe(first.key);
    expect(second.signature).toBe(cartAttemptSignature(changedCart));
  });

  it('issues a new key when the previous attempt was cleared (e.g. after a completed checkout)', () => {
    const generateKey = sequentialKeyGenerator();
    const first = getCheckoutAttempt(null, items(), generateKey);
    const afterRedirect = getCheckoutAttempt(null, items(), generateKey);

    expect(afterRedirect.key).not.toBe(first.key);
  });
});
