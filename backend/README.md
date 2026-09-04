# Dejavu — Backend API

Express REST API for the Dejavu storefront. CommonJS, Node >= 20.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the required values
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

| Variable                | Required | Notes                                                                  |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`          | yes      | Removed once the Postgres migration lands.                             |
| `SUPABASE_KEY`          | yes      | Service-role key. Removed with the above.                              |
| `JWT_SECRET`            | yes      | Signs and verifies all JWTs, including admin tokens. Minimum 32 chars. |
| `STRIPE_SECRET_KEY`     | yes      |                                                                        |
| `STRIPE_WEBHOOK_SECRET` | yes      | From `stripe listen` or the Stripe dashboard.                          |
| `FRONTEND_URL`          | no       | Stripe redirect base. Default `https://dejavustudio.xyz`.              |
| `PORT`                  | no       | Default `5000`.                                                        |
| `CORS_ORIGINS`          | no       | Comma-separated. Defaults to the prod, preview, and Vite-dev origins.  |

`src/config/env.js` deliberately does **not** load `dotenv`. The npm scripts pass
`--require dotenv/config`, and in a container there is no `.env` file to find.

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Scripts

| Command       | Description             |
| ------------- | ----------------------- |
| `npm run dev` | nodemon with hot reload |
| `npm start`   | production start        |

## Routes

| Method | Path                                    | Auth             |
| ------ | --------------------------------------- | ---------------- |
| `GET`  | `/api/status`                           | —                |
| `GET`  | `/api/products`, `/api/products/:id`    | —                |
| `POST` | `/api/auth/register`, `/api/auth/login` | —                |
| `POST` | `/api/checkout`                         | —                |
| `GET`  | `/api/checkout/session/:sessionId`      | —                |
| `POST` | `/api/webhooks/stripe`                  | Stripe signature |
| `*`    | `/api/admin/*`                          | JWT + `isAdmin`  |
| `*`    | `/api/user/*`                           | JWT              |

## Stripe webhooks

Signature verification needs the exact raw request body, so
`/api/webhooks/stripe` is mounted with `express.raw()` **before**
`express.json()` in [`src/app.js`](src/app.js). Do not hoist a global body
parser above it.

Local testing:

```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
