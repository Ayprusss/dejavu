import { describe, it, expect } from 'vitest';
import {
  addItem,
  cartItemCount,
  cartLineId,
  cartSubtotal,
  decrementItem,
  incrementItem,
  parsePrice,
  removeItem,
} from '../src/lib/cart';

const line = (overrides = {}) => ({
  id: 'v1',
  variantId: 'v1',
  name: 'Wool Coat',
  size: 'M',
  price: 1980,
  quantity: 1,
  image: 'coat.webp',
  ...overrides,
});

describe('parsePrice', () => {
  it.each([
    [1980, 1980],
    [0, 0],
    [19.99, 19.99],
  ])('passes the number %p straight through', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it.each([
    ['$1,980.00 USD', 1980],
    ['$850.00 USD', 850],
    ['$19.99', 19.99],
    ['1980', 1980],
  ])('parses the legacy label %s to %p', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it.each([undefined, null, {}, [], NaN, Infinity, 'free', ''])(
    'falls back to 0 for %p',
    (input) => {
      expect(parsePrice(input)).toBe(0);
    },
  );

  // Why the numeric price is now carried alongside the label: the string path
  // is only correct for en-US formatting. It is kept for legacy callers, but
  // nothing on the live path depends on it any more.
  it('mis-parses a European-formatted label, by design of the legacy regex', () => {
    expect(parsePrice('$1.980,00')).toBe(1.98);
  });
});

describe('cartItemCount', () => {
  it('is 0 for an empty cart', () => {
    expect(cartItemCount([])).toBe(0);
  });

  it('sums quantities, not lines', () => {
    expect(
      cartItemCount([line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 3 })]),
    ).toBe(5);
  });
});

describe('cartSubtotal', () => {
  it('is 0 for an empty cart', () => {
    expect(cartSubtotal([])).toBe(0);
  });

  it('multiplies price by quantity across lines', () => {
    expect(
      cartSubtotal([
        line({ id: 'a', price: 1980, quantity: 2 }),
        line({ id: 'b', price: 850, quantity: 1 }),
      ]),
    ).toBe(4810);
  });

  it('stays numeric when a line is priced at zero', () => {
    expect(cartSubtotal([line({ price: 0, quantity: 2 })])).toBe(0);
  });
});

describe('incrementItem', () => {
  it('increments only the matching line', () => {
    const items = [line({ id: 'a' }), line({ id: 'b' })];
    const next = incrementItem(items, 'a');
    expect(next.find((i) => i.id === 'a').quantity).toBe(2);
    expect(next.find((i) => i.id === 'b').quantity).toBe(1);
  });

  it('does not mutate the input', () => {
    const items = [line({ id: 'a' })];
    incrementItem(items, 'a');
    expect(items[0].quantity).toBe(1);
  });

  it('is a no-op for an unknown id', () => {
    const items = [line({ id: 'a' })];
    expect(incrementItem(items, 'nope')).toEqual(items);
  });
});

describe('decrementItem', () => {
  it('decrements a line above 1', () => {
    const next = decrementItem([line({ id: 'a', quantity: 3 })], 'a');
    expect(next[0].quantity).toBe(2);
  });

  it('drops the line when it would reach 0', () => {
    const next = decrementItem([line({ id: 'a', quantity: 1 })], 'a');
    expect(next).toHaveLength(0);
  });

  it('leaves other lines untouched when one is dropped', () => {
    const next = decrementItem(
      [line({ id: 'a', quantity: 1 }), line({ id: 'b', quantity: 2 })],
      'a',
    );
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('b');
    expect(next[0].quantity).toBe(2);
  });

  it('does not mutate the input', () => {
    const items = [line({ id: 'a', quantity: 2 })];
    decrementItem(items, 'a');
    expect(items[0].quantity).toBe(2);
  });
});

describe('removeItem', () => {
  it('removes the matching line', () => {
    const next = removeItem([line({ id: 'a' }), line({ id: 'b' })], 'a');
    expect(next.map((i) => i.id)).toEqual(['b']);
  });

  it('removes a line regardless of its quantity', () => {
    const next = removeItem([line({ id: 'a', quantity: 9 })], 'a');
    expect(next).toHaveLength(0);
  });

  it('is a no-op for an unknown id', () => {
    const items = [line({ id: 'a' })];
    expect(removeItem(items, 'nope')).toEqual(items);
  });
});

describe('cartLineId', () => {
  it('prefers the variantId', () => {
    expect(cartLineId({ variantId: 'v9', productId: 'p1', size: 'M' })).toBe('v9');
  });

  it('falls back to productId-size', () => {
    expect(cartLineId({ productId: 'p1', size: 'M' })).toBe('p1-M');
  });
});

describe('addItem', () => {
  const payload = {
    productId: 'p1',
    variantId: 'v1',
    stripePriceId: 'price_1',
    size: 'M',
    name: 'Wool Coat',
    price: 1980,
    priceLabel: '$1,980.00 USD',
    image: 'coat.webp',
  };

  it('adds a new line with quantity 1', () => {
    const next = addItem([], payload, 'fallback.webp');
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 'v1',
      variantId: 'v1',
      name: 'Wool Coat',
      size: 'M',
      price: 1980,
      quantity: 1,
      image: 'coat.webp',
    });
  });

  it('merges into an existing line for the same variant', () => {
    const once = addItem([], payload, 'fallback.webp');
    const twice = addItem(once, payload, 'fallback.webp');
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe(2);
  });

  it('keeps different sizes of the same product as separate lines', () => {
    const a = addItem([], { ...payload, variantId: 'v1', size: 'M' }, 'f.webp');
    const b = addItem(a, { ...payload, variantId: 'v2', size: 'L' }, 'f.webp');
    expect(b).toHaveLength(2);
  });

  it('uses the fallback image when the payload has none', () => {
    const next = addItem([], { ...payload, image: undefined }, 'fallback.webp');
    expect(next[0].image).toBe('fallback.webp');
  });

  it.each([
    ['a null payload', null],
    ['an undefined payload', undefined],
    ['a payload with no size', { productId: 'p1', name: 'x' }],
  ])('returns the cart unchanged for %s', (_name, bad) => {
    const items = [line()];
    expect(addItem(items, bad, 'f.webp')).toBe(items);
  });

  it('does not mutate the input', () => {
    const items = [];
    addItem(items, payload, 'f.webp');
    expect(items).toHaveLength(0);
  });

  describe('price handling', () => {
    it('stores the numeric price when one is supplied', () => {
      const next = addItem([], payload, 'f.webp');
      expect(next[0].price).toBe(1980);
    });

    it('falls back to parsing the label when no numeric price exists', () => {
      const legacy = { ...payload, price: undefined };
      const next = addItem([], legacy, 'f.webp');
      expect(next[0].price).toBe(1980);
    });

    it('prefers the numeric price over a disagreeing label', () => {
      const next = addItem(
        [],
        { ...payload, price: 1980, priceLabel: '$0.00 USD' },
        'f.webp',
      );
      expect(next[0].price).toBe(1980);
    });

    it('produces a subtotal that survives a comma-grouped price', () => {
      // The bug this replaced: a 4-figure price round-tripped through a
      // formatted string, correct only because the regex also stripped commas.
      const next = addItem([], payload, 'f.webp');
      expect(cartSubtotal(next)).toBe(1980);
      expect(cartSubtotal(incrementItem(next, 'v1'))).toBe(3960);
    });

    it('never stores NaN, whatever the payload carries', () => {
      const next = addItem(
        [],
        { ...payload, price: 'unknown', priceLabel: undefined },
        'f.webp',
      );
      expect(Number.isNaN(next[0].price)).toBe(false);
      expect(next[0].price).toBe(0);
    });
  });
});

describe('cart flows', () => {
  const payload = { variantId: 'v1', size: 'M', name: 'Coat', price: 100 };

  it('add then increment then decrement then remove returns to empty', () => {
    let items = addItem([], payload, 'f.webp');
    items = incrementItem(items, 'v1');
    expect(cartItemCount(items)).toBe(2);
    expect(cartSubtotal(items)).toBe(200);

    items = decrementItem(items, 'v1');
    expect(cartItemCount(items)).toBe(1);

    items = removeItem(items, 'v1');
    expect(items).toEqual([]);
    expect(cartSubtotal(items)).toBe(0);
  });

  it('decrementing the last unit empties the cart without a remove', () => {
    let items = addItem([], payload, 'f.webp');
    items = decrementItem(items, 'v1');
    expect(items).toEqual([]);
    expect(cartItemCount(items)).toBe(0);
  });
});
