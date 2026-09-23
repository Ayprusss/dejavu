# Dejavu — Phased Execution Plan (CI/CD + Cloud)

## Context

`dejavu-mvp-roadmap.md` lays out six items to take Dejavu from a working mock storefront to something defensible on a resume. This document turns that roadmap into an ordered execution plan, adjusted for what the codebase actually looks like today and for four decisions already made:

- **Secrets:** Stripe keys are live and must be rotated + untracked. Supabase is being abandoned regardless.
- **Database:** full migration to AWS RDS Postgres (roadmap #2 in full).
- **Compute:** **Lambda Web Adapter + Function URL**, not Fargate + ALB.
- **Scope:** CI/CD work first (roadmap #1 and #5) in depth; AWS items planned but executed later.

## How we execute: batches

Work proceeds in batches, each ending at a checkpoint for review before the next begins. Nothing below is executed on the strength of this document alone — each batch gets its own approval.

| Batch | Phases | Checkpoint |
|---|---|---|
| **A** | 0 — Remediation & hygiene | Keys rotated, repo clean, app fails fast without `JWT_SECRET` |
| **B** | 1 — Test harness + CI gate | Red CI blocks a PR merge |
| **C1** | 2a — Migrations + `pg` layer scaffolding **[x]** | `docker compose up` runs local Postgres; migrations up/down clean |
| **C2** | 2b — Rewrite the 20 controller call sites **[x]** | Zero `supabase` imports; storefront works end to end locally |
| **D** | 3 — Correctness fixes **[x]** | Webhook is transactional; stock decrements atomically |
| **E** | 4 — Integration in CI **[x]** · E2E deferred | Idempotency and no-oversell proven by tests |
| — | *CI/CD complete. Everything to here costs $0.* | **Natural stopping point** |
| **F** | 5 — Terraform + OIDC + secrets **[x]** | `plan` on PR with no AWS keys in the repo |
| **G** | 6 — RDS + Lambda deploy **[x]** | Real Stripe webhook verifies against the Function URL |
| **H** | 7 — Dev (staging) → prod CD **[~]** | Broken build auto-rolls back |

Phase 2 is split because it is by far the largest — the scaffolding is low-risk and the rewrite is where the bugs hide, so they get separate review. Batch E is a genuine stopping point: the resume value of Phases 0–4 is high and the cost is nothing, so it's a reasonable place to pause and reassess appetite for the AWS half.

### What the codebase looked like at the start of this plan

*Kept as the before-picture. Phases 0–2 have since changed every row.*

| Area | State |
|---|---|
| Tests | **Zero.** No runner, no test files. `npm test` is the default stub that `exit 1`s. |
| CI | **Zero.** No `.github/` directory of any kind. |
| Lint | Frontend has ESLint flat config (Vite template defaults). **Backend has no linter.** No Prettier anywhere. |
| Containers | Both Dockerfiles + `docker-compose.yml` exist and are sound. **No `db` service.** |
| Migrations | None. `init-scripts/init.sql` is an orphaned `pg_dump` nothing consumes. |
| Data layer | No abstraction. 20 `supabase.from(...)` call sites directly in 6 controllers. **No `.rpc()`, therefore no transactions anywhere.** |
| Health check | `GET /api/status` already exists (liveness only — never touches the DB). |
| Test seam | `app.js` exports the app **without** listening. `supertest` works today with zero refactor. |

### Three findings that reorder the roadmap

**1. `backend/.env` is committed to a public repo.** Live `STRIPE_SECRET_KEY` and Supabase service-role key, present since commit `6d558a1`. Also `backend/node_modules` is committed — 2,434 of the repo's 2,638 tracked files, and why `.git` is 187 MB. Nothing else starts until this is handled.

**2. The data-layer rewrite is a CI/CD prerequisite, not a cloud one.** Roadmap #5's marquee tests — idempotency under replay, no overselling under concurrency — require transactions and row-level locking. The Supabase client cannot express either. So the *rewrite* (Supabase → `pg`) must happen inside the CI/CD phase, running against Dockerized Postgres. *Provisioning RDS* is a separate, later, purely-infrastructural step. This is what makes "CI/CD first, cloud later" work with "full RDS migration" — they are two halves of roadmap #2 and they separate cleanly.

**3. Lambda-in-VPC + private RDS has a cost trap.** A VPC-attached Lambda has no route to the internet, and this backend calls the Stripe API on every checkout. A NAT Gateway is ~$33/mo — more than the Fargate you chose Lambda to avoid. Resolved in Phase 6 with a NAT instance (~$10/mo at list price once its public IPv4 is counted; see Phase 6); flagged here because it changes the cost math behind the compute decision.

### Sequencing

```
Phase 0  Remediation & hygiene        BLOCKER      hours        [done]
Phase 1  Test harness + CI gate       roadmap #1   ~1 week      [done]
Phase 2  Postgres data layer          roadmap #2a  ~1-2 weeks   [done] <- largest single phase
Phase 3  Correctness fixes            roadmap #5a  ~1 week      [done]
Phase 4  Integration + E2E in CI      roadmap #5b  ~1 week      [integration done; E2E deferred]
-- CI/CD complete; everything above costs $0 --
Phase 5  Terraform + OIDC + secrets   roadmap #3   ~1 week   [done]
Phase 6  RDS + Lambda deploy          roadmap #2b/#4            [done; dev only]
Phase 7  Dev (staging) -> prod CD     roadmap #6                [code done; not yet run on AWS]
```

Phases 0–4 are specified in execution detail. Phases 5–7 are specified at decision level — the choices are made and justified, the implementation detail comes in a later pass once Phase 4 lands.

---

# Phase 0 — Remediation & Repo Hygiene [x]

**Blocking.** Cheap, and it is what makes the roadmap #3 story ("I concluded any credential a human can copy will eventually leak") credible rather than aspirational.

### Secrets

1. [x] Rotate `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in the Stripe dashboard. Roll, don't just create — the old key must be revoked.
2. [x] Revoke the Supabase service-role key / delete the project outright, since it is being abandoned.
3. [x] `git rm --cached backend/.env backend/err.log backend/error.log` and `git rm -r --cached backend/node_modules`.
4. [x] `backend/.gitignore` currently contains only `.env`. Add `node_modules/`, `*.log`.
5. **History purge (recommended).** [x] `git filter-repo --path backend/.env --path backend/node_modules --invert-paths`, then force-push. Rewrites all 135 commit SHAs — acceptable here: solo repo, `main` only, no PRs, no forks. It also drops `.git` from 187 MB to a few MB, which is the difference between a CI checkout that takes seconds and one that takes minutes. Skippable if you'd rather not rewrite a public repo's history, but then note the keys stay readable in history forever.
6. Enable **GitHub secret-scanning push protection** [x] (free on public repos) and add **gitleaks** as a CI job.

### Fail-fast configuration [x]

`JWT_SECRET` has a hardcoded fallback — `process.env.JWT_SECRET || 'super_secret_jwt_key'` — at three sites: `backend/src/middleware/authMiddleware.js:11`, `backend/src/controllers/authController.js:64` and `:99`. If the variable is ever unset in a deployed environment, the service signs and verifies with a public constant and **anyone can mint an `isAdmin: true` token**. `backend/.env.example` doesn't even list `JWT_SECRET`, which makes that a likely accident rather than a hypothetical one.

- New `backend/src/config/env.js`: reads and validates every required var once, throws at boot listing all missing names. Model it on `backend/src/stripe.js:5-7`, which already fails fast correctly — it's the only one that does.
- Delete the three `|| 'super_secret_jwt_key'` fallbacks.
- Remove the module-scope `require('dotenv').config({ path: '../.env' })` from `backend/src/supabase.js:2` and `backend/src/stripe.js:2` — the npm scripts already pass `--require dotenv/config`, and in Lambda there is no `.env` file at all.
- Complete `backend/.env.example`: add `JWT_SECRET`, `FRONTEND_URL`, `PORT`, `CORS_ORIGINS`. Drop `STRIPE_PUBLISHABLE_KEY` (no code reads it).

### Response-leak fixes [x]

- `backend/src/controllers/checkoutController.js:103-111` returns `error.stack` in the 500 body.
- `backend/src/controllers/authController.js:68` returns `newUser[0]` raw — **including `passwordHash`**. `login` at `:104-112` already whitelists fields correctly; copy that.

### Housekeeping [x]

Delete `backend/supatest.js`, the empty `backend/README.md` (or write one), the stray root `src/theme.css`. Fix `"main": "index.js"` in `backend/package.json` — no such file exists. Add `"engines": { "node": ">=20" }` and an `.nvmrc`.

**Exit criteria:** no secrets in the working tree or (optionally) history; `git ls-files | wc -l` drops from 2,638 to ~200; the app refuses to boot without a real `JWT_SECRET`.

---

# Phase 1 — Test Harness + CI Gate [x]

*Roadmap #1.* Goal is a green gate on `main` and tests for the logic that **survives the Phase 2 rewrite** — no throwaway work.

### Tooling [x]

**Vitest** for both workspaces (one runner, one config idiom; handles the backend's CommonJS fine) plus **supertest** on the backend. `backend/src/app.js:50` already exports the app without listening, so no refactor is needed to start.

Add to the backend: ESLint flat config (it has none today) and Prettier across both workspaces. Note the frontend has **React Compiler enabled** via `babel-plugin-react-compiler` — it is sensitive to hook-rule violations, so keep `eslint-plugin-react-hooks` gating.

### What to test now [x]

Chosen because none of it touches the data layer, so all of it survives Phase 2:

**`authMiddleware` — table-driven, so RBAC is tested once rather than forty times over.** One `describe.each` covering: no header; malformed scheme (`split(" ")[1]` currently accepts `Basic <jwt>`); expired token; token signed with the wrong secret; **valid token belonging to a non-admin hitting an admin route**. That last one is the interesting test in the file.

**Checkout input validation** (`checkoutController.js:10-27`): non-array body, empty cart, missing `variantId`, quantity `0` / `-1` / `1.5` / `"3"`, and **duplicate cart lines for the same variant** — which is a real bug surfaced in Phase 3, so write the test now and mark it `.todo` until then.

**Price arithmetic.** `checkoutController.js:66` does `Math.round(Number(price) * 100)` — the correct float-to-cents conversion; test `19.99`, `0.1`, `1980.00`. On the frontend, `App.jsx:158-161` round-trips money through a *formatted string* (`"$1,980.00"` → `Number(...replace(/[^0-9.-]+/g,""))`). It works today only by accident of the regex also stripping commas, and `Shop.jsx:95` formats via `toLocaleString` on a different path. Test it, then fix it by carrying the numeric price alongside the label.

**Cart state** — `App.jsx:118-179` increment / decrement / remove / add, and the `Cart.jsx:30` subtotal reduce.

**Server-side price integrity** — assert that a `price` field in the request body is ignored. It already is (`checkoutController.js:14-17` narrows to `{ variantId, quantity }`), and a test locks that in.

### CI workflow [x]

`.github/workflows/ci.yml`, on PR and push to `main`. Jobs: `lint` · `test-backend` (Node 20 + 22 matrix) · `test-frontend` · `build-frontend` · `gitleaks`. `actions/setup-node` with `cache: npm` keyed per workspace.

Coverage via v8 — **report it, do not gate on a number.** Chasing a coverage percentage on a codebase this size produces tests written to touch lines rather than to catch bugs; the honest answer to "what's your coverage" is a number plus a reason you aren't optimizing it.

Enable branch protection on `main` requiring these checks. **This changes your workflow** — all 135 commits so far went straight to `main`, and branch protection means working through PRs from here on.

**Exit criteria:** red CI blocks merge; `npm test` passes in both workspaces; a non-admin JWT is proven to be rejected by an admin route.

---

# Phase 2 — Postgres Data Layer + Versioned Migrations [x]

*Roadmap #2, the non-AWS half.* The largest phase. Nothing in Phase 3 is possible without it.

### Choice: `pg` + `node-pg-migrate`, not Prisma

Three reasons, all defensible: the schema uses quoted camelCase identifiers throughout, which fights every ORM; the whole point of Phase 3 is explicit transactions and `UPDATE ... WHERE stock >= $n`, and an ORM hides exactly the mechanism that's interesting; and Prisma's query engine binary is a poor fit for the Lambda package in Phase 6. There is also a leftover `_prisma_migrations` table in `init.sql` from an ORM that was already ripped out once.

### Local Postgres [x]

Add a `db` service (`postgres:16-alpine`) to `docker-compose.yml` with `depends_on: { db: { condition: service_healthy } }`. Local, CI, and RDS then all run the same schema from the same migrations — which is the actual point.

### Migrations [x]

Convert `init-scripts/init.sql` into `backend/migrations/`, each with an `up` and a `down`:

| # | Migration | Why |
|---|---|---|
| 0001 | Baseline schema | Tables, PKs, FKs, existing UNIQUEs. **Strip the Supabase-isms:** drop `_prisma_migrations`, drop `ENABLE ROW LEVEL SECURITY` and the `GRANT ALL ... TO anon/authenticated/service_role` blocks. RLS is enabled on all six tables with **zero policies**, and the app only works because the service-role key bypasses it — on plain RDS all of that is meaningless and access control collapses entirely to the app layer. |
| 0002 | Fix `ProductVariant_stripeProductId_key` | This UNIQUE is **wrong** — every size variant of one product shares a Stripe product ID, so it blocks seeding any product with more than one size. Drop it; add `UNIQUE ("productId", "size")`. |
| 0003 | `CHECK ("stock" >= 0)` | Makes overselling a database error rather than a silent clamp. |
| 0004 | `StripeEvent (id text PK, type text, receivedAt timestamptz)` | The idempotency anchor for Phase 3. |
| 0005 | `Order.customerEmail` nullable | It is `NOT NULL` today, but `webhookController.js:80` inserts `customerEmail \|\| null`. A Stripe session without `customer_details.email` is a hard insert failure → 500 → **Stripe retries forever.** |
| 0006 | `updatedAt` trigger | Every controller sets `updatedAt` by hand today; it's one omission away from being wrong. |
| 0007 | Case-insensitive email | `User_email_key` is a plain UNIQUE, so `A@x.com` and `a@x.com` are two accounts. `citext` or a `lower(email)` unique index, plus normalize on register. |

Keep the double-quoted camelCase identifiers throughout — the rewrite has to match.

### Data-access layer [x]

```
backend/src/db/pool.js              pg.Pool; max configurable (load-bearing in Phase 6)
backend/src/db/withTransaction.js   BEGIN / COMMIT / ROLLBACK helper
backend/src/repositories/           userRepo, productRepo, orderRepo, variantRepo
```

Every repository function takes an executor (pool *or* transaction client) as its first argument. That single decision is what makes Phase 3's atomic webhook possible and makes controllers testable.

Then rewrite all 20 call sites. **Three are genuinely hard** — the deep PostgREST embedded selects, which have no direct SQL equivalent and become explicit `JOIN`s with `json_agg` subqueries:

- `adminController.js:85` — Order → User + OrderItem → ProductVariant → Product
- `userController.js:8` — three-level nest
- `checkoutController.js:123` — three-level nest

Also port `backend/scripts/seed.js` and `fix-image-urls.js` (they build their own duplicate Supabase clients) and delete `backend/src/supabase.js`.

### What Phase 2 actually turned up

Three things the plan did not anticipate, all handled:

**`numeric` changes JavaScript type across the driver swap.** `supabase-js` returned JSON numbers; node-postgres returns `numeric` (OID 1700) as a *string*, to preserve precision. `Account.jsx:105` calls `order.totalAmount.toFixed(2)` directly, so this would have crashed the account page rather than merely mis-rendering. `db/pool.js` registers a type parser back to `Number` — safe here because prices are decimal dollars well inside exact double range and money is converted to integer cents by `lib/money.toCents` before it is charged.

**The nested PostgREST key names are a frontend contract.** The plan flagged the three deep selects as *hard*, but the sharper point is that `OrderItem[]`, `ProductVariant`/`Product`/`User`, `User: null` for guests and `OrderItem: []` for empty are all destructured directly in `Account.jsx`, `Shop.jsx`, `ShopItem.jsx`, `CheckoutSuccess.jsx` and `AdminDashboard.jsx`. The repositories rebuild them exactly; `backend/tests/fixtures/apiShapes.js` records the shapes, captured from a live run, so Phase 4 asserts against something concrete.

**Two Phase 3 items landed early, one for free.** Migration 0003's `NOT NULL` was not in the plan — without it `CHECK (stock >= 0)` is toothless, since `NULL >= 0` is NULL and a CHECK accepts that. And `shippingAddress` is fixed as a *side effect* of the driver change, not a decision: the Supabase client `JSON.stringify`'d the object into a `jsonb` column, storing a JSON string scalar; node-postgres serialises the object itself. Verified over HTTP — `order.shippingAddress.city` now reads back.

Deliberately **not** done in 2b, so Phase 3 owns them with tests: the webhook stays non-transactional, its idempotency probe stays a read-then-write, stock stays read-modify-write, and guest-order linking stays automatic and unverified. `webhookController.js` carries a header comment listing each one.

### Testing strategy note

This is the answer to the roadmap's "why unit-test controllers with a mocked DB when you also run integration tests?" — **we deliberately don't.** Mocking `supabase-js`'s chained builder is high-effort, high-brittleness, and would all be thrown away here anyway. Unit tests cover pure logic (Phase 1); everything touching the database is covered by integration tests against real Postgres (Phase 4). Deciding *not* to mock the database is a stronger answer than a mock layer nobody trusts.

**Exit criteria [x]:** `docker compose up` gives a working stack with local Postgres; zero `@supabase/supabase-js` imports remain; migrations run forward and backward cleanly.

Verified: `migrate up -> down 0 -> up` clean against `postgres:16-alpine`; the containerised backend serves seeded data from the containerised database; `npm run seed` runs in one transaction and seeds 2 products / 6 variants sharing Stripe product ids (which migration 0002 is what makes possible); 44 HTTP-level assertions over every ported endpoint pass, covering the nested shapes, case-insensitive login, guest-order linking, `404` rather than `500` for a non-UUID product id, and `400` rather than `500` for negative stock. `@supabase/supabase-js` is uninstalled and `src/supabase.js` deleted; `init-scripts/` and `supabase/` are gone, along with the root `supabase` CLI dependency.

---

# Phase 3 — Correctness Fixes [x]

*Roadmap #5's substance.* Every fix here is scale-independent and each one has a test in Phase 4 that proves it.

**Already landed in Phase 2b, so skip them here:** the `shippingAddress` jsonb double-encoding (fixed by the driver change), and the schema half of the null-stock hole (migration 0003's `NOT NULL` + `CHECK`). The `checkoutController` guard at `:37` that reads `typeof variant.stock === 'number'` is now dead code rather than a live bug, but still wants removing.

### Webhook: one transaction, one event, one order [x]

`webhookController.js` currently makes `1 + 2N` independent HTTP round-trips with **no transaction and no compensating rollback**. A crash midway leaves a `PAID` order with partial items and partially-decremented stock — and because the order row now exists, every retry hits the idempotency check at `:47` and **skips**, cementing the partial state permanently.

- Wrap order insert + all item inserts + all stock decrements in a single `withTransaction`.
- **Event-level idempotency inside that same transaction:** `INSERT INTO "StripeEvent" (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`. No row returned → already processed → return 200. This is the answer to "why a unique constraint rather than check-then-insert": the current `.select().eq("stripeSessionId")` at `:42-50` is a read-then-write that two concurrent deliveries both pass, and it discards the query's `error` so a transient network failure reads as "no existing order" and reprocesses.
- **Atomic stock:** replace the read-modify-write at `:125-147` — a textbook lost update, where two concurrent orders both read `stock = 5` and both write `4` — with `UPDATE "ProductVariant" SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock`. Zero rows affected means oversell; abort the transaction. The current `Math.max(..., 0)` *hides* overselling rather than preventing it.
- Stop swallowing OrderItem insert failures (`:119-121` logs and continues, then returns 200).
- Fix `shippingAddress`: `:83-85` calls `JSON.stringify` before inserting into a **`jsonb`** column, storing a JSON *string scalar*. Any consumer doing `order.shippingAddress.city` gets `undefined`. Pass the object.
- Response semantics: 200 once committed, 200 for unhandled event types, 500 **only** for genuinely retryable failures.

### Checkout [x]

- Attach `client_reference_id` (the user's ID when authenticated) to the Stripe session. This is why the webhook currently has to reverse-look-up the user by email at `:62-71`.
- Pass a Stripe idempotency key.
- Fix duplicate cart lines: stock validation at `:60-64` checks each line independently, so `[{v,3},{v,3}]` against stock 5 passes both checks and sells 6. Aggregate by `variantId` first.
- `typeof variant.stock === "number"` means a `null` stock **skips validation entirely** and sells unlimited. Migration 0003's `CHECK` plus a `NOT NULL DEFAULT 0` closes this.

### Auth [x]

**Guest-order linking is the most serious flaw in the codebase.** `authController.js:46-60` claims every past guest order matching an email string, on nothing more than registration, with no verification. Anyone who knows a buyer's email can register with it and inherit that person's order history *and shipping addresses* via `GET /api/user/orders`.

Fix without needing email infrastructure: **replace automatic linking with an explicit claim.** `POST /api/user/orders/claim` taking a `stripeSessionId` — which only the actual buyer has, from their success-page URL. Cheap, no email sending, and it's a better design to defend than "we removed the feature."

Related: `GET /api/checkout/session/:sessionId` has **no authorization at all** — anyone with a `cs_...` id reads customer email, total, and full shipping address. Session IDs are high-entropy, so it's security-by-obscurity over an unauthenticated PII read. Return minimal fields (status, total, item count) to anonymous callers; full address only to the authenticated owner.

### Production hardening [x]

`helmet` · `express-rate-limit` on `/api/auth/login` (unlimited credential stuffing today — no lockout, no attempt counter) and on `/api/checkout` (unauthenticated, unthrottled, creates Stripe objects on every call) · centralized `(err, req, res, next)` error middleware · 404 handler · `trust proxy` · `CORS_ORIGINS` from env (`app.js:12-16` hardcodes origins including `http://localhost:5173`, so adding staging currently requires a code change).

**Do not touch the middleware order in `app.js`.** `express.raw()` at `:22` mounted before `express.json()` at `:24` is correct and load-bearing — any refactor that hoists a global body parser breaks Stripe signature verification.

### Operational readiness [x]

- **Graceful shutdown** in `server.js` — SIGTERM → `server.close()` → `pool.end()`. There is none today.
- **Structured logging** — `pino` + `pino-http` with request IDs, replacing ~20 bare `console.log`/`console.error` sites. Needed before CloudWatch is useful.
- **Split the health check** — keep `/api/status` as liveness (it reports healthy while the database is unreachable, which is correct for liveness), add `/api/ready` that pings the DB. The distinction matters in Phase 6: a readiness check that fails on a DB blip takes down a service that could still serve cached reads.

### What Phase 3 actually turned up

**The oversell response is a design decision the plan left open.** "Abort the transaction" says what to do with the data, not what to tell Stripe. A shortage is *deterministic* — replaying the event hits the same wall — so 500 would put Stripe into a retry loop against a fact that will not change. It answers 200 and logs `checkout.oversell` at error level with the session and variant, which is what Phase 7's alarm matches on. The honest caveat: the customer has been charged and nothing was recorded, so this needs a human and a refund. A production system would refund automatically; saying so is better than pretending the rollback finished the job.

**The idempotency key belongs to the client, not the server.** Deriving one server-side from the cart contents cannot distinguish a double-submit from a customer deliberately buying the same thing twice, and would silently hand the second buyer the first session. `POST /api/checkout` accepts an optional `idempotencyKey` and generates one when absent — correct use of the Stripe API either way, with real deduplication available to a frontend that opts in. **Frontend follow-up:** `App.jsx` should generate a key per checkout attempt and reuse it across retries.

**pino's default error serializer is unusable with node-postgres.** It walks an error's own enumerable properties, and a `DatabaseError` carries the entire `Client` — connection parameters, the full type table. One connection blip logged several kilobytes on a single line. `lib/logger.js` uses a bounded serializer keeping type, message, stack, `code`, `constraint`, `detail`, `severity`, `status`. Verified: the same event now logs 392 characters. At CloudWatch's per-GB ingest this is the difference between a log and a bill.

**supertest cannot send a raw body the obvious way.** `.send(Buffer.from(payload))` with a JSON content type makes superagent serialise the *Buffer object* — the handler receives `{"type":"Buffer","data":[...]}` and every signature check fails. `.send(payloadString)` transmits the exact bytes. This is a trap for Phase 4's webhook fixtures, and it looks exactly like a broken signature implementation when you hit it.

**Deliberately not done:** the checkout stock check is left in place as an advisory fast-fail for the customer, but it is no longer load-bearing — the conditional decrement in the webhook is the authority, because stock can change between checkout and payment.

---

# Phase 4 — Integration + E2E Against Real Dependencies [~]

*Roadmap #5.* Where the depth actually lives.

### Integration suite [x]

Postgres as a GitHub Actions **service container**; run migrations, then supertest against a real database. Test isolation by `TRUNCATE ... RESTART IDENTITY CASCADE` in `beforeEach` with a single fork — simpler than per-worker schemas and fast enough at this size; revisit if the suite grows.

Delivered as a second Vitest project (`vitest.integration.config.mjs`, `npm run test:integration`) so `npm test` stays database-free and fast. 49 tests across four files, plus a `test-integration` CI job on its own `dejavu_test` database. `globalSetup` applies the same migrations the app ships and refuses to run against any host that is not local — the suite truncates every table, so pointing `DATABASE_URL` at something real should fail loudly rather than quietly.

### Webhook fixtures

Sign fixture payloads with `stripe.webhooks.generateTestHeaderString` against a test secret, so `constructEvent` runs for real with no network. The tests that matter:

- **Replay:** same `checkout.session.completed` three times → exactly one Order, N OrderItems, stock decremented exactly once.
- **Concurrent replay:** two deliveries via `Promise.all` → same assertions.
- **Oversell:** stock = 1, two concurrent checkout+webhook flows → one succeeds, one fails cleanly, stock never goes negative.
- **Missing email:** session with no `customer_details.email` → order recorded, no 500, no infinite Stripe retry.
- **Out-of-order:** `payment_intent.succeeded` arriving before `checkout.session.completed` → handled, no duplicate.
- **Partial failure:** kill the transaction mid-flight → nothing committed, retry succeeds.

### E2E [deferred]

**Not built.** Playwright is a browser dependency, a compose stack in CI, and the slowest and flakiest job in the repo, and the integration suite already carries the claims worth defending. Deferred as an explicit decision rather than an omission; the exit criterion below is met without it.

Playwright over the compose stack: browse → cart → checkout → webhook → order visible in admin. Traces and screenshots uploaded as artifacts on failure.

**Keep the Stripe-hosted-checkout leg in a separate non-blocking job.** Driving Stripe's hosted page with test card `4242...` is inherently flaky and a flaky required check trains you to ignore CI. The blocking E2E job stubs the redirect; the full-path job runs alongside and reports.

### What Phase 4 actually turned up

**A concurrency test that is not concurrent proves nothing, and looks identical to one that is.** The obvious shape — fire two deliveries with `Promise.all`, assert one order — passes against an implementation with *no concurrency control at all*, because each transaction finishes before the next one opens. This was not a guess: replacing the `ON CONFLICT` claim with the read-then-write it replaced left all fifteen webhook tests green.

Two things fixed it. A barrier in the Stripe stub holds every delivery until all of them have arrived, so the transactions are genuinely open at once. And the guarantees are pinned properly in `concurrency.test.js`, which drives two explicit connections and commits the first only once the second is provably blocked on its lock. **Both are verified by mutation:** reverting the event claim to read-then-write fails exactly the two idempotency tests, and reverting the atomic decrement to read-modify-write fails exactly the seven stock tests. A suite that has never been run against broken code is a guess.

**`pool.js` is a module singleton and `singleFork` shares it across files.** `pool.end()` in one file's `afterAll` handed the next file a closed pool — a connection error in whichever file happened to run second, pointing at innocent code. Vitest tears the worker down itself, so nothing ends the pool.

**A failing test can poison the next one.** `client.release()` does not roll back, so a test that fails mid-transaction returns its connection to the pool still inside an aborted transaction, and the next borrower dies with "current transaction is aborted" — one real failure reported as two. The helpers roll back before releasing.

**Exit criteria [x]:** idempotency and no-oversell are proven by tests, not by argument.

*49 integration tests, green from a fresh database through the same seven migrations CI runs, gated in CI on every PR. Both correctness claims are mutation-verified rather than merely asserted.*

---

# Phase 5 — Terraform + GitHub OIDC + Secrets Manager [x]

*Roadmap #3. Highest-signal item on the list.*

**Set an AWS Budgets alarm at $5 before provisioning anything.** Now part of the
Terraform itself (`modules/budget`), so it cannot be forgotten.

- **Modules built in this phase:** `iam-oidc` · `secrets` · `budget`. The
  `network`, `rds`, `lambda` and `observability` modules belong to Phase 6 and
  are deliberately absent — there is nothing for them to describe yet.
- **State:** S3 backend, **no DynamoDB table.** Terraform 1.10 added S3-native
  locking via `use_lockfile = true` and 1.11 deprecated `dynamodb_table`; the
  table is now a resource to babysit for no benefit. Bootstrapped in
  `terraform/bootstrap/` with local state, then `init -migrate-state`.
- **Environments:** `envs/dev` and `envs/prod`, separate state keys, partial
  backend config so the account id stays out of a public repo.
- **OIDC trust policy** conditioned on `aud = sts.amazonaws.com` **and**
  `sub = repo:Ayprusss/dejavu:environment:production` — scoped to the
  *environment*, not `ref:refs/heads/main`. No static AWS access keys anywhere.
- **Two roles:** a read-only plan role for PRs, a narrow apply role gated behind
  the protected `production` environment.

### Three decisions the plan did not originally make

**The CI roles live in `bootstrap/`, not in `envs/`.** If the apply role could
manage IAM it could edit its own trust policy, and "narrow apply role" would be
decoration. Bootstrap is applied by a human with admin credentials; CI cannot
change the shape of its own access. The apply role additionally carries an
explicit `Deny` on `iam:*`, which beats every `Allow` in IAM evaluation and so
acts as a ceiling rather than a suggestion.

**The Secrets Manager / Parameter Store split is deferred to Phase 6, and
Phase 5 ships entirely on Parameter Store at $0.** The split is still the
intent, but its whole justification is Secrets Manager's native RDS integration
and managed rotation — and neither exists until there is an RDS instance.
Paying $0.40/month now to hold a credential for a database that does not exist
buys a line item and nothing else. Phase 6 moves exactly one secret, the RDS
master credential, into Secrets Manager: the only one whose rotation story gets
used. This keeps "everything through Phase 5 costs $0" true.

**Terraform declares which secrets exist; it does not own their values.** Each
parameter is created with a placeholder and `ignore_changes = [value]`, and the
real value is written with `aws ssm put-parameter --overwrite`. The honest
caveat is recorded in `terraform/README.md`: `refresh` reads SecureString values
back, so they do land in state, which is why the state bucket is encrypted,
versioned, TLS-only and readable by two roles. The provider's write-only
`value_wo` argument is the clean fix and the documented upgrade path.

### The dependency that is easy to miss

GitHub **environment protection rules are free on public repositories and paid
on private ones.** If this repo ever goes private on a Free plan, the rules stop
applying — but GitHub still stamps `environment:production` into the token, so
the trust policy still matches and the apply role becomes assumable from any
workflow run that merely names the environment. The control fails open,
silently, while the Terraform still reads as though it were enforced. Staying
public is therefore a *security* decision, not just a billing one.

Related: `terraform plan` on a PR **cannot work from a fork** — GitHub does not
grant `id-token: write` to fork workflow runs, by design. That is the control
working. Reaching for `pull_request_target` to "fix" it would hand a fork the
credentials.

**Exit criteria:** `terraform plan` runs on a PR with no AWS keys in the repo;
the role cannot be assumed from a fork; `terraform destroy` returns the account
to zero.

---

# Phase 6 — RDS + Lambda Web Adapter [x]

*Roadmap #2's AWS half and #4, adapted to the Lambda choice.* Applied to dev
only (prod is Phase 7). The step-by-step record, with every measurement, is
`phase-6-steps.md`; the runbooks are in `terraform/README.md`.

### The NAT decision — resolve this first

VPC-attached Lambda has no internet route, and this backend calls the Stripe API on every checkout.

| Option | Cost | Trade-off |
|---|---|---|
| NAT Gateway | ~$33/mo | Defeats the entire reason for choosing Lambda over Fargate. |
| **NAT instance (t4g.nano)** | **~$3.50/mo** | Single-AZ SPOF, self-managed. **Recommended.** *(Built as `t4g.micro`, because `t4g.nano` isn't free-tier eligible on this account, and the public IPv4 adds $3.65: ~$10/mo at list price.)* |
| Public RDS, SG-locked | $0 | Guts the private-subnet story that roadmap #2's depth rests on. |

Take the NAT instance. "I chose a NAT instance over a NAT gateway because at my traffic the gateway's hourly charge dominated the bill, and I accepted a single-AZ failure mode I can articulate" is a *better* interview answer than either alternative.

### Two Lambda-specific risks

**Raw body integrity through the adapter — the single biggest risk in the Lambda path.** Stripe signature verification requires the exact raw bytes. Lambda Function URLs base64-encode bodies for some content types and the Web Adapter decodes them; a byte-for-byte mismatch fails `constructEvent`. **Verify this end-to-end in dev before committing to the path**, and keep Fargate + ALB as the documented fallback if it can't be made reliable.

**Native `bcrypt`.** The current image is `node:20-alpine` (musl); Lambda runs glibc on AL2023. Switch to **`bcryptjs`** — pure JS, no native build, no architecture mismatch, small and measurable performance cost. Honest and portable beats clever here. *(Corrected in Phase 6: for a container image the musl/glibc point doesn't apply, because Lambda runs the image's own userland. The real risk is CPU architecture, x86 build vs arm64 function. `bcryptjs` is still right, for that reason. Measured cost: ~513 ms per login at 512 MB.)*

**Outcome:** the raw-body risk did not materialize. A real `stripe trigger` through Function URL → adapter → `express.raw` verified first time, a one-byte tamper returned 400, and a replay was deduplicated. Fargate stays an unused fallback.

### Build

Base image `public.ecr.aws/lambda/nodejs:22` (or `node:22-bookworm-slim` + the adapter layer), `COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter`. Non-root user, `NODE_ENV=production`, `.dockerignore` excluding `.env`. ECR with a lifecycle policy; **images tagged by git SHA, never deployed by `latest`** — `latest` is a mutable pointer, so a rollback target that means "whatever was pushed most recently" is not a rollback target. Trivy failing the build on HIGH/CRITICAL. Buildx with GHA layer caching.

Adapter config: `AWS_LWA_PORT=5000`, `AWS_LWA_READINESS_CHECK_PATH=/api/status`, `AWS_LWA_INVOKE_MODE=buffered`.

### Runtime

- **Connection pooling:** `pg.Pool({ max: 1 })` per execution environment. At zero traffic this is the correct answer, and it's the honest one — the failure mode is concurrency × pool size exceeding `max_connections`, and RDS Proxy is the fix *if that ever becomes a real problem*.
- **No provisioned concurrency.** It costs money to solve a latency problem you don't have. Measure the cold start and be able to quote it.
- `db.t4g.micro` in a private subnet; SG allows 5432 **only from the Lambda SG** — security-group referencing rather than CIDR, because the CIDR is a static assertion about an address range while the SG reference follows the workload.
- Automated backups with PITR — and **actually perform a restore once**, writing down the steps. An untested backup is a hypothesis.
- CloudWatch log group with 14-day retention; `/api/version` endpoint returning the git SHA baked in at build time.

### Frontend

Stays on **Vercel** — the roadmap already cut CloudFront, and Vercel does that job for free. CI adds a build check only. Note `VITE_API_URL` is inlined at build time, so the frontend artifact is environment-specific.

### What Phase 6 actually turned up

Kept only what bit. The full list of eleven pre-build corrections, and how
each played out, is in `phase-6-steps.md`.

**IAM, found against real `AccessDenied`s, not predicted.** The Phase 5 apply
role's blanket `Deny iam:*` blocked creating a Lambda at all (a function
needs `iam:PassRole` on its execution role). It was narrowed to read plus
PassRole on exactly one bootstrap-owned role. The first real apply then took
**eight** dispatches. EC2 create calls authorize against the new resource
*and* the existing parent VPC. `RunInstances` checks the auto-created network
interface and the AMI, which never carry the project tag. The provider reads
tags back on budgets, RDS, logs and ECR, so it needs the matching
`ListTags*` permissions. One of those had been removed as "drift" in the
bootstrap apply; it was load-bearing.

**The account constrained the design.** It's on the AWS Free plan: RDS
backup retention 7 was refused (dev runs at 1, which still allows PITR),
`t4g.nano` isn't eligible (NAT is `t4g.micro`), and Lambda concurrency is
capped at 10 account-wide, so no reserved concurrency can be set at all.

**Build and network.** buildx's default provenance attestations produce an
image index that Lambda's `CreateFunction` rejects, so every push uses
`--provenance=false --sbom=false`. Both base images failed Trivy on npm's own
bundled dependencies; npm is deleted from the runtime stages, since nothing
calls it. AL2023's `iptables-services` ships a `FORWARD -j REJECT`, so the
NAT forwarded nothing until two `ACCEPT` rules went in ahead of it. That was
diagnosed with a temporary instance profile, which was removed afterwards.

**Rate limiting on the Function URL.** The adapter passes a client's
`X-Forwarded-For` through unmodified, so *no* `trust proxy` value is safe.
Proven by experiment: a spoofed header replaced the real IP entirely. The
limiters now key on `x-amzn-request-context`'s `sourceIp`, which AWS sets and
a caller can't override, collapsed to `/56` for IPv6. Verified live: 10× 401
then 429, still 429 with forged headers.

**Rotation and restore, exercised rather than assumed.** A real
`rotate-secret`: open connections survive; a warm environment that
reconnects with a cached old password takes exactly one `28P01` and recovers
on the next request. PITR restore to a new instance took **37 min 43 s**
(22 min of that a post-restore backup). The copy needed no credential change
because the password lives in the data, and it sits outside Terraform state.

**Destroy and re-apply.** The destroy took **20 min 23 s**, nearly all of it
Hyperplane ENI release. Zero to a verified webhook took **~13 min**. The
Function URL changes on every re-create, so the Stripe endpoint and Vercel's
`VITE_API_URL` follow it. A plain destroy would have taken the SSM secrets
with it; `prevent_destroy` plus a targeted destroy prevents that. The re-apply
also exposed that the migrator never had `FRONTEND_URL`, so every seed had
written image URLs that 404.

**Measured:** cold start p50 ≈1.16 s (SSM fetch ≈0.22 s of it); login
(`bcryptjs`) p50 ≈513 ms at 512 MB, ≈332 ms at 1024 MB for ~29% more
GB-seconds.

### What I'd do differently

- **A least-privilege `dejavu_app` database role**, created by a migration,
  instead of connecting as the RDS master user (D8). IAM database
  authentication would remove the password entirely.
- **A stable hostname in front of the Function URL.** Every re-create
  changes the URL and breaks Stripe and the frontend until both are updated.
  The same CloudFront would also allow WAF rate limiting.
- **A shared rate-limit store** (or WAF). The in-memory limiter is per
  execution environment, so concurrency multiplies the budget.
- **Retry once on `28P01`** after `invalidate()`, so a rotation is invisible
  to callers rather than one failed request.
- **VPC endpoints for the AWS calls** (SSM, Secrets Manager) at ~$7/month
  per endpoint per AZ, about $29 for two AZs. That takes the NAT off the
  cold-start path. It can't remove the NAT, though: Stripe is on the public
  internet, so checkout still needs egress.
- **RDS Proxy** only if concurrency × `PG_POOL_MAX` approaches
  `max_connections`. Peak observed was 2.
- **IAM Identity Center instead of a static admin access key**, once AWS
  Organizations is worth enabling (6.0 deviation).
- **Split the SSM parameters into their own state** if a second or third
  environment makes a targeted destroy error-prone.

---

# Phase 7 — Dev (Staging) → Production CD with Rollback [~]

*Roadmap #6.* Code complete and merged (PR #28); **not yet run against
AWS.** The bootstrap apply, prod, the alarms' live checks and the checkpoint
drill are all still ahead, each tracked by a `needs-human` issue (#7, #9,
#10, #14–#20). The step-by-step record, with the ten decisions (D1–D10) and
twelve corrections, is `phase-7-steps.md`; what to type, and in what order,
is `phase-7-runbook.md`.

### The pipeline

- **Dev is staging (D1).** A third environment would cost another ~$25/month
  and prove nothing dev doesn't. Merge to `main` → CI → `deploy.yml`, fired
  by `workflow_run` and deploying the `head_sha` CI built (never
  `github.sha`) → migrate and deploy **dev (staging)** with no human. Prod
  gets the **same SHA** after a required reviewer on the protected
  `production` environment, and `promote-check.sh` resolves both
  environments' images to digests and fails if prod would run anything dev
  didn't (D4). While dev is destroyed its deploy is skipped, not failed, and
  prod never promotes off a skipped dev (D9).
- **Migrations run first, inside the VPC, through the migrator Lambda**
  (`migrate.sh`), so CI never needs a route to the private database.
  `aws lambda invoke` exits 0 when the handler throws, so the script fails
  on `FunctionError` rather than the exit code (correction 5), and it turns
  off the CLI's retry-on-timeout that would run a slow migration twice
  (correction 6).
- **Expand/contract is mandatory,** because migrations run before the new
  code and the previous release keeps running against the new schema for as
  long as a rollback might last. The rule and the three-deploy rename are in
  `backend/MIGRATIONS.md`. CI catches the accident, not the deliberate
  choice: an added migration with `DROP`, `RENAME`, `ALTER COLUMN ... TYPE`
  or `SET NOT NULL` fails without a `-- contract: <why>` line, and editing
  or deleting an existing migration fails outright. Verified by mutation.
- **Rollback via the `live` alias, from a pipeline script rather than
  CodeDeploy (D2).** The Function URL moves onto the alias, which creates a
  new URL (correction 1). `deploy.sh` records the previous version and
  refuses to deploy if that version's image has expired from ECR
  (correction 8), then publishes, shifts, smoke-tests, and on failure
  shifts back and smoke-tests the rollback too. It reverts code, not
  schema; expand/contract is what makes that safe. A published version
  freezes its environment, so a config-only Terraform apply is followed by
  a republish of the live SHA (correction 2), and Terraform and the deploy
  share one non-cancelling concurrency group per environment
  (correction 4).
- **Shift, then smoke-test the public URL (D3).** Three checks, hard ~15 s
  budget: `/api/status` 200, `/api/version` equal to the SHA just deployed,
  `GET /api/products` 200 with at least one item. Testing a candidate
  before the shift would need a second public URL, or would skip the URL →
  adapter path that 6.8 proved. The price is a window of ≤ ~10 s where a
  broken build is live, and a webhook that lands in it gets a retryable
  500. That window is the number 7.10 measures.
- **Alarms → one SNS email topic per environment (D10):** 5xx on the live
  alias, Lambda errors (api and migrator), throttles, and
  `checkout.oversell` plus failed checkouts through metric filters on the
  Phase 3 event keys. Every alarm has `ok_actions`, so the drill's inbox
  shows the rollback clearing it.
- **A deploy role per environment, separate from apply (D8).** It can touch
  two functions and read two ECR repos, nothing else. Both prod roles
  present the same OIDC subject, so the split is least privilege for
  mistakes, not a security boundary (correction 12).

### Prod shares nothing with dev (D5)

Separate VPC (`10.30.0.0/16`), NAT, RDS, SSM path, RDS secret, state key,
workload role, Stripe webhook endpoint and SNS topic. Shared: the account,
ECR (by design, so D4 can compare digests), and the account's 10-execution
Lambda concurrency ceiling, which a dev retry storm can use up for prod
(correction 10; D7 requests a quota increase and records the answer). Prod
runs Stripe **test mode** (D6), so the approval gate protects prod's data,
not real money. Prod's RDS has deletion protection and a final snapshot, and
its first admin comes from a `grant-admin` migrator action on an
already-registered user, because the seed truncates and refuses outside dev
(correction 9).

The cost answer: ~$50/month at list price with both environments up, and
prod doesn't run around the clock. It's up for the build-out and the
drills, then both go back to the ~$0.20 resting state ([Cost](#cost)).
*Considered and rejected:* a staging DB that only exists during a deploy
window, which would put ~13 minutes of RDS creation into every merge; and
prod reusing dev's VPC and NAT, which saves ~$10/month but turns "shares
nothing" into "shares its egress and its failure mode".

### What Phase 7 actually turned up

*So far, from building it and from auditing the docs against the live repo.
None of it comes from a run against AWS; the drill's numbers go here once
7.10 has run.*

**The Phase 1 gate had lapsed.** `main` had no branch protection and no
ruleset (issue #20), most likely since Phase 0's `git filter-repo`
force-push, so Verification row 1's tick had been false for most of the
project. It matters more now than it did in Phase 1: once `deploy.yml` is
on `main`, a direct push auto-deploys dev with nothing in front of it. Row 1
stays unticked until a failing-test PR is blocked again.

**The first real `deploy.yml` run was the merge, and it stopped at
credentials.** `workflow_dispatch` only works for a workflow already on the
default branch, and the `production` environment only accepts `main`, so
the pipeline couldn't be proven from `phase-7-cd` the way 6.7 proved the
first apply (issue #21). The PR #28 merge fired `deploy.yml` through
`workflow_run` as designed, and it went red at
`configure-aws-credentials`: `AWS_DEPLOY_ROLE_ARN_DEV` isn't set, because
the bootstrap apply that creates the deploy roles (runbook stage 2) hasn't
run. The same merge's `apply-dev` planned 15 to add, 2 to change and 2 to
destroy, then skipped its `terraform apply` step and finished green, so dev
is still on its Phase 6 shape and URL. That green-with-nothing-applied is
not yet diagnosed.

**An alias on `$LATEST` looks like a rollback target and isn't one.**
Terraform creates `live` pointing at `$LATEST`, because `publish = true`
would have published an unsmoked version on every config-only apply, and
every re-create puts it back there. `$LATEST` is the code about to be
overwritten, so `deploy.sh` first pins whatever it's running to a real
version and uses that as the rollback target.

**A README broke every migration run.** node-pg-migrate reads every file in
`backend/migrations/`, and the expand/contract write-up failed every run
with `Cannot determine numeric prefix for "README.md"`. The integration
suite found it on the combined branch; it's `backend/MIGRATIONS.md` now.
Reading the runner's source also settled what a half-failed deploy leaves
behind: one transaction per migration, not one for the run (the type
definitions' `@default true` notwithstanding), so the schema stops at
"every migration before the failing one" and is never partly applied.

**The weekly secret rotation can roll back a good deploy.** After a
rotation, a warm environment's next new connection fails with `28P01` and
`/api/products` returns 500, which fails smoke (issue #22). Smoke's retries
absorb it, because the `28P01` fails fast and the retry lands after
`invalidate()`. The deploy-script harness proves it: 30/30 cases against a
fake `aws`, mutation-tested. Retries can't cover a rotation still in
progress, so the drill checks `NextRotationDate` first.

**Teardown leaves two things behind.** The SNS subscription lives in each
environment's state, so every re-create brings it back as
`PendingConfirmation`, and alarms route nowhere until the email link is
clicked (issue #24; accepted, and on the re-create checklist with a command
that checks it). Prod's final RDS snapshot survives the destroy and bills,
up to ~$1.90/month, with no instance left to give it a free allowance
(issue #26; deleted once the teardown is verified).

**Two environments end the "$0 actually paid" story.** Measured on
2026-09-23, dev alone bills $0 under the free tier. The free tier's 750
instance-hours a month cover one instance around the clock, not two
(correction 11), so prod's hours draw down credits. See [Cost](#cost).

**Research stands in for four live checks.** Each of these came from AWS
docs or provider source, not a real call: a `NONE`-auth Function URL now
needs a second `lambda:InvokeFunction` statement conditioned on
`InvokedViaFunctionUrl`; the 5xx alarm's `Resource` dimension for a
qualified URL is `dejavu-<env>-api:live`; a container image under the Web
Adapter ships pino's JSON lines to CloudWatch unprefixed, so
`{ $.event = "..." }` matches them; and `function:<name>:*` in IAM matches
every qualified ARN and never the bare function, so the deploy role's
version pruning can't delete the function itself. `phase-7-steps.md` names
the live check owed for each one. An alarm on a metric that never exists is
silently green forever, so none of these counts as done until its check
has run.

**Exit criteria [ ]:** deploy a deliberately broken build → the smoke test
fails → the alias reverts on its own → an alarm emails ALARM and then OK,
with the exposure window measured (Verification row 7, 7.10). **Not run.**

*Verified so far, code only: CI green on the merge commit `61b9ee6`; 53
integration tests; the deploy-script harness at 30/30; shellcheck and
actionlint clean; the migration guard mutation-verified.*

---

## Verification

Each phase has a concrete gate:

| Phase | How to verify |
|---|---|
| 0 | **[x]** `git ls-files \| grep -c node_modules` → 0. App refuses to boot without `JWT_SECRET`. GitHub secret scanning shows no active alerts. |
| 1 | **[ ]** Open a PR with a deliberately failing test — merge is blocked. `npm test` green in both workspaces. *(The gate lapsed: `main` had no protection or ruleset as of 2026-09-23, issue #20. It's re-enabled and re-verified in `phase-7-runbook.md` stage 1b. Tick this when that's done.)* |
| 2 | **[x]** `docker compose up` → migrate → seed → browse the storefront end to end. `npm run migrate:down` unwinds cleanly. `grep -r supabase backend/src` → nothing. |
| 3 | **[x]** A replayed webhook produces exactly one order. *Met by other evidence, not by the local drill first written here (replay twice against local Postgres through a local `stripe listen`), which was never run:* Phase 4's `backend/tests/integration/webhook.test.js` ("processes one event exactly once across three deliveries" and "…across two concurrent deliveries"), signed with `generateTestHeaderString` and run against real Postgres in CI, and mutation-verified: reverting the event claim to read-then-write fails the idempotency tests. Then 6.8, against the real Function URL: a real `stripe trigger checkout.session.completed` → one `order.created`, and the captured payload re-signed and POSTed twice with the same event id → `webhook.duplicate` both times. |
| 4 | **[ ]** Idempotency, oversell, and out-of-order tests green in CI against a real Postgres service container: 53 integration tests across five files (Phase 4's 49, plus 4 for 7.9's `grant-admin`), with the idempotency and no-oversell claims mutation-verified (Phase 4). *Reworded: this row also asked for a Playwright trace artifact on a deliberate failure. Playwright was deferred (Phase 4, E2E), so that half is dropped rather than ticked, and 7.12's "Known limitations" carries the deferral. Left unticked until 7.12 re-runs `npm run test:all` on the final `main` and records the counts.* |
| 5 | **[x]** `terraform plan` runs on a PR with no AWS keys in the repo. Confirm the role cannot be assumed from a fork. |
| 6 | **[x]** Real Stripe webhook to the Function URL verifies its signature. Restore the database from PITR and document the steps. |
| 7 | Deploy a deliberately broken build → smoke test fails → alias auto-reverts → alarm fires. |

## Two honesty rules, carried forward

**Claim nothing the traffic doesn't support.** No "optimized for scale", no "high availability", no autoscaling. Every bullet in `dejavu-mvp-roadmap.md` claims correctness, reproducibility, or safety — all true at one user, all defensible under questioning.

**Have a "what I'd do differently" for each phase.** Specifically: SQS/EventBridge decoupling was considered and rejected (solves fulfillment throughput and retry durability, neither of which this system has — idempotency was the interesting part and it's in Phase 3); CloudFront was rejected (Vercel already does it, and edge latency at zero traffic is not a problem); Fargate was rejected in favour of Lambda on cost, with the raw-body risk in Phase 6 as the known trade-off. Deliberate omission beats unnecessary inclusion — but only if you can articulate it.

## Cost

List prices, us-east-1, per month, around the clock.

| Item | Dev (staging) | Prod |
|---|---|---|
| Phases 0–5 | **$0** — local, GitHub Actions (free on public repos), S3 state, IAM, SSM Parameter Store | — |
| `db.t4g.micro` RDS + 20 GB gp3 + backups | ~$14 | ~$14 |
| NAT instance `t4g.micro` + its public IPv4 + root volume | ~$10.50 | ~$10.50 |
| Secrets Manager (the RDS secret) | $0.40 | $0.40 |
| ECR storage (shared, both repos) | ~$0.20 | — |
| Lambda, CloudWatch Logs, alarms, SNS email | ~$0–1 at this traffic | ~$0–1 |
| **Total** | **~$25–26** | **~$25** |
| **Both up** | **~$50/month (~$1.65/day)** | |
| **Resting state:** both destroyed, bootstrap + ECR + SSM kept | **~$0.20/month**, assuming prod's final RDS snapshot is deleted after teardown (up to ~$1.90/month more if it's kept; issue #26) | |

**What this account actually pays, measured 2026-09-23:** $0 with one
environment up. Cost Explorer for 2026-09-01 to 2026-09-23, grouped by
service, shows every line at $0 (or a ~1e-8 rounding artifact), total
≈ −$0.00000012: the RDS, EC2 (NAT) and public-IPv4 hours are all covered by
the AWS Free plan's free tier. That's a six-day sample, not the 48 h first
planned, since dev has run continuously since the 6.12 re-create (RDS
`InstanceCreateTime` 2026-09-17T00:22Z). `freetier get-account-plan-state`
reports **$174.32** in credits remaining (higher than 6.12's $159.59) and
the plan expiring **2027-03-10T22:53:06Z**.

**With prod up, it's no longer free: prod draws credits.** The free tier's 750
instance-hours a month cover one `db.t4g.micro` around the clock, not two
(1,440 h), and the NAT and public-IPv4 hours double too. So prod's hours
draw down the credits instead. At ~$25 a month beyond the free tier,
$174.32 lasts about seven months, which is longer than the five and a half
left on the plan. The real limit is the expiry on 2027-03-10, not the
balance, and after it the list-price table is the bill. D5 keeps prod down
between drills in any case.

`terraform destroy` after a demo (~20 min), `apply` before an interview (~13
min to a verified webhook); the runbook is in `terraform/README.md`. The dev
budget alarms at $30, with a $40 account-wide backstop, because a $5 budget
watching the whole account would have fired on day one and been ignored
from then on. The same logic applies again with prod: both environments at
list price is ~$50, over the $40 backstop, so 7.8 either raises it or
records that it fires during the prod window.
