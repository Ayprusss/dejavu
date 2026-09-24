# Dejavu — Backend API

Express REST API for the Dejavu storefront. CommonJS, Node >= 20 (the repo's
`.nvmrc` pins 22). It talks to Postgres through one `pg.Pool` and a set of
repositories, and runs unchanged on AWS Lambda behind the Lambda Web Adapter.

## Setup

```bash
docker compose up -d db   # from the repo root: Postgres 16 on :5432
cp .env.example .env      # then fill in the required values
npm ci
npm run migrate:up
npm run seed              # truncates every table, then loads demo data
npm run dev
```

The server listens on `PORT` (default `5000`).

## Configuration

Every environment variable is read and validated once at boot by
[`src/config/env.js`](src/config/env.js). **No other module reads `process.env`
directly.** If a required variable is missing or malformed the process throws
before the server binds, listing every problem at once:

```
Error: Invalid environment configuration:
  - Missing required environment variables: JWT_SECRET
  - PORT must be an integer between 1 and 65535 (got "abc")
```

[`.env.example`](.env.example) documents every variable in more detail.

| Variable                | Required | Notes                                                                                                                                 |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes\*    | Postgres connection string (local, CI, tests). \*Or set all three of `DB_HOST`, `DB_NAME`, `DB_SECRET_ARN`; a partial set fails boot. |
| `JWT_SECRET`            | yes      | Signs and verifies all JWTs, including admin tokens. Minimum 32 chars.                                                                |
| `STRIPE_SECRET_KEY`     | yes      |                                                                                                                                       |
| `STRIPE_WEBHOOK_SECRET` | yes      | From `stripe listen` or the Stripe dashboard.                                                                                         |
| `FRONTEND_URL`          | no       | Stripe redirect base, and the seed's image base. Default `https://dejavustudio.xyz`.                                                  |
| `SEED_IMAGE_BASE_URL`   | no       | Overrides the seed's `<FRONTEND_URL>/images/`.                                                                                        |
| `PORT`                  | no       | Default `5000`.                                                                                                                       |
| `PG_POOL_MAX`           | no       | Default `10` (`1` on Lambda).                                                                                                         |
| `LOG_LEVEL`             | no       | pino level. Default `info`, or `silent` under `NODE_ENV=test`.                                                                        |
| `TRUST_PROXY`           | no       | Default `0`. Keep `0` on the Function URL, where `X-Forwarded-For` is client-controlled.                                              |
| `CORS_ORIGINS`          | no       | Comma-separated. Defaults to the prod, preview, and Vite-dev origins.                                                                 |

**Set by the deployment, not locally:**

| Variable                              | Notes                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DB_HOST`, `DB_NAME`, `DB_SECRET_ARN` | RDS connection. All three or none; they replace `DATABASE_URL`.                                             |
| `DB_PORT`, `DB_SSL_CA_PATH`           | Default `5432` and the bundled [`certs/rds-global-bundle.pem`](certs/).                                     |
| `DB_USER`                             | Filled from the RDS secret at cold start, never set by hand.                                                |
| `SSM_PARAMETER_PATH`                  | e.g. `/dejavu/dev`. [`src/lambda.js`](src/lambda.js) loads it into `process.env` before `env.js` validates. |
| `DEPLOY_ENV`                          | `dev` or `prod`. The migrator's `seed` action refuses unless it's `dev`.                                    |
| `GIT_SHA`                             | Build arg, returned by `GET /api/version`.                                                                  |

`src/config/env.js` deliberately does **not** load `dotenv`. The npm scripts pass
`--require dotenv/config`, and in a container there is no `.env` file to find.

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Scripts

| Command                    | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run dev`              | nodemon with hot reload                                              |
| `npm start`                | production start                                                     |
| `npm run migrate:up`       | apply pending migrations (`node-pg-migrate`, against `DATABASE_URL`) |
| `npm run migrate:down`     | roll back the last migration                                         |
| `npm run migrate:redo`     | all the way down, then back up                                       |
| `npm run seed`             | **truncate every table**, then load demo products and users          |
| `npm test`                 | unit tests: pure logic, no database                                  |
| `npm run test:integration` | integration tests against real Postgres (truncates between cases)    |
| `npm run test:all`         | both                                                                 |
| `npm run lint`             | ESLint                                                               |
| `npm run format:check`     | Prettier check (`npm run format` to fix)                             |

## Routes

| Method | Path                                    | Auth             |
| ------ | --------------------------------------- | ---------------- |
| `GET`  | `/api/status`                           | —                |
| `GET`  | `/api/ready`                            | —                |
| `GET`  | `/api/version`                          | —                |
| `GET`  | `/api/products`, `/api/products/:id`    | —                |
| `POST` | `/api/auth/register`, `/api/auth/login` | —                |
| `POST` | `/api/checkout`                         | optional JWT     |
| `GET`  | `/api/checkout/session/:sessionId`      | optional JWT     |
| `POST` | `/api/webhooks/stripe`                  | Stripe signature |
| `GET`  | `/api/user/orders`                      | JWT              |
| `POST` | `/api/user/orders/claim`                | JWT              |
| `*`    | `/api/admin/*`                          | JWT + `isAdmin`  |

- **Health:** `/api/status` is liveness and never touches the database, so a
  database blip doesn't get the instance restarted. `/api/ready` is
  readiness: it pings the database and returns 503 when it can't reach it.
- **Rate limits** (in memory, so per instance):
  - `POST /api/auth/login`: 10 failed attempts per 15 minutes.
  - `/api/checkout`: 30 requests per 15 minutes.

  Both key on the real source IP from
  [`src/lib/clientIp.js`](src/lib/clientIp.js), not `req.ip`. On the Function
  URL, `X-Forwarded-For` is client-controlled.

- **Guest orders** are claimed explicitly with the buyer's own
  `stripeSessionId`. Registering never links orders by email.

## Stripe webhooks

Signature verification needs the exact raw request body, so
`/api/webhooks/stripe` is mounted with `express.raw()` **before**
`express.json()` in [`src/app.js`](src/app.js). Do not hoist a global body
parser above it.

The handler does everything in one transaction:

1. Claim the Stripe event id.
2. Insert the order and its items.
3. Decrement stock with `WHERE stock >= $n`.

Any failure rolls all of it back, so the delivery stays retryable.

Responses:

- **400** for a bad signature.
- **200** for duplicates, unhandled event types and oversells. An oversell is
  logged as `checkout.oversell` for a human to refund.
- **500** only for failures a retry could fix.

Local testing:

```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.

## More

- **Migrations and the expand/contract rule:** [`MIGRATIONS.md`](MIGRATIONS.md)
- **Logging:** [`src/lib/logger.js`](src/lib/logger.js). It's pino, one JSON
  line per event. Alertable events carry a stable `event` key, and CloudWatch
  alarms match on those names, so don't rename them.
- **Container images:** [`Dockerfile`](Dockerfile) builds the `api` target
  (Express plus the Lambda Web Adapter) and the `migrator` target (a Lambda
  handler for `up`, `seed` and `grant-admin`).
- **Deployment:** the root [`README.md`](../README.md) and
  [`terraform/README.md`](../terraform/README.md).
