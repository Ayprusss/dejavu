-- `ProductVariant_stripeProductId_key` is wrong.
--
-- Every size variant of one product shares that product's Stripe product ID,
-- so a UNIQUE on it allows exactly one variant per product — seeding any
-- product with more than one size fails. The real uniqueness rule is one row
-- per (product, size).
--
-- scripts/seed.js currently hides this by writing a fake per-variant value
-- ('price_isaac_s', 'price_isaac_m', ...) into `stripeProductId`. The seed is
-- corrected alongside the controller rewrite so this constraint is actually
-- exercised.

-- Up Migration

ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_stripeProductId_key";

ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_productId_size_key" UNIQUE ("productId", "size");

-- Down Migration

ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_productId_size_key";

-- Note: this direction fails if two variants share a stripeProductId, which is
-- the normal state once the constraint above has been relied on. That is
-- correct — rolling back past 0002 means going back to a schema the data no
-- longer fits.
ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_stripeProductId_key" UNIQUE ("stripeProductId");
