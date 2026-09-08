-- Make overselling a database error rather than a silent clamp.
--
-- webhookController.js currently does `Math.max(stock - quantity, 0)`, which
-- turns an oversell into a quiet write of 0 and loses the fact that it
-- happened. Phase 3 replaces that with `UPDATE ... WHERE stock >= $n`; this
-- CHECK is the backstop underneath it.
--
-- `stock` is also made NOT NULL. A nullable column defeats the constraint —
-- `NULL >= 0` is NULL, which a CHECK accepts — and the code already treats
-- NULL as 0 (`variant.stock || 0`).

-- Up Migration

UPDATE "ProductVariant" SET "stock" = 0 WHERE "stock" IS NULL;

ALTER TABLE "ProductVariant" ALTER COLUMN "stock" SET NOT NULL;

ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_stock_check" CHECK ("stock" >= 0);

-- Down Migration

ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_stock_check";

ALTER TABLE "ProductVariant" ALTER COLUMN "stock" DROP NOT NULL;
