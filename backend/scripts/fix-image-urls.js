/**
 * One-time script to fix product image URLs in the database.
 * Replaces `http://localhost:5173` with `https://dejavustudio.xyz`.
 *
 * Run from the backend root:
 *   node --require dotenv/config scripts/fix-image-urls.js
 */

const pool = require('../src/db/pool');

const OLD_BASE = 'http://localhost:5173';
const NEW_BASE = 'https://dejavustudio.xyz';

async function fixImageUrls() {
  const { rows: products } = await pool.query(
    `SELECT "id", "images" FROM "Product" ORDER BY "createdAt"`,
  );

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
      url.startsWith(OLD_BASE) ? url.replace(OLD_BASE, NEW_BASE) : url,
    );

    try {
      await pool.query(`UPDATE "Product" SET "images" = $2 WHERE "id" = $1`, [
        product.id,
        fixedImages,
      ]);

      console.log(`  [FIXED] ${product.id}`);
      console.log(`    Before: ${images[0]}`);
      console.log(`    After:  ${fixedImages[0]}`);
    } catch (error) {
      console.error(`  [ERROR] Failed to update ${product.id}:`, error.message);
    }
  }

  console.log('\nDone!');
}

fixImageUrls()
  .catch((error) => {
    console.error('Failed to fetch products:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
