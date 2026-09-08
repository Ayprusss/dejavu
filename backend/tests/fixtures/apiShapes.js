/**
 * The JSON shapes the API returns, written down.
 *
 * These were produced by PostgREST's embedded selects and are consumed directly
 * by the frontend — `Account.jsx` reads `order.OrderItem[].ProductVariant.Product`,
 * `Shop.jsx` reads `product.ProductVariant[]`, `AdminDashboard.jsx` reads
 * `order.User?.email`. The Phase 2 rewrite reproduces them in SQL, so the key
 * names and nesting are a contract, not an implementation detail.
 *
 * Recorded here from a live run of the repositories against Postgres 16 so the
 * Phase 2b rewrite and the Phase 4 integration tests have something concrete to
 * assert against rather than a description in a commit message.
 *
 * Values are illustrative; the shape is the point.
 */

/** GET /api/products, GET /api/products/:id — productRepo.find*WithVariants */
const PRODUCT_WITH_VARIANTS = {
  id: '08b93ce2-f398-4f90-9fe8-7ba699eef770',
  stripeProductId: 'prod_abc',
  name: 'Isaac Tech Chino Pants in Tan',
  description: '{"heading":"100% Ventile Cotton"}', // JSON-in-text, as stored
  price: 630, // number, not "630.00" — see db/pool.js
  images: ['a.webp', 'b.webp'], // text[] -> JS array
  status: 'ACTIVE',
  sizeGuide: '{"columns":["S","M","L"]}',
  createdAt: '2026-09-08T17:09:03.340Z',
  updatedAt: '2026-09-08T17:09:03.340Z',
  // Array, and `[]` rather than null when the product has no variants.
  ProductVariant: [
    {
      id: '9aded124-fc74-43bc-a402-4df55a0d363b',
      stripeProductId: 'prod_abc', // shared across sizes — see migration 0002
      productId: '08b93ce2-f398-4f90-9fe8-7ba699eef770',
      size: 'M',
      stock: 15,
      createdAt: '2026-09-08T17:09:03.340191+00:00',
      updatedAt: '2026-09-08T17:09:03.340191+00:00',
    },
  ],
};

/** POST /api/checkout — variantRepo.findManyByIdsWithProduct */
const VARIANT_WITH_PRODUCT = {
  id: '13a6d2cb-82f3-4525-a8ef-49dc3a95f736',
  size: 'S',
  stock: 20,
  Product: { name: 'Isaac Tech Chino Pants in Tan', price: 630 }, // object, not array
};

/** GET /api/admin/orders — orderRepo.findAllWithUserAndItems */
const ADMIN_ORDER = {
  id: '1023b048-bdd6-4762-9785-5a089fc7475f',
  userId: '09fc739a-9f1c-421d-b181-fda8ebab40cf',
  customerEmail: 'Test@Example.com',
  totalAmount: 1260,
  status: 'PAID',
  stripeSessionId: 'cs_test_123',
  shippingAddress: { line1: '1 Main St', city: 'Boston', country: 'US' }, // object
  createdAt: '2026-09-08T17:09:14.282Z',
  updatedAt: '2026-09-08T17:09:14.282Z',
  // Object for a registered customer, null for a guest — never {}.
  User: { email: 'Test@Example.com', firstName: 'Ada', lastName: 'Lovelace' },
  OrderItem: [
    {
      id: '08a65bc6-1e4b-4587-8b38-6d5461cf77c6',
      orderId: 'b633f0d9-e5e2-47f1-971d-9f358cc6cb50',
      variantId: '6879a4e2-6e44-40e8-b550-5674cc6397f1',
      quantity: 2,
      priceAtSale: 630,
      createdAt: '2026-09-08T17:09:14.282534+00:00',
      updatedAt: '2026-09-08T17:09:14.282534+00:00',
      ProductVariant: { size: 'S', Product: { name: 'Isaac Tech Chino Pants in Tan' } },
    },
  ],
};

/** A guest order in the same list: no user, no items. */
const ADMIN_ORDER_GUEST = {
  id: '418cb005-d493-4f62-8d43-5bfdb8295776',
  userId: null,
  customerEmail: 'guest@example.com',
  totalAmount: 630,
  status: 'PAID',
  stripeSessionId: 'cs_test_guest',
  shippingAddress: null,
  createdAt: '2026-09-08T17:09:14.282Z',
  updatedAt: '2026-09-08T17:09:14.282Z',
  User: null,
  OrderItem: [],
};

/** GET /api/user/orders — orderRepo.findByUserIdWithItems */
const ACCOUNT_ORDER = {
  id: 'b633f0d9-e5e2-47f1-971d-9f358cc6cb50',
  userId: 'e8c180a0-b199-4451-96b1-971f648e33ab',
  customerEmail: 'Test@Example.com',
  totalAmount: 1260,
  status: 'PAID',
  stripeSessionId: 'cs_test_123',
  shippingAddress: { line1: '1 Main St', city: 'Boston', country: 'US' },
  createdAt: '2026-09-08T17:09:14.282Z',
  updatedAt: '2026-09-08T17:09:14.282Z',
  OrderItem: [
    {
      id: '08a65bc6-1e4b-4587-8b38-6d5461cf77c6',
      quantity: 2,
      priceAtSale: 630,
      ProductVariant: {
        id: '6879a4e2-6e44-40e8-b550-5674cc6397f1',
        size: 'S',
        Product: {
          id: 'c9af063c-3a94-4dcd-9321-963a6ab14a65',
          name: 'Isaac Tech Chino Pants in Tan',
          images: ['a.webp', 'b.webp'],
        },
      },
    },
  ],
};

/** GET /api/checkout/session/:sessionId — orderRepo.findByStripeSessionIdWithItems */
const CHECKOUT_ORDER = {
  id: 'b633f0d9-e5e2-47f1-971d-9f358cc6cb50',
  stripeSessionId: 'cs_test_123',
  customerEmail: 'Test@Example.com',
  totalAmount: 1260,
  status: 'PAID',
  shippingAddress: { line1: '1 Main St', city: 'Boston', country: 'US' },
  createdAt: '2026-09-08T17:09:14.282Z',
  // Deliberately narrower than ACCOUNT_ORDER: no `userId`, no `updatedAt`.
  OrderItem: [
    {
      id: '08a65bc6-1e4b-4587-8b38-6d5461cf77c6',
      quantity: 2,
      priceAtSale: 630,
      ProductVariant: {
        size: 'S',
        Product: {
          name: 'Isaac Tech Chino Pants in Tan',
          images: ['a.webp', 'b.webp'],
        },
      },
    },
  ],
};

module.exports = {
  PRODUCT_WITH_VARIANTS,
  VARIANT_WITH_PRODUCT,
  ADMIN_ORDER,
  ADMIN_ORDER_GUEST,
  ACCOUNT_ORDER,
  CHECKOUT_ORDER,
};
