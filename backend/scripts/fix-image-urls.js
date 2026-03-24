/**
 * One-time script to fix product image URLs in the database.
 * Replaces `http://localhost:5173` with `https://dejavustudio.xyz`.
 *
 * Run from the backend root:
 *   node scripts/fix-image-urls.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const OLD_BASE = 'http://localhost:5173';
const NEW_BASE = 'https://dejavustudio.xyz';

async function fixImageUrls() {
  const { data: products, error } = await supabase.from('Product').select('id, images');

  if (error) {
    console.error('Failed to fetch products:', error);
    process.exit(1);
  }

  console.log(`Found ${products.length} products. Checking for localhost URLs...`);

  for (const product of products) {
    const images = product.images;
    if (!Array.isArray(images)) continue;

    const hasLocalhost = images.some((url) => url.startsWith(OLD_BASE));
    if (!hasLocalhost) {
      console.log(`  [SKIP] ${product.id} — no localhost URLs`);
      continue;
    }

    const fixedImages = images.map((url) =>
      url.startsWith(OLD_BASE) ? url.replace(OLD_BASE, NEW_BASE) : url
    );

    const { error: updateError } = await supabase
      .from('Product')
      .update({ images: fixedImages })
      .eq('id', product.id);

    if (updateError) {
      console.error(`  [ERROR] Failed to update ${product.id}:`, updateError);
    } else {
      console.log(`  [FIXED] ${product.id}`);
      console.log(`    Before: ${images[0]}`);
      console.log(`    After:  ${fixedImages[0]}`);
    }
  }

  console.log('\nDone!');
}

fixImageUrls();
