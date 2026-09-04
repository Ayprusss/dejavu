const {
  parseCartItems,
  EMPTY_CART_MESSAGE,
  INVALID_ITEM_MESSAGE,
} = require('../src/lib/cart');

describe('parseCartItems — shape', () => {
  const rejectedBodies = [
    { name: 'undefined', value: undefined },
    { name: 'null', value: null },
    { name: 'an empty array', value: [] },
    { name: 'an object rather than an array', value: { variantId: 'v1' } },
    { name: 'a string', value: 'v1' },
    { name: 'a number', value: 3 },
  ];

  it.each(rejectedBodies)('rejects $name as an empty cart', ({ value }) => {
    const result = parseCartItems(value);
    expect(result.ok).toBe(false);
    expect(result.message).toBe(EMPTY_CART_MESSAGE);
  });
});

describe('parseCartItems — item validation', () => {
  const rejectedItems = [
    { name: 'a missing variantId', item: { quantity: 1 } },
    { name: 'an empty-string variantId', item: { variantId: '', quantity: 1 } },
    { name: 'a null variantId', item: { variantId: null, quantity: 1 } },
    { name: 'a null item', item: null },
    { name: 'quantity 0', item: { variantId: 'v1', quantity: 0 } },
    { name: 'quantity -1', item: { variantId: 'v1', quantity: -1 } },
    { name: 'quantity 1.5', item: { variantId: 'v1', quantity: 1.5 } },
    { name: 'a missing quantity', item: { variantId: 'v1' } },
    { name: 'a non-numeric quantity', item: { variantId: 'v1', quantity: 'abc' } },
    { name: 'NaN quantity', item: { variantId: 'v1', quantity: NaN } },
    { name: 'Infinity quantity', item: { variantId: 'v1', quantity: Infinity } },
  ];

  it.each(rejectedItems)('rejects $name', ({ item }) => {
    const result = parseCartItems([item]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe(INVALID_ITEM_MESSAGE);
  });

  it('rejects the whole cart when only one line is invalid', () => {
    const result = parseCartItems([
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', quantity: 0 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('accepts a numeric string quantity, coercing it', () => {
    // `Number("3")` is 3, so "3" is accepted. Recorded as current behaviour.
    const result = parseCartItems([{ variantId: 'v1', quantity: '3' }]);
    expect(result.ok).toBe(true);
    expect(result.items[0].quantity).toBe(3);
  });

  it('accepts a valid cart and preserves order', () => {
    const result = parseCartItems([
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', quantity: 1 },
    ]);
  });
});

describe('parseCartItems — server-side price integrity', () => {
  it('drops a client-supplied price', () => {
    const result = parseCartItems([{ variantId: 'v1', quantity: 1, price: 0.01 }]);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toEqual({ variantId: 'v1', quantity: 1 });
    expect(result.items[0]).not.toHaveProperty('price');
  });

  it('drops every other unexpected field', () => {
    const result = parseCartItems([
      {
        variantId: 'v1',
        quantity: 1,
        unit_amount: 1,
        currency: 'xyz',
        stock: 9999,
        isAdmin: true,
      },
    ]);
    expect(Object.keys(result.items[0]).sort()).toEqual(['quantity', 'variantId']);
  });
});

describe('parseCartItems — duplicate lines', () => {
  // Phase 3 aggregates duplicate lines by variantId before stock validation.
  // Until then two lines for the same variant are each validated in isolation,
  // so a cart can pass validation and still oversell.
  it.todo('aggregates duplicate variantIds into a single line');

  it('currently passes duplicate lines through unmerged', () => {
    const result = parseCartItems([
      { variantId: 'v1', quantity: 3 },
      { variantId: 'v1', quantity: 3 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});
