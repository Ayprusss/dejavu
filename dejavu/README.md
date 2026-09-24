# Dejavu — Storefront

The React single-page app for the Dejavu storefront. It covers product
browsing, editorial lookbooks, a slide-out cart, Stripe Checkout, and user
and admin accounts. It talks to the Express API in [`../backend`](../backend)
over REST.

## Tech stack

- **React 19** + **Vite**, **React Router v7**.
- **Plain CSS**, with no UI framework.
- **No state library.** All global state lives in `App.jsx` (cart items, cart
  open/close, account panel) and is passed down as props.
- **EmailJS** for the contact form.
- **Vitest** for unit tests.
- **Hosting:** Vercel, with [`vercel.json`](vercel.json) rewriting every path
  to `index.html`. [`Dockerfile`](Dockerfile) and [`nginx.conf`](nginx.conf)
  serve the same build in a container for `docker compose`.

## Routes

| Path                                    | Page                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/entry`                                | Landing page. `/` and unknown paths redirect here.                                                                                    |
| `/pages/shop`                           | Product grid from `GET /api/products`. `/shop` redirects here.                                                                        |
| `/products/:productId`                  | Product detail with size and stock (`:productId` is the Stripe product id)                                                            |
| `/collections`                          | Editorial lookbooks, from `src/data/collectionsData.json` and `collectionsMeta.js`                                                    |
| `/index`                                | Scroll-anchored brand index                                                                                                           |
| `/about`, `/contact`                    | About; contact form (EmailJS)                                                                                                         |
| `/checkout/success`, `/checkout/cancel` | Stripe Checkout return pages. The success page polls `GET /api/checkout/session/:sessionId` until the webhook has recorded the order. |
| `/account/*`                            | Sign in or register, order history                                                                                                    |
| `/admin/*`                              | Admin dashboard: products, stock, orders. Needs an admin JWT.                                                                         |

Lookbook images are static assets under `public/Collections/<id>/`.

## Configuration

| Variable       | Default                 | Notes                                                                                                                                 |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | `http://localhost:5000` | Backend origin. Read only in [`src/config/api.js`](src/config/api.js); import `API_URL` from there rather than hard-coding an origin. |

`VITE_API_URL` is inlined **at build time**, so each environment (local, dev,
prod) is a separate build, not one build with runtime config.

## Local development

Start the API first; see [`../backend/README.md`](../backend/README.md). Then:

```bash
npm ci
npm run dev        # http://localhost:5173
```

| Command                | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                                           |
| `npm run build`        | Production build to `dist/`                                               |
| `npm run preview`      | Serve the production build                                                |
| `npm test`             | Unit tests (`tests/`: cart arithmetic, checkout-attempt idempotency keys) |
| `npm run lint`         | ESLint                                                                    |
| `npm run format:check` | Prettier check                                                            |

## Checkout

1. The cart sends `[{ variantId, quantity }]` to `POST /api/checkout`, along
   with an `idempotencyKey` from [`src/lib/checkoutAttempt.js`](src/lib/checkoutAttempt.js).
   The key stays stable across retries of one attempt, so a double click
   doesn't create two Stripe sessions.
2. The browser is redirected to Stripe Checkout.
3. The order is recorded server-side, from Stripe's webhook, never from the
   browser.

Guest orders aren't linked by email when someone registers. The API claims
them explicitly instead, with `POST /api/user/orders/claim` and the
checkout's session id. **The storefront doesn't call that endpoint yet**, so
there's no UI for claiming a guest order.
