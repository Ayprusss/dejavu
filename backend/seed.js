require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { randomUUID: uuidv4 } = require('crypto');

// Initialize Supabase. Requires SUPABASE_URL and SUPABASE_KEY in .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
        images: [`${BASE_IMG_URL}isaac-4.jpg`, `${BASE_IMG_URL}isaac-1.jpg`, `${BASE_IMG_URL}isaac-2.jpg`, `${BASE_IMG_URL}isaac-3.jpg`],
        updatedAt: new Date().toISOString()
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
        images: [`${BASE_IMG_URL}arlo_1.webp`, `${BASE_IMG_URL}arlo_2.webp`, `${BASE_IMG_URL}arlo_3.webp`],
        updatedAt: new Date().toISOString()
    }
];

const seedVariants = [
    { id: var1sId, productId: prod1Id, stripeProductId: 'price_isaac_s', size: 'S', stock: 20, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: var1mId, productId: prod1Id, stripeProductId: 'price_isaac_m', size: 'M', stock: 15, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: var1lId, productId: prod1Id, stripeProductId: 'price_isaac_l', size: 'L', stock: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: var2sId, productId: prod2Id, stripeProductId: 'price_arlo_s', size: 'S', stock: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: var2mId, productId: prod2Id, stripeProductId: 'price_arlo_m', size: 'M', stock: 17, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: var2lId, productId: prod2Id, stripeProductId: 'price_arlo_l', size: 'L', stock: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];
async function main() {
    console.log('Start seeding...');

    // 1. Delete existing data (Cascade deletes handle most, but we go bottom-up to be safe)
    console.log('Clearing old data (this relies on the updated table schemas)...');
    
    // We use a dummy UUID that will never match to delete all rows.
    const impossibleId = uuidv4();
    await supabase.from('OrderItem').delete().neq('id', impossibleId);
    await supabase.from('Order').delete().neq('id', impossibleId);
    await supabase.from('ProductVariant').delete().neq('id', impossibleId);
    await supabase.from('Product').delete().neq('id', impossibleId);
    await supabase.from('User').delete().neq('id', impossibleId);

    // 2. Seed User
    console.log('Seeding Users...');
    // A standard bcrypt hash representing the password 'password123'
    const dummyHash = "$2a$10$A.rO12S2Bv4vHl0O7n6V..F0157XW7P3t1P0g4T2159i/41Q74V3O"; 
    const { error: userError } = await supabase.from('User').insert([
        {
            id: userId,
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
            passwordHash: dummyHash,
            isAdmin: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        {
            id: adminId,
            email: 'admin@example.com',
            firstName: 'Admin',
            lastName: 'User',
            passwordHash: dummyHash,
            isAdmin: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ]);
    if (userError) console.error("User Error:", userError);

    // 3. Seed Products
    console.log('Seeding Products...');
    for (const p of seedProducts) {
        const { error: productError } = await supabase.from('Product').insert([p]);
        if (productError) console.error("Product Error:", productError);
    }

    // 4. Seed Variants
    console.log('Seeding Variants (with stock & stripeProductIds)...');
    for (const v of seedVariants) {
        const { error: variantError } = await supabase.from('ProductVariant').insert([v]);
        if (variantError) console.error("Variant Error:", variantError);
    }

    // 5. Seed Order
    console.log('Seeding Order...');
    const { error: orderError } = await supabase.from('Order').insert([{
        id: order1Id,
        userId: userId,
        customerEmail: 'test@example.com',
        stripeSessionId: 'cs_test_dummy123',
        totalAmount: 1230.00,
        status: 'PAID',
        shippingAddress: JSON.stringify({
            city: "New York", country: "US", line1: "123 Main St", postal_code: "10001", state: "NY"
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }]);
    if (orderError) console.error("Order Error:", orderError);

    // 6. Seed Order Items
    console.log('Seeding Order Items...');
    const { error: itemError } = await supabase.from('OrderItem').insert([
        { id: uuidv4(), orderId: order1Id, variantId: var1mId, quantity: 1, priceAtSale: 630.0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, // 1 Isaac Pant (M)
        { id: uuidv4(), orderId: order1Id, variantId: var2mId, quantity: 1, priceAtSale: 600.0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }  // 1 Arlo Windbreaker (M)
    ]);
    if (itemError) console.error("Item Error:", itemError);

    console.log('Seeding finished successfully!');
}

main().catch(console.error);
