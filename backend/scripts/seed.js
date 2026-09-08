/**
 * Reset the local database to a known state.
 *
 *   docker compose up -d db && npm run migrate:up && npm run seed
 *
 * Destructive: it truncates every table before inserting. It reads DATABASE_URL
 * like the app does, so pointing it at anything other than a local database is
 * on you.
 *
 * The whole seed runs in one transaction — so a failure halfway leaves the
 * database as it was rather than half-seeded.
 */

const { randomUUID: uuidv4 } = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../src/db/pool');
const withTransaction = require('../src/db/withTransaction');
const userRepo = require('../src/repositories/userRepo');
const productRepo = require('../src/repositories/productRepo');
const orderRepo = require('../src/repositories/orderRepo');

const BASE_IMG_URL = 'http://localhost:5173/images/';

// Generate fixed UUIDs so foreign keys are easy to map in the seed script
const userId = uuidv4();
const adminId = uuidv4();
const prod1Id = uuidv4();
const prod2Id = uuidv4();

const var1sId = uuidv4();
const var1mId = uuidv4();
const var1lId = uuidv4();

const var2sId = uuidv4();
const var2mId = uuidv4();
const var2lId = uuidv4();

const order1Id = uuidv4();
const order2Id = uuidv4();

const seedProducts = [
  {
    id: prod1Id,
    stripeProductId: 'prod_stripe_isaac_1',
    name: 'Isaac Tech Chino Pants in Tan',
    description: JSON.stringify({
      heading: '100% Ventile Cotton',
      paragraphs: [
        'The Isaac Tech Chino Pants are crafted from 100% water-resistant ventile® cotton. They feature double front slash pockets and a seamless rear pocket with zip closures. Two darts on the knees create an articulated silhouette when worn, maintaining the structural integrity of the pants both on and off the body. Aquaguard fasteners prevent water from seeping in, ensuring the wearer remains dry in harsher weather conditions.',
        'The trousers are designed in a wide tailored cut, making them suitable for both formal and casual occasions',
      ],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    }),
    sizeGuide: JSON.stringify({
      columns: ['S', 'M', 'L'],
      measurements: {
        Waist: ['31.5/80', '33/84', '34.5/88'],
        Rise: ['13/34', '13.5/35', '14/36'],
        Inseam: ['29.5/76', '30,5/78', '31.5/80'],
        Thigh: ['12.5/32.5', '13/33.5', '13.5/34.5'],
      },
    }),
    price: 630.0,
    images: [
      `${BASE_IMG_URL}isaac-4.webp`,
      `${BASE_IMG_URL}isaac-1.jpg`,
      `${BASE_IMG_URL}isaac-2.jpg`,
      `${BASE_IMG_URL}isaac-3.jpg`,
    ],
  },
  {
    id: prod2Id,
    stripeProductId: 'prod_stripe_arlo_1',
    name: 'Arlo Windbreaker in Nylon',
    description: JSON.stringify({
      heading: '100% Polyamide',
      paragraphs: [
        'Technical jacket in lightweight, water-repellent nylon taffeta in darted construction with adjustable hem and cuffs, and hidden patch pocket with concealed zippers.',
        'The Arlo Windbreaker is designed in a wide tailored cut, making it suitable for both formal and casual occasions',
      ],
      modelNote: 'Color: Pearl Gray',
    }),
    sizeGuide: JSON.stringify({
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['19/48.5', '19.5/49.5', '20/51'],
        Sleeve: ['24/62', '25/64', '25.5/65'],
        Length: ['24.5/63', '25.5/65', '26.5/67'],
        Chest: ['49/125', '50/129', '52/133'],
      },
    }),
    price: 600.0,
    images: [
      `${BASE_IMG_URL}arlo_1.webp`,
      `${BASE_IMG_URL}arlo_2.webp`,
      `${BASE_IMG_URL}arlo_3.webp`,
    ],
  },
];

// Every size of a product shares that product's Stripe product id. The old seed
// wrote a distinct fake value per row ('price_isaac_s', ...) because
// ProductVariant had a UNIQUE on stripeProductId — which is exactly the bug
// migration 0002 removed. Sharing the id here is what actually exercises it.
const seedVariants = [
  {
    id: var1sId,
    productId: prod1Id,
    stripeProductId: 'prod_stripe_isaac_1',
    size: 'S',
    stock: 20,
  },
  {
    id: var1mId,
    productId: prod1Id,
    stripeProductId: 'prod_stripe_isaac_1',
    size: 'M',
    stock: 15,
  },
  {
    id: var1lId,
    productId: prod1Id,
    stripeProductId: 'prod_stripe_isaac_1',
    size: 'L',
    stock: 3,
  },
  {
    id: var2sId,
    productId: prod2Id,
    stripeProductId: 'prod_stripe_arlo_1',
    size: 'S',
    stock: 0,
  },
  {
    id: var2mId,
    productId: prod2Id,
    stripeProductId: 'prod_stripe_arlo_1',
    size: 'M',
    stock: 17,
  },
  {
    id: var2lId,
    productId: prod2Id,
    stripeProductId: 'prod_stripe_arlo_1',
    size: 'L',
    stock: 3,
  },
];

async function main() {
  console.log('Start seeding...');

  await withTransaction(pool, async (tx) => {
    // 1. Clear existing data. TRUNCATE ... CASCADE beats the old
    //    delete-where-id-is-not-an-impossible-uuid trick, and RESTART IDENTITY
    //    keeps it honest if a sequence is ever added.
    console.log('Clearing old data...');
    await tx.query(
      `TRUNCATE "OrderItem", "Order", "ProductVariant", "Product", "User", "StripeEvent"
       RESTART IDENTITY CASCADE`,
    );

    // 2. Users. Both share the password 'password123'.
    console.log('Seeding Users...');
    const dummyHash = await bcrypt.hash('password123', 10);

    for (const user of [
      {
        id: userId,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        isAdmin: false,
      },
      {
        id: adminId,
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        isAdmin: true,
      },
    ]) {
      // userRepo.insert lets the database generate the id; these rows need
      // fixed ids so the orders below can reference them.
      await tx.query(
        `INSERT INTO "User" ("id","email","passwordHash","firstName","lastName","isAdmin")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [user.id, user.email, dummyHash, user.firstName, user.lastName, user.isAdmin],
      );
    }

    // 3. Products
    console.log('Seeding Products...');
    for (const product of seedProducts) {
      await tx.query(
        `INSERT INTO "Product"
           ("id","stripeProductId","name","description","price","images","sizeGuide")
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          product.id,
          product.stripeProductId,
          product.name,
          product.description,
          product.price,
          product.images,
          product.sizeGuide,
        ],
      );
    }

    // 4. Variants
    console.log('Seeding Variants (with stock & stripeProductIds)...');
    for (const variant of seedVariants) {
      await tx.query(
        `INSERT INTO "ProductVariant"
           ("id","productId","stripeProductId","size","stock")
         VALUES ($1,$2,$3,$4,$5)`,
        [
          variant.id,
          variant.productId,
          variant.stripeProductId,
          variant.size,
          variant.stock,
        ],
      );
    }

    // 5. Orders. shippingAddress is passed as an object, not a JSON string —
    //    the column is jsonb and the driver serialises it.
    console.log('Seeding Orders...');
    await orderRepo.insert(tx, {
      id: order1Id,
      userId,
      customerEmail: 'test@example.com',
      stripeSessionId: 'cs_test_dummy123',
      totalAmount: 1230.0,
      status: 'PAID',
      shippingAddress: {
        city: 'New York',
        country: 'US',
        line1: '123 Main St',
        postal_code: '10001',
        state: 'NY',
      },
    });

    await orderRepo.insert(tx, {
      id: order2Id,
      userId: adminId,
      customerEmail: 'admin@example.com',
      stripeSessionId: 'cs_test_dummy456',
      totalAmount: 600.0,
      status: 'SHIPPED',
      shippingAddress: {
        city: 'Los Angeles',
        country: 'US',
        line1: '456 Oak St',
        postal_code: '90001',
        state: 'CA',
      },
    });

    // 6. Order items
    console.log('Seeding Order Items...');
    for (const item of [
      { orderId: order1Id, variantId: var1mId, quantity: 1, priceAtSale: 630.0 },
      { orderId: order1Id, variantId: var2mId, quantity: 1, priceAtSale: 600.0 },
      { orderId: order2Id, variantId: var2mId, quantity: 1, priceAtSale: 600.0 },
    ]) {
      await orderRepo.insertItem(tx, item);
    }

    // Referenced so the fixed ids above are not flagged as unused, and so the
    // seed fails loudly if a repository lookup regresses.
    const seededUser = await userRepo.findByEmail(tx, 'TEST@EXAMPLE.COM');
    if (!seededUser) throw new Error('Case-insensitive user lookup failed');

    const seededProducts = await productRepo.findAllWithVariants(tx);
    console.log(
      `Seeded ${seededProducts.length} products, ` +
        `${seededProducts.reduce((n, p) => n + p.ProductVariant.length, 0)} variants`,
    );
  });

  console.log('Seeding finished.');
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
