# DejaVu Backend Implementation Plan

This document outlines the architecture and step-by-step implementation plan for a custom Express backend utilizing Supabase (PostgreSQL), tightly integrated with Stripe for secure checkout and custom admin pages for inventory/order management.

## Architecture Overview

**Tech Stack**:
*   **Web Framework**: Node.js + Express
*   **Database**: PostgreSQL (via Supabase)
*   **eCommerce Engine**: Stripe Checkout & Webhooks
*   **Admin Dashboard**: Custom React pages integrated into the frontend

### Conceptual Data Flow

1.  **Catalog Truth**: The custom Supabase Postgres database is the sole source of truth for the "storefront experience" (products, pricing, inventory sizing, images) and order history.
2.  **Cart & Checkout**: The frontend accumulates a cart locally. When checking out, the Express backend receives the cart, calculates the total (or retrieves prices from Supabase to prevent frontend tampering), and calls the Stripe API to generate a unique Stripe Checkout Session `checkoutUrl`.
3.  **Handoff**: The user is redirected to the Stripe-hosted checkout page to handle payments and collect shipping/billing information securely.
4.  **Fulfillment Loop (Webhooks)**: Once the user pays, Stripe fires a `checkout.session.completed` webhook to the Express backend. The backend validates the Stripe signature, writes the official order record to Supabase, and decrements stock.
5.  **Admin Management**: An administrative section in the frontend interacts with protected backend routes (`/api/admin/*`) to manage products, adjust inventory, and view incoming orders.

### Recommended Directory Structure
The Express backend should be completely isolated from your React frontend in its own dedicated package.

```text
d:/coding_files/dejavu/
├── dejavu/              # Your existing Vite/React frontend
│   ├── package.json
│   ├── src/
│   │   ├── Pages/
│   │   │   └── Admin/   # New Admin pages (Products, Orders)
│   │   └── ...
└── backend/             # New dedicated backend directory
    ├── package.json
    ├── server.js        # Express app entry point
    ├── controllers/     # API logic (products, stripe, admin)
    ├── routes/          # Express route definitions
    └── .env             # Backend secrets (Supabase, Stripe)
```

---

## 1. Database Schema Design (Existing Supabase SQL)

Since we are not using Shopify, we must handle our own product catalog, inventory tracking, and order history entirely in Supabase. You mentioned the tables (`Order`, `OrderItem`, `Product`, `ProductVariant`) already exist from the previous Prisma setup and are populated.

We will keep the existing structure, but we need to ensure the `Order` and `ProductVariant` tables have the necessary columns for Stripe integration.

**Required Schema Adjustments (if not already present from Prisma):**

```sql
-- Create User table for customer accounts
CREATE TABLE IF NOT EXISTS "User" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "email" TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "isAdmin" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rename existing Shopify columns to Stripe equivalents
ALTER TABLE "Product" RENAME COLUMN "shopifyId" TO "stripeProductId";
ALTER TABLE "Order" RENAME COLUMN "shopifyOrderId" TO "stripeSessionId";
ALTER TABLE "ProductVariant" RENAME COLUMN "shopifyVariantId" TO "stripePriceId";

-- Add Account linking and missing columns to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "userId" UUID REFERENCES "User"("id");
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingAddress" JSONB;

-- Ensure ProductVariant can hold inventory counts
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "stock" INTEGER DEFAULT 0;
```

---

## 2. API Route Architecture

### Storefront Routes (Public)
*   `GET /api/products` - Fetch all active products for the shop index.
*   `GET /api/products/:id` - Fetch detailed info (sizing, variants) for the product page.
*   `POST /api/checkout` - Receives the user's cart containing variant IDs and quantities. Validates prices against the database, then calls Stripe to create a checkout session and returns the `checkoutUrl`.

### Webhook Routes (Public, but Secured)
*   `POST /api/webhooks/stripe` - Receives payment events from Stripe (e.g., `checkout.session.completed`). **Must validate the Stripe signature using the raw request body**.

### Admin Routes (Protected via JWT/Session/Auth)
*   `POST /api/admin/products` - Create new storefront products.
*   `PUT /api/admin/products/:id` - Update products (e.g., change price, edit description).
*   `PUT /api/admin/inventory/:variantId` - Adjust stock levels for specific sizes.
*   `GET /api/admin/orders` - View historical orders and customer details.

---

## 3. Step-by-step Implementation To-Do List

### Phase 1: Infrastructure & Database
- [x] Initialize the Node project (`npm init -y`) and install dependencies (`express`, `cors`, `dotenv`, `@supabase/supabase-js`, `stripe`).
- [x] Setup the server entry point (`server.js` or `app.js`) with essential middleware (JSON parsing, CORS).
- [x] Install `@supabase/supabase-js` and set up the `SUPABASE_URL` and `SUPABASE_KEY` environment variables in `.env`.
- [x] Create connection client (`supabase.js` or directly inside routes).
- [x] Run SQL `ALTER TABLE` commands in Supabase SQL Editor to rename Shopify-related columns (`shopifyId`, `shopifyOrderId`, `shopifyVariantId`) to Stripe equivalents, and add `shippingAddress` and `stock` columns to the existing Prisma tables.

### Phase 2: User Authentication & Storefront API
- [ ] Implement user authentication routes (`POST /api/auth/register`, `POST /api/auth/login`) using JWTs and `bcrypt` for password hashing.
- [ ] Build a frontend `/account` page to allow users to log in, view their details, and fetch their past orders.
- [ ] Implement controllers for `GET /api/products` and `GET /api/products/:id` using Supabase API.
- [ ] Build basic Admin React pages (e.g., `/admin/products`) to allow easy entry of new products, uploading images, and setting stock levels for sizes.
- [ ] Create basic backend routes (`POST /api/admin/products`, `PUT /api/admin/inventory`) to support the Admin UI.
- [ ] Ensure frontend `Shop.jsx` dynamically loads products from Supabase instead of hardcoded data.

### Phase 3: Stripe Checkout Integration
- [ ] Set up a Stripe Developer account and get API keys (`STRIPE_SECRET_KEY`).
- [ ] Implement the `POST /api/checkout` route:
    - Receive cart items (`[ { variantId, quantity } ]`) from the React frontend.
    - Query Supabase to get the true prices for those variants (do NOT trust frontend prices).
    - Use the Stripe SDK (`stripe.checkout.sessions.create`) to build a session with `line_items`.
    - Handle successful response by extracting `session.url`.
    - Send the URL back to the frontend to redirect the user to Stripe Checkout.

### Phase 4: Webhooks & Order Fulfillment
- [ ] Create the `POST /api/webhooks/stripe` endpoint.
- [ ] **Crucial**: Implement middleware specifically for the webhook route to capture the RAW request body (required for Stripe signature validation — standard `express.json()` prevents this).
- [ ] Read the Stripe Webhook Signing Secret (`STRIPE_WEBHOOK_SECRET`) from `.env`.
- [ ] Use `stripe.webhooks.constructEvent` to validate the payload.
- [ ] Listen specifically for `checkout.session.completed`:
    - Create a new `Order` row in Supabase marking it as 'PAID'.
    - Create associated `OrderItem` rows.
    - Decrement `stock` for each `product_variants` row purchased to avoid overselling.
- [ ] Use the Stripe CLI to forward webhooks to `localhost` to test locally.

### Phase 5: Frontend Connection & Admin Orders
- [ ] Update frontend `Cart.jsx` checkout button to call `POST /api/checkout`, grab the URL, and execute `window.location.href = data.checkoutUrl`.
- [ ] Add success/cancel redirect pages (`/checkout/success` and `/checkout/cancel`) in the frontend router to handle users returning from Stripe.
- [ ] Build an Admin UI screen (`/admin/orders`) to view paid orders, see shipping addresses gathered by Stripe, and mark them as fulfilled.
