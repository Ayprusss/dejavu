import { describe, it, expect } from 'vitest';
import {
  addressLines,
  cardBrandLabel,
  formatMoney,
  lineTotal,
  maskCardNumber,
  orderBreakdown,
  orderItemCount,
  orderStatus,
  parseShippingAddress,
} from '../src/lib/orders';

const item = (overrides = {}) => ({
  id: 'i1',
  quantity: 1,
  priceAtSale: 630,
  ...overrides,
});

describe('orderStatus', () => {
  it.each([
    ['PAID', 'purchased', 'Purchased'],
    ['PENDING', 'purchased', 'Purchased'],
    ['SHIPPED', 'shipped', 'Shipped'],
    ['FULFILLED', 'delivered', 'Delivered'],
    ['DELIVERED', 'delivered', 'Delivered'],
    ['CANCELLED', 'refunded', 'Refunded'],
    ['REFUNDED', 'refunded', 'Refunded'],
    ['shipped', 'shipped', 'Shipped'],
  ])('maps %s to %s', (status, key, label) => {
    expect(orderStatus(status)).toEqual({ key, label });
  });

  it.each([undefined, null, '', 'SOMETHING_NEW'])('reads %p as purchased', (status) => {
    expect(orderStatus(status).key).toBe('purchased');
  });
});

describe('maskCardNumber', () => {
  it('replaces every digit but the last four with bullets', () => {
    expect(maskCardNumber('4242')).toBe('•••• •••• •••• 4242');
  });

  it('never lets more than four digits through', () => {
    expect(maskCardNumber('4242424242424242')).toBe('•••• •••• •••• 4242');
    expect(maskCardNumber('4242 4242 4242 1881')).toBe('•••• •••• •••• 1881');
  });

  it.each([undefined, null, '', '42', 'abcd'])('returns null for %p', (value) => {
    expect(maskCardNumber(value)).toBeNull();
  });
});

describe('orderBreakdown', () => {
  it('sums the subtotal from unit prices and quantities', () => {
    const order = {
      totalAmount: 1890,
      OrderItem: [item({ quantity: 2 }), item({ id: 'i2' })],
    };
    expect(orderBreakdown(order)).toEqual({
      subtotal: 1890,
      shipping: 0,
      tax: 0,
      total: 1890,
    });
  });

  it('leaves shipping and tax unknown when the items do not add up to the total', () => {
    const order = { totalAmount: 660, OrderItem: [item()] };
    expect(orderBreakdown(order)).toEqual({
      subtotal: 630,
      shipping: null,
      tax: null,
      total: 660,
    });
  });

  it('prefers amounts the API sends', () => {
    const order = {
      totalAmount: 695.5,
      subtotalAmount: 630,
      shippingAmount: 15,
      taxAmount: 50.5,
      OrderItem: [item()],
    };
    expect(orderBreakdown(order)).toEqual({
      subtotal: 630,
      shipping: 15,
      tax: 50.5,
      total: 695.5,
    });
  });

  it('does not accumulate floating point error across lines', () => {
    const order = {
      totalAmount: 0.3,
      OrderItem: [item({ priceAtSale: 0.1 }), item({ id: 'i2', priceAtSale: 0.2 })],
    };
    expect(orderBreakdown(order).subtotal).toBe(0.3);
    expect(orderBreakdown(order).shipping).toBe(0);
  });

  it('has no subtotal for the public order shape, which carries no items', () => {
    expect(orderBreakdown({ totalAmount: 1260, itemCount: 2 })).toEqual({
      subtotal: null,
      shipping: null,
      tax: null,
      total: 1260,
    });
  });
});

describe('lineTotal / orderItemCount', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotal(item({ quantity: 3, priceAtSale: 19.99 }))).toBe(59.97);
  });

  it('counts quantities, falling back to itemCount', () => {
    expect(orderItemCount({ OrderItem: [item({ quantity: 2 }), item()] })).toBe(3);
    expect(orderItemCount({ itemCount: 4 })).toBe(4);
    expect(orderItemCount({})).toBe(0);
  });
});

describe('shipping address', () => {
  const address = {
    line1: '1 Main St',
    line2: null,
    city: 'Boston',
    state: 'MA',
    postal_code: '02110',
    country: 'US',
  };

  it('accepts an object or a double-encoded JSON string', () => {
    expect(parseShippingAddress(address)).toBe(address);
    expect(parseShippingAddress(JSON.stringify(address))).toEqual(address);
  });

  it.each([null, undefined, '', 'not json', '"a string"'])(
    'returns null for %p',
    (value) => {
      expect(parseShippingAddress(value)).toBeNull();
    },
  );

  it('formats display lines, dropping empty parts', () => {
    expect(addressLines(address)).toEqual(['1 Main St', 'Boston, MA 02110', 'US']);
    expect(addressLines({ line1: '1 Main St', country: 'US' })).toEqual([
      '1 Main St',
      'US',
    ]);
    expect(addressLines(null)).toEqual([]);
  });
});

describe('formatMoney / cardBrandLabel', () => {
  it('formats amounts and rejects non-amounts', () => {
    expect(formatMoney(1260)).toBe('$1,260.00 USD');
    expect(formatMoney(0)).toBe('$0.00 USD');
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney('abc')).toBeNull();
  });

  it('labels card brands', () => {
    expect(cardBrandLabel('visa')).toBe('Visa');
    expect(cardBrandLabel('amex')).toBe('American Express');
    expect(cardBrandLabel(undefined)).toBe('Card');
  });
});
