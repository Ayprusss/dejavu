-- `User_email_key` is a plain UNIQUE on a text column, so 'A@x.com' and
-- 'a@x.com' are two separate accounts. Worse, authController looks users up
-- with `.eq('email', email)` — so whether you can log in depends on how you
-- capitalised your address, and the guest-order linking in register() misses
-- orders placed under a different casing.
--
-- A unique index on lower(email) is used rather than citext: no extension to
-- install (it matters on RDS in Phase 6), no column type change, and the
-- constraint is visible in the index definition rather than hidden in a type.
-- The lookups are normalised to match in the controller rewrite.

-- Up Migration

ALTER TABLE "User" DROP CONSTRAINT "User_email_key";

CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));

-- Down Migration

DROP INDEX "User_email_lower_key";

-- Fails if two accounts differ only by case, which this migration was added to
-- prevent going forward but cannot retroactively merge.
ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email");
