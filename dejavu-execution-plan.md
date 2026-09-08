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
| **F** | 5 — Terraform + OIDC + secrets | `plan` on PR with no AWS keys in the repo |
| **G** | 6 — RDS + Lambda deploy | Real Stripe webhook verifies against the Function URL |
| **H** | 7 — Staging → prod CD | Broken build auto-rolls back |

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

**3. Lambda-in-VPC + private RDS has a cost trap.** A VPC-attached Lambda has no route to the internet, and this backend calls the Stripe API on every checkout. A NAT Gateway is ~$33/mo — more than the Fargate you chose Lambda to avoid. Resolved in Phase 6 with a NAT instance (~$3.50/mo); flagged here because it changes the cost math behind the compute decision.

### Sequencing

```
Phase 0  Remediation & hygiene        BLOCKER      hours        [done]
Phase 1  Test harness + CI gate       roadmap #1   ~1 week      [done]
Phase 2  Postgres data layer          roadmap #2a  ~1-2 weeks   [done] <- largest single phase
Phase 3  Correctness fixes            roadmap #5a  ~1 week      [done]
Phase 4  Integration + E2E in CI      roadmap #5b  ~1 week      [integration done; E2E deferred]
-- CI/CD complete; everything above costs $0 --
Phase 5  Terraform + OIDC + secrets   roadmap #3   ~1 week
Phase 6  RDS + Lambda deploy          roadmap #2b/#4
Phase 7  Staging -> prod CD           roadmap #6
```

Phases 0–4 are specified in execution detail. Phases 5–7 are specified at decision level — the choices are made and justified, the implementation detail comes in a later pass once Phase 4 lands.

---

# Phase 0 — Remediation & Repo Hygiene

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

# Phase 5 — Terraform + GitHub OIDC + Secrets Manager

*Roadmap #3. Highest-signal item on the list.*

**Set an AWS Budgets alarm at $5 before provisioning anything.**

- **Modules:** `network` (VPC, 2 AZs, public + private subnets, NAT instance) · `rds` · `lambda` (ECR + function + Function URL) · `iam-oidc` · `secrets` · `observability`.
- **State:** S3 backend + DynamoDB locking. Bootstrap the state bucket in a small `bootstrap/` config with local state applied once, then migrate — the standard chicken-and-egg.
- **Environments:** separate `envs/dev` and `envs/prod` directories with separate state keys.
- **OIDC trust policy** conditioned on `aud = sts.amazonaws.com` **and** `sub = repo:Ayprusss/dejavu:environment:production` — scoped to the *environment*, not just `ref:refs/heads/main`. Scoping to the environment is what stops another repo, and a fork's PR, from assuming the role. No static AWS access keys anywhere.
- **Two roles:** a read-only plan role for PRs, a narrow apply role gated behind the protected `production` environment. Narrow beyond `lambda:*` to named resource ARNs.
- **Secrets split:** DB credentials in **Secrets Manager** (native RDS integration and managed rotation justify the $0.40/secret/month); `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in **SSM Parameter Store SecureString** (free tier, no rotation story to buy). Defending the split on the actual difference — rotation — is a better answer than picking one wholesale.
- `terraform plan` posted on PR; `apply` behind the protected environment.

---

# Phase 6 — RDS + Lambda Web Adapter

*Roadmap #2's AWS half and #4, adapted to the Lambda choice.*

### The NAT decision — resolve this first

VPC-attached Lambda has no internet route, and this backend calls the Stripe API on every checkout.

| Option | Cost | Trade-off |
|---|---|---|
| NAT Gateway | ~$33/mo | Defeats the entire reason for choosing Lambda over Fargate. |
| **NAT instance (t4g.nano)** | **~$3.50/mo** | Single-AZ SPOF, self-managed. **Recommended.** |
| Public RDS, SG-locked | $0 | Guts the private-subnet story that roadmap #2's depth rests on. |

Take the NAT instance. "I chose a NAT instance over a NAT gateway because at my traffic the gateway's hourly charge dominated the bill, and I accepted a single-AZ failure mode I can articulate" is a *better* interview answer than either alternative.

### Two Lambda-specific risks

**Raw body integrity through the adapter — the single biggest risk in the Lambda path.** Stripe signature verification requires the exact raw bytes. Lambda Function URLs base64-encode bodies for some content types and the Web Adapter decodes them; a byte-for-byte mismatch fails `constructEvent`. **Verify this end-to-end in dev before committing to the path**, and keep Fargate + ALB as the documented fallback if it can't be made reliable.

**Native `bcrypt`.** The current image is `node:20-alpine` (musl); Lambda runs glibc on AL2023. Switch to **`bcryptjs`** — pure JS, no native build, no architecture mismatch, small and measurable performance cost. Honest and portable beats clever here.

### Build

Base image `public.ecr.aws/lambda/nodejs:22` (or `node:22-bookworm-slim` + the adapter layer), `COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter`. Non-root user, `NODE_ENV=production`, `.dockerignore` excluding `.env`. ECR with a lifecycle policy; **images tagged by git SHA, never deployed by `latest`** — `latest` is a mutable pointer, so a rollback target that means "whatever was pushed most recently" is not a rollback target. Trivy failing the build on HIGH/CRITICAL. Buildx with GHA layer caching.

Adapter config: `AWS_LWA_PORT=5000`, `AWS_LWA_READINESS_CHECK_PATH=/api/status`, `AWS_LWA_INVOKE_MODE=buffered`.

### Runtime

- **Connection pooling:** `pg.Pool({ max: 1 })` per execution environment. At zero traffic this is the correct answer, and it's the honest one — the failure mode is concurrency × pool size exceeding `max_connections`, and RDS Proxy is the fix *if that ever becomes a real problem*.
- **No provisioned concurrency.** It costs money to solve a latency problem you don't have. Measure the cold start and be able to quote it.
- `db.t4g.micro` in a private subnet; SG allows 5432 **only from the Lambda SG** — security-group referencing rather than CIDR, because the CIDR is a static assertion about an address range while the SG reference follows the workload.
- Automated backups with PITR — and **actually perform a restore once**, writing down the steps. An untested backup is a hypothesis.
- CloudWatch log group with 14-day retention; `/version` endpoint returning the git SHA baked in at build time.

### Frontend

Stays on **Vercel** — the roadmap already cut CloudFront, and Vercel does that job for free. CI adds a build check only. Note `VITE_API_URL` is inlined at build time, so the frontend artifact is environment-specific.

---

# Phase 7 — Staging → Production CD with Rollback

*Roadmap #6.*

- Merge to `main` → build, tag by SHA, push to ECR, auto-deploy to **dev**. Production requires manual approval on a protected environment.
- **Migrations run as an explicit pre-deploy step, via a dedicated migrator Lambda** invoked by the pipeline. This keeps migrations inside the VPC and avoids a bastion or an SSM tunnel from CI — the tidy answer to "how does CI reach a private database?"
- **Expand/contract is mandatory,** because migrations run *before* the new code. Old code is briefly running against the new schema, so every migration must be backward-compatible with the version currently deployed. Renaming a column is three deploys: add the new column and dual-write; backfill and switch reads; drop the old column.
- **Rollback via Lambda alias.** Publish a version, shift the alias, smoke-test, and on failure shift the alias back to the previous version. Note what this does *and does not* do: it reverts code, not schema. Expand/contract is what makes that safe — and it's why a contract migration should never ship in the same deploy as the code that stops using the column.
- **Smoke test,** under ~10 seconds: `/api/status` returns 200, `/version` matches the SHA just deployed, `GET /api/products` returns 200 with at least one item. Not more — a slow smoke test is a slow rollback, and rollback speed is the thing you're actually buying.
- **Alarms** → SNS email: 5xx rate, Lambda errors and throttles, failed-checkout count via a metric filter on the structured logs from Phase 3.
- **Staging shares nothing with production** — separate RDS instance, separate secrets, separate state. Decide and document what that costs; the cheap version is a staging DB that only exists during a deploy window.

---

## Verification

Each phase has a concrete gate:

| Phase | How to verify |
|---|---|
| 0 | **[x]** `git ls-files \| grep -c node_modules` → 0. App refuses to boot without `JWT_SECRET`. GitHub secret scanning shows no active alerts. |
| 1 | **[x]** Open a PR with a deliberately failing test — merge is blocked. `npm test` green in both workspaces. |
| 2 | **[x]** `docker compose up` → migrate → seed → browse the storefront end to end. `npm run migrate:down` unwinds cleanly. `grep -r supabase backend/src` → nothing. |
| 3 | Manually replay a webhook twice against local Postgres → one order. `stripe trigger checkout.session.completed` against a local `stripe listen`. |
| 4 | Idempotency, oversell, and out-of-order tests green in CI against a real Postgres service container. Playwright trace artifact on a deliberate failure. |
| 5 | `terraform plan` runs on a PR with no AWS keys in the repo. Confirm the role cannot be assumed from a fork. |
| 6 | Real Stripe webhook to the Function URL verifies its signature. Restore the database from PITR and document the steps. |
| 7 | Deploy a deliberately broken build → smoke test fails → alias auto-reverts → alarm fires. |

## Two honesty rules, carried forward

**Claim nothing the traffic doesn't support.** No "optimized for scale", no "high availability", no autoscaling. Every bullet in `dejavu-mvp-roadmap.md` claims correctness, reproducibility, or safety — all true at one user, all defensible under questioning.

**Have a "what I'd do differently" for each phase.** Specifically: SQS/EventBridge decoupling was considered and rejected (solves fulfillment throughput and retry durability, neither of which this system has — idempotency was the interesting part and it's in Phase 3); CloudFront was rejected (Vercel already does it, and edge latency at zero traffic is not a problem); Fargate was rejected in favour of Lambda on cost, with the raw-body risk in Phase 6 as the known trade-off. Deliberate omission beats unnecessary inclusion — but only if you can articulate it.

## Cost

| Item | Monthly |
|---|---|
| Phases 0–4 | **$0** — all local and GitHub Actions (free on public repos) |
| `db.t4g.micro` RDS | ~$12–15 (verify current free-tier terms; they changed in 2025) |
| NAT instance t4g.nano | ~$3.50 |
| Lambda + ECR + CloudWatch | ~$0–2 at this traffic |
| **Total once Phase 6 lands** | **~$16–20**, → ~$0 with `terraform destroy` between demos |

`terraform destroy` after a demo, `apply` before an interview. Budgets alarm at $5 as the backstop.
