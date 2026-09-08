-- Baseline schema, ported from init-scripts/init.sql (a Supabase pg_dump).
--
-- Deliberately dropped from the original dump:
--   * `_prisma_migrations` — residue from an ORM that was removed once already.
--   * `ENABLE ROW LEVEL SECURITY` on every table — RLS was on with *zero*
--     policies, so the app only worked because the service-role key bypasses
--     it. On plain Postgres that is not a security model, it is a lockout.
--     Access control lives in the app layer (authMiddleware) and always did.
--   * `GRANT ALL ... TO anon/authenticated/service_role` — those roles are a
--     Supabase construct and do not exist here.
--   * `OWNER TO` / `ALTER DEFAULT PRIVILEGES` — ownership is whoever runs the
--     migration.
--
-- Identifiers stay double-quoted camelCase to match the existing code.
-- `gen_random_uuid()` is core Postgres from 13 on, so pgcrypto is not needed.

-- Up Migration

CREATE TABLE "User" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL,
    "passwordHash" text NOT NULL,
    "firstName" text,
    "lastName" text,
    "isAdmin" boolean DEFAULT false,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "User_email_key" UNIQUE ("email")
);

CREATE TABLE "Product" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "stripeProductId" text NOT NULL,
    "name" text NOT NULL,
    "description" text NOT NULL,
    "price" numeric NOT NULL,
    "images" text[] NOT NULL,
    "status" text DEFAULT 'ACTIVE'::text,
    "sizeGuide" text,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_stripeProductId_key" UNIQUE ("stripeProductId")
);

CREATE TABLE "ProductVariant" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "stripeProductId" text NOT NULL,
    "productId" uuid NOT NULL,
    "size" text NOT NULL,
    "stock" integer DEFAULT 0,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductVariant_stripeProductId_key" UNIQUE ("stripeProductId"),
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId")
        REFERENCES "Product" ("id") ON DELETE CASCADE
);

CREATE TABLE "Order" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid,
    "customerEmail" text NOT NULL,
    "totalAmount" numeric NOT NULL,
    "status" text DEFAULT 'PENDING'::text,
    "stripeSessionId" text,
    "shippingAddress" jsonb,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Order_stripeSessionId_key" UNIQUE ("stripeSessionId"),
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE "OrderItem" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "orderId" uuid NOT NULL,
    "variantId" uuid NOT NULL,
    "quantity" integer NOT NULL,
    "priceAtSale" numeric NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId")
        REFERENCES "Order" ("id") ON DELETE CASCADE,
    CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId")
        REFERENCES "ProductVariant" ("id") ON DELETE CASCADE
);

-- Every read path filters or joins on these; none is covered by the PK or the
-- UNIQUEs above.
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant" ("productId");
CREATE INDEX "Order_userId_idx" ON "Order" ("userId");
CREATE INDEX "Order_customerEmail_idx" ON "Order" ("customerEmail");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem" ("orderId");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem" ("variantId");

-- Down Migration

DROP TABLE "OrderItem";
DROP TABLE "Order";
DROP TABLE "ProductVariant";
DROP TABLE "Product";
DROP TABLE "User";
