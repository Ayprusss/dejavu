# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dejavu is a full-stack e-commerce mock storefront for the luxury fashion brand "Vuja-de". It has two separate workspaces:

- `dejavu/` — React 19 + Vite frontend SPA
- `backend/` — Node.js + Express REST API (CommonJS modules)

## Commands

### Frontend (`dejavu/`)
```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # Production build to dist/
npm run lint     # ESLint
npm run preview  # Preview production build
```

### Backend (`backend/`)
```bash
npm run dev      # nodemon with dotenv (hot-reload)
npm start        # node with dotenv (production)
```

The backend defaults to port `5000`. The frontend reads `VITE_API_URL` from its `.env`; it falls back to `http://localhost:5000`.

### Stripe webhook testing (local)
```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

## Architecture

### Frontend

`App.jsx` is the root component and owns all global state: cart items, cart open/close, and account panel open/close. There is no external state library — state is prop-drilled from `App.jsx` down to pages and components.

**Routing** (`react-router-dom` v7):
- `/entry` — landing/intro page
- `/pages/shop` — product grid (fetched from API)
- `/products/:productId` — single product detail (`:productId` is the Stripe product ID)
- `/collections` — editorial lookbooks, driven by `src/data/collectionsData.json` and `src/data/collectionsMeta.js`
- `/index` — scroll-anchored brand index page
- `/admin/*` — admin dashboard (reads `adminToken` from `localStorage`)
- `/account/*` — user account page

`src/config/api.js` exports `API_URL` — always import from here rather than hardcoding the backend origin.

Collection metadata (season names, folder paths) lives in `src/data/collectionsMeta.js`. The image files are served as static assets from `public/Collections/<id>/`.

### Backend

Express app is assembled in `src/app.js` and started in `src/server.js`.

**Route map:**
| Prefix | Controller |
|---|---|
| `GET /api/products`, `GET /api/products/:id` | `productController` |
| `POST /api/auth/register`, `POST /api/auth/login` | `authController` |
| `POST /api/checkout` | `checkoutController` |
| `POST /api/webhooks/stripe` | `webhookController` |
| `POST/PUT /api/admin/*` | `adminController` (requires JWT + `isAdmin`) |
| `GET /api/user/*` | `userController` (requires JWT) |

**Critical ordering:** The Stripe webhook route (`/api/webhooks/stripe`) must be registered in `app.js` **before** `express.json()` because Stripe signature verification requires the raw request body.

### Auth

JWT tokens are issued on register/login and carry `{ id, isAdmin }`. The `authMiddleware.js` exports `verifyToken` (validates the JWT) and `requireAdmin` (checks `req.user.isAdmin`). All `/api/admin` routes use both. The frontend stores the token in `localStorage` under `adminToken`.

### Supabase schema (key tables)

- **User** — `id`, `email`, `passwordHash`, `firstName`, `lastName`, `isAdmin`
- **Product** — `id`, `stripeProductId`, `name`, `price`, `status`, `images` (array)
- **ProductVariant** — `id`, `productId`, `size`, `stock`
- **Order** — `id`, `stripeSessionId`, `userId` (nullable for guests), `customerEmail`, `totalAmount`, `status`, `shippingAddress`
- **OrderItem** — `id`, `orderId`, `variantId`, `quantity`, `priceAtSale`

On registration, `authController` links any prior guest `Order` rows that match the new user's email by setting `userId`.

### Checkout & Webhook flow

1. Frontend sends cart (`[{ variantId, quantity }]`) to `POST /api/checkout`.
2. `checkoutController` validates stock, builds Stripe `line_items` with `price_data` (dynamic pricing), and returns a `checkoutUrl`.
3. On payment, Stripe POSTs `checkout.session.completed` to `/api/webhooks/stripe`.
4. `webhookController` verifies the signature, creates `Order` + `OrderItem` rows, and decrements `ProductVariant.stock`. Idempotency is enforced by checking for an existing `Order` with the same `stripeSessionId`.

## Environment Variables

**Backend** (`backend/.env`):
```
SUPABASE_URL=
SUPABASE_KEY=           # service role key
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
JWT_SECRET=
FRONTEND_URL=           # used for Stripe redirect URLs (default: https://dejavustudio.xyz)
PORT=                   # optional, default 5000
```

**Frontend** (`dejavu/.env`):
```
VITE_API_URL=           # backend origin, default http://localhost:5000
```
