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

### Tests (`backend/`)
```bash
npm test                 # unit only — pure logic, no database needed
npm run test:integration # real Postgres; needs `docker compose up -d db`
npm run test:all         # both
```

Unit tests cover pure logic (`lib/money`, `lib/cart`, `authMiddleware`).
Everything touching the database is covered by integration tests against real
Postgres — the data layer is deliberately **not** mocked. Integration tests
TRUNCATE every table between cases, so `globalSetup` refuses to run against any
host that is not local. Set `DATABASE_URL` to a throwaway database.

When adding a concurrency test, make the interleaving happen rather than hoping
for it: `Promise.all` alone is not enough, because each transaction finishes
before the next begins. Use `stubLineItemsWithBarrier`, or drive two explicit
connections as `tests/integration/concurrency.test.js` does. Verify a new
correctness test by breaking the code it covers and watching it fail.

### Database (`backend/`)
```bash
docker compose up -d db     # local Postgres 16 on :5432
npm run migrate:up          # apply pending migrations
npm run migrate:down        # roll back the last one
npm run migrate:redo        # all the way down, then back up
```

Migrations live in `backend/migrations/` as plain `.sql` files split by
`-- Up Migration` / `-- Down Migration` comments, run by `node-pg-migrate`
against `DATABASE_URL`. Local, CI and (from Phase 6) RDS all run this same set —
never edit an applied migration, add a new one.

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
| `GET /api/user/*`, `POST /api/user/orders/claim` | `userController` (requires JWT) |

**Critical ordering:** The Stripe webhook route (`/api/webhooks/stripe`) must be registered in `app.js` **before** `express.json()` because Stripe signature verification requires the raw request body. Never hoist a global body parser above it.

**Middleware:** `helmet` → `cors` → `pino-http` → raw webhook route → `express.json()` → routes → 404 → error handler. `express-rate-limit` guards `/api/auth/login` (10 failures / 15 min) and `/api/checkout` (30 / 15 min); both are in-memory, so the budget is per instance (per Lambda execution environment when deployed). Both key on `src/lib/clientIp.js`, not `req.ip`: on the Function URL the adapter passes a client's `X-Forwarded-For` through unmodified, so the real source IP is read from `x-amzn-request-context`, which AWS sets.

**Health checks:** `/api/status` is liveness and never touches the database — it must keep answering 200 while Postgres is down, or a database blip gets the container restarted. `/api/ready` is readiness and does ping the database, returning 503 when it cannot.

**Logging:** `src/lib/logger.js` (pino), JSON one line per event. Every alertable event carries a stable dotted `event` key (`checkout.oversell`, `order.created`, `webhook.duplicate`, …) because CloudWatch metric filters match on those names — renaming one breaks an alarm. Errors go through a bounded serializer: node-postgres attaches an entire `Client` to its errors, and the default pino serializer logs all of it.

### Auth

JWT tokens are issued on register/login and carry `{ id, isAdmin }`. The `authMiddleware.js` exports `verifyToken` (validates the JWT) and `requireAdmin` (checks `req.user.isAdmin`). All `/api/admin` routes use both. The frontend stores the token in `localStorage` under `adminToken`.

### Data access

`src/db/pool.js` is the single `pg.Pool`; `src/db/withTransaction.js` wraps
BEGIN/COMMIT/ROLLBACK. Every function in `src/repositories/` takes an **executor**
as its first argument — the pool for a standalone statement, or a transaction
client to join a caller's transaction. Controllers never build SQL.

`pool.js` parses Postgres `numeric` into a JS number rather than the driver's
default string, because the frontend consumes prices as numbers.

The repositories reproduce the exact nested JSON that PostgREST used to return
(`OrderItem` array, `ProductVariant`/`Product`/`User` objects). Those key names
are a frontend contract — `backend/tests/fixtures/apiShapes.js` records them.

### Database schema (key tables)

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
4. `webhookController` verifies the signature, then does everything else in **one transaction**: claim the event id in `StripeEvent` (`INSERT ... ON CONFLICT DO NOTHING`), insert the `Order` and its `OrderItem` rows, and decrement stock with `UPDATE ... WHERE stock >= $n`. Any failure rolls the whole thing back, including the event claim, so the delivery stays retryable.

**Webhook response semantics:** 400 on a bad signature; 200 for unhandled event types and for duplicates; 200 for an oversell (deterministic — retrying cannot help — logged as `checkout.oversell` for a human to refund); 500 only for genuinely retryable failures, which is the only case where Stripe should redeliver.

**Guest orders** are claimed explicitly via `POST /api/user/orders/claim` with the `stripeSessionId` from the buyer's own success page. Registration does **not** link orders by email — that let anyone who knew an address inherit that person's order history.

### Deployment (AWS, Phase 6)

The backend runs on Lambda behind a Function URL, talks to a private RDS
Postgres 16, and reaches Stripe/SSM/Secrets Manager through a NAT instance.
Infrastructure is `terraform/` (see `terraform/README.md` for first deploy,
rotation, PITR restore and destroy/re-apply runbooks).

- **One Dockerfile, two targets** (`backend/Dockerfile`, arm64):
  - `api` — `node:22-bookworm-slim` plus the Lambda Web Adapter as an
    extension; runs the ordinary Express server. `docker-compose.yml` builds
    this same target locally.
  - `migrator` — AWS Lambda Node base image; handler `src/migrator.handler`.
    Accepts `{"action":"up"}`, `{"action":"seed"}` (seed refuses unless
    `DEPLOY_ENV=dev`), and `{"action":"grant-admin","email":"..."}` (sets
    `isAdmin = true` on an already-registered user, matched case-insensitively
    like login; allowed in any `DEPLOY_ENV`; refuses on a missing/malformed or
    unknown email rather than a silent no-op; idempotent if already an admin;
    logs `admin.granted` with the user id, never the email). There is no
    `down` by payload, on purpose.
- **Entrypoint:** the api image runs `src/lambda.js`, not `server.js`. When
  `SSM_PARAMETER_PATH` is set it loads those parameters into `process.env`
  (and `DB_USER` from the RDS secret) *before* `config/env.js` is required,
  then requires `server.js`. Unset locally, so it falls straight through.
  `lambda.js` must not require `config/env` or `lib/logger` at the top.
- **Database on Lambda:** discrete `DB_HOST`/`DB_NAME`/`DB_SECRET_ARN`
  instead of `DATABASE_URL`, TLS with the RDS CA bundle in `backend/certs/`,
  and the password fetched lazily from the RDS-managed secret
  (`src/db/credentials.js`, 5-minute cache). RDS rotates it weekly; `pool.js`
  calls `invalidate()` on `28P01`, so a rotation costs at most one failed
  request per warm environment, never a redeploy.
- **No secret in a Lambda environment variable or a `.tf` file.** Secrets
  live in SSM (`/dejavu/<env>/`, values set out of band) and the RDS-managed
  secret. `modules/secrets` sets `prevent_destroy`; tear dev down with a
  targeted destroy.
- **Terraform creates functions, it doesn't deploy code** (`ignore_changes =
  [image_uri]`). Images are tagged by git SHA in immutable ECR repos and
  shipped with `aws lambda update-function-code`.
- **Passwords use `bcryptjs`**, not native `bcrypt`, so the image has no
  native build and no CPU-architecture coupling. Existing `$2b$` hashes still
  verify (`tests/authHash.test.js`).

## Environment Variables

**Backend** (`backend/.env`):
```
DATABASE_URL=           # postgres://user:pass@host:5432/db (local/CI/tests)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
JWT_SECRET=
FRONTEND_URL=           # Stripe redirect URLs, and the seed's image URLs
                        # (default: https://dejavustudio.xyz)
SEED_IMAGE_BASE_URL=    # optional, overrides <FRONTEND_URL>/images/ in the seed
PORT=                   # optional, default 5000
PG_POOL_MAX=            # optional, default 10 (1 on Lambda)
LOG_LEVEL=              # optional, default info (silent under NODE_ENV=test)
TRUST_PROXY=            # optional, default 0 — keep 0 on the Function URL,
                        # where X-Forwarded-For is client-controlled
CORS_ORIGINS=           # optional, comma-separated allowed origins
```

**Deployed only** (set by Terraform on the functions, or baked into the image):
```
DB_HOST= DB_NAME= DB_SECRET_ARN=   # all three or none; replaces DATABASE_URL
DB_PORT=                # default 5432
DB_SSL_CA_PATH=         # default backend/certs/rds-global-bundle.pem
DB_USER=                # filled from the RDS secret at cold start, never set
SSM_PARAMETER_PATH=     # e.g. /dejavu/dev — loaded into process.env at boot
DEPLOY_ENV=             # dev | prod; the migrator's seed requires dev
GIT_SHA=                # build arg; GET /api/version returns it
AWS_LWA_PORT=5000 AWS_LWA_READINESS_CHECK_PATH=/api/status AWS_LWA_INVOKE_MODE=buffered
```

**Frontend** (`dejavu/.env`):
```
VITE_API_URL=           # backend origin, default http://localhost:5000
```
