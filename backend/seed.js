require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase. Requires SUPABASE_URL and SUPABASE_KEY in .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_IMG_URL = 'http://localhost:5173/images/';

const seedProducts = [
    {
        shopifyId: 'shopify-isaac-1',
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
        variants: [
            { shopifyVariantId: 'var-luca-s', size: 'S', stock: 20 },
            { shopifyVariantId: 'var-luca-m', size: 'M', stock: 15 },
            { shopifyVariantId: 'var-luca-l', size: 'L', stock: 3 },
        ],
    },
    {
        shopifyId: 'shopify-arlo-1',
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
        variants: [
            { shopifyVariantId: 'var-luca-s', size: 'S', stock: 0 },
            { shopifyVariantId: 'var-luca-m', size: 'M', stock: 17 },
            { shopifyVariantId: 'var-luca-l', size: 'L', stock: 3 },
        ],
    }
];

async function main() {
    console.log('Start seeding...');

    for (const p of seedProducts) {
        // 1. Upsert Product
        const { data: existingProduct, error: fetchError } = await supabase
            .from('Product')
            .select('id')
            .eq('shopifyId', p.shopifyId)
            .single();

        let productId;

        if (existingProduct) {
            productId = existingProduct.id;
            // Update existing
            await supabase.from('Product').update({
                name: p.name,
                description: p.description,
                sizeGuide: p.sizeGuide,
                price: p.price,
                images: p.images
            }).eq('id', productId);
            console.log(`Updated product with shopifyId: ${p.shopifyId}`);
        } else {
            // Create new
            const { data: newProduct, error: createError } = await supabase.from('Product').insert({
                id: uuidv4(),
                shopifyId: p.shopifyId,
                name: p.name,
                description: p.description,
                sizeGuide: p.sizeGuide,
                price: p.price,
                images: p.images,
                updatedAt: new Date().toISOString()
            }).select().single();

            if (createError) throw createError;
            productId = newProduct.id;
            console.log(`Created product with shopifyId: ${p.shopifyId}`);
        }

        // 2. Upsert Variants
        for (const v of p.variants) {
            const { data: existingVariant } = await supabase
                .from('ProductVariant')
                .select('id')
                .eq('shopifyVariantId', v.shopifyVariantId)
                .single();

            if (existingVariant) {
                await supabase.from('ProductVariant').update({
                    size: v.size,
                    stock: v.stock
                }).eq('id', existingVariant.id);
            } else {
                await supabase.from('ProductVariant').insert({
                    id: uuidv4(),
                    productId: productId,
                    shopifyVariantId: v.shopifyVariantId,
                    size: v.size,
                    stock: v.stock,
                    updatedAt: new Date().toISOString()
                });
            }
        }
    }

    console.log('Seeding finished.');
}

main().catch(console.error);
