# Phase 6 — RDS + Lambda Web Adapter

**Branch:** `phase-6-rds-lambda` · **Batch G** · roadmap #2b / #4

**Goal:** the backend runs as a container image on Lambda behind a Function
URL, talks to a private RDS Postgres through a security-group reference, reaches
Stripe through a NAT instance, and holds no secret in an environment variable
or a Terraform file.

**Checkpoint (from the execution plan):** a real Stripe webhook, delivered to
the Function URL, passes signature verification. Plus: the database has been
restored from PITR once and the steps are written down.

**This is the first phase that costs money** (~$22/month while dev is up; see
[Cost](#cost)). Everything up to step 6.5 is still $0.

---

## Status

| # | Workstream | Cost | Status |
|---|---|---|---|
| 6.0 | Verify Phase 5 is really applied | $0 | [x] |
| 6.1 | Decisions (below) signed off | $0 | [x] |
| 6.2 | App changes for Lambda (no AWS needed) | $0 | [x] |
| 6.3 | Container image, two targets | $0 | [x] |
| 6.4 | CI: image build + Trivy on every PR | $0 | [x] |
| 6.5 | Bootstrap additions (human-applied) | ~$0 | [x] |
| 6.6 | Terraform modules: network, rds, lambda, observability | $0 until applied | [x] |
| 6.7 | First deploy to dev | **billing starts** | [x] |
| 6.8 | **Raw-body gate:** real Stripe webhook verifies | | [x] |
| 6.9 | Runtime checks: proxy, cold start, bcryptjs, CORS | | [x] |
| 6.10 | Secret rotation actually exercised | | [x] |
| 6.11 | PITR restore drill, written down | | [x] |
| 6.12 | Destroy → re-apply drill, cost check | | [x] |
| 6.13 | Docs, execution plan, merge | | [~] docs done; merge pending |

---

## 6.0 — Verify Phase 5 is really applied

The execution plan still marks Phase 5 `[~]`. Confirm each of these before
anything below depends on it, then flip Phase 5 (and batch F) to `[x]`.

- [x] Bootstrap state lives in S3: `terraform/bootstrap/terraform.tfstate` is
      0 bytes locally (it is — consistent with a completed `-migrate-state`),
      and `terraform -chdir=terraform/bootstrap init -backend-config=...` shows
      no local state.
- [x] `envs/dev` applied: `aws ssm get-parameters-by-path --path /dejavu/dev/`
      lists the four parameters, and the budget exists.
- [x] GitHub variables set: `AWS_REGION`, `TF_STATE_BUCKET`, the four role
      ARNs; secret `BUDGET_ALERT_EMAIL`.
- [x] A PR touching `terraform/` has produced a plan comment (Phase 5 exit).
- [x] **Deviation accepted 2026-09-11:** staying on the static `admin-user`
      key instead of IAM Identity Center. `aws sts get-caller-identity`
      resolves to `arn:aws:iam::059317926288:user/admin-user`. Identity
      Center requires enabling AWS Organizations first
      (`aws sso-admin list-instances` returned no instances), which surfaced
      a paid-plan prompt during setup — declined for now. Revisit if this
      account ever needs multiple humans or a real "no long-lived creds"
      story; note it under 6.13's "what I'd do differently."
- [x] Stripe **test-mode** keys ready. Dev must never hold a live key.

---

## Corrections to the execution plan

Reading the code and the Phase 5 Terraform against the Phase 6 plan turned up
eleven things the plan doesn't account for. Each one is handled in a step
below. They're listed here so that none of them turns up halfway through an
apply.

1. **The apply role cannot create a Lambda.** `modules/iam-oidc` attaches an
   explicit `Deny iam:*` to the apply role. A Lambda needs an execution role
   and the caller needs `iam:PassRole` to attach it, and the Deny blocks both.
   The first RDS instance in an account also creates the
   `AWSServiceRoleForRDS` service-linked role (`iam:CreateServiceLinkedRole`),
   which is blocked too. → Step 6.5.

2. **RDS for PostgreSQL 16 enforces TLS, and this `pg` verifies certificates
   strictly.** `rds.force_ssl` defaults to `1` from PG 15 on. The installed
   `pg-connection-string` (2.14.0) treats `sslmode=require` as `verify-full`,
   so a plain `?sslmode=require` fails with "self-signed certificate in
   certificate chain": the RDS CA is not in Node's trust store. The image has
   to ship the RDS CA bundle and `pool.js` has to pass `ssl: { ca }`. → 6.2c.

3. **The RDS-managed master password rotates every 7 days by default.** If the
   password is read once at deploy time and put in an env var or a
   `DATABASE_URL`, a warm Lambda breaks when the rotation lands.
   node-postgres accepts `password` as an async function, so fetch it lazily
   with a short cache. → 6.2c, and it gets exercised in 6.10.

4. **`node-pg-migrate` 9 is ESM-only** (`"type": "module"`), and the backend
   is CommonJS. A migrator handler has to `await import('node-pg-migrate')`,
   not `require` it. → 6.2e.

5. **For a container image, the musl/glibc argument doesn't apply.** Lambda
   runs *your* image's userland, so native `bcrypt` built inside that image
   would work. The real portability risk is **CPU architecture**: an image
   built on an x86 runner won't run on an arm64 Lambda. `bcryptjs` is still
   the right call because it removes the native build entirely, but it's
   worth giving the correct reason in an interview. → 6.2a, D2.

6. **Public IPv4 is billed.** Since Feb 2024 every public IPv4 address costs
   $0.005/hr (~$3.65/mo), and that includes the NAT instance's. The NAT line
   is ~$7.40/mo, not $3.50. → [Cost](#cost).

7. **The $5 budgets fire immediately.** `modules/budget` has no cost filter,
   so the dev *and* prod budgets both watch the whole account, and a ~$22/mo
   run rate breaches both forecasts on day one. An alarm that always fires
   gets ignored, the same way a flaky CI check does. → 6.5.

8. **The rate limiters see one client.** Behind Function URL → Web Adapter →
   Express, the socket peer is `127.0.0.1` (the adapter). With
   `TRUST_PROXY=0`, every request on the internet shares one login bucket.
   Separately, the limiter is in-memory, so each Lambda execution environment
   keeps its own budget, and environments come and go. → 6.9.

9. **Merging this branch applies dev.** `terraform.yml` runs `apply-dev` on
   every push to `main` that touches `terraform/`. The merge starts billing,
   and it fails if no image exists in ECR yet, because a Lambda can't be
   created without one. → Ordering in 6.7.

10. **`terraform destroy` on a VPC Lambda is slow.** Lambda's Hyperplane ENIs
    take roughly 20–40 minutes to release after the function is deleted, and
    the subnets and security groups can't be deleted until they're gone. The
    "destroy between demos" loop needs to budget for that. → 6.12.

11. **The seed can't run as-is against a deployed database.** `scripts/seed.js`
    hardcodes `BASE_IMG_URL = 'http://localhost:5173/images/'` and truncates
    every table first. It also can't reach a private RDS from your laptop.
    → 6.2f.

---

## 6.1 — Decisions (recommendations; confirm or override)

All eight confirmed as recommended (signed off 2026-09-11, no overrides).

- [x] **D1 · NAT instance: your own AL2023 instance plus ~10 lines of
      `user_data`, not the community `fck-nat` AMI.** fck-nat is fine, but it
      puts a third-party AMI on the path that carries your Stripe traffic. A
      hand-written `ip_forward` + `MASQUERADE` script is something you can
      explain line by line. (The plan already settled NAT instance over NAT
      Gateway.)

- [x] **D2 · arm64 everywhere.** Lambda arm64 is ~20% cheaper per GB-second,
      and the NAT (t4g) and RDS (t4g) are Graviton already. Build natively on
      GitHub's free `ubuntu-24.04-arm` runners (free for public repos) instead
      of QEMU emulation, which is 5–10× slower.

- [x] **D3 · The Lambda execution role lives in `bootstrap/`, beside the CI
      roles.** This follows the same principle as Phase 5: CI can't change the
      shape of any access. The apply role's Deny is narrowed from `iam:*` to
      "everything except `PassRole` on exactly this role, plus read-only
      `Get*`/`List*` on it". *Considered and rejected:* letting CI create
      workload roles under a permissions boundary. That's the standard
      delegation pattern and it avoids a cross-config reference, but it gives
      CI `iam:CreateRole`, which is more to defend than one extra bootstrap
      apply per phase.

- [x] **D4 · Secrets are fetched by the process at cold start, not injected
      as Lambda environment variables.** Env vars written by Terraform would
      put every secret into state *and* into `lambda:GetFunctionConfiguration`,
      where any read-only principal can see them in plain text (the plan role
      has `ReadOnlyAccess`). Instead, a small entrypoint reads
      `/dejavu/<env>/*` from SSM before `config/env.js` loads, so `env.js`
      stays unchanged. The DB password is fetched lazily (correction 3).

- [x] **D5 · Terraform creates the function; it does not deploy code.**
      `aws_lambda_function` gets `lifecycle { ignore_changes = [image_uri] }`.
      Code ships with `aws lambda update-function-code --image-uri …:<sha>`.
      This saves Phase 7 from fighting Terraform over which image is live, and
      alias-based rollback needs exactly this split.

- [x] **D6 · Only dev is applied in Phase 6.** `envs/prod` stays as it is
      until Phase 7, which decides what staging and prod cost. Build the
      modules so prod is a copy-paste of the dev wiring.

- [x] **D7 · Build the migrator Lambda now, not in Phase 7.** RDS is private,
      so you can't migrate it from a laptop. The alternatives (SSM tunnel,
      temporarily public DB) are exactly what the design exists to avoid.
      Phase 7 then only has to invoke it from the pipeline.

- [x] **D8 · The app connects as the RDS master user, for now.** It's the
      honest shortcut. The right answer is a least-privilege `dejavu_app` role
      created by a migration. List it under "what I'd do differently", or do
      it in 6.2 if there's appetite.

---

## 6.2 — App changes for Lambda ($0, no AWS, all testable locally)

Land these first. Every one of them has to keep `docker compose up`, the unit
suite, and the integration suite green, because the local path must not change.

### 6.2a · `bcrypt` → `bcryptjs`

- [x] `npm uninstall bcrypt && npm install bcryptjs` (v3).
- [x] Swap the require at the three sites: `src/controllers/authController.js:1`,
      `scripts/seed.js:15`, `tests/integration/helpers.js:7` (and anything
      `grep -rn "require('bcrypt')"` finds later).
- [x] Prove that existing hashes still verify. **Before** uninstalling, generate
      a `$2b$` hash with native bcrypt and commit it as a fixture. Then add a
      unit test that `bcryptjs.compare` accepts it, so the claim is tested
      rather than assumed. — `tests/fixtures/bcryptHashes.js` + `tests/authHash.test.js`.
- [x] Note the cost. It gets measured for real in 6.9.

### 6.2b · Build identity: `GIT_SHA` and a version endpoint

- [x] `env.js`: optional `GIT_SHA`, default `'unknown'`.
- [x] `GET /api/version` → `{ sha: env.GIT_SHA }`. The plan says `/version`;
      every other route is under `/api`, so pick one path and use the same
      one in Phase 7's smoke test.
- [x] supertest case (`tests/version.test.js`). Also left out of pino-http
      auto-logging, like the health checks, because Phase 7's smoke test polls it.

### 6.2c · Database connection: discrete params, TLS, lazy password

- [x] `env.js`: require **either** `DATABASE_URL` (local, CI, tests; unchanged)
      **or** `DB_HOST` + `DB_NAME` + `DB_SECRET_ARN` (+ optional `DB_PORT`,
      `DB_SSL_CA_PATH`). Error if neither set is complete. Boot-check CI case
      for an incomplete `DB_*` set — `tests/envDbConfig.test.js`.
- [x] `src/db/credentials.js`: `getDbPassword()` reads the RDS-managed secret
      (`{ username, password }` JSON) through
      `@aws-sdk/client-secrets-manager`. Cache it for ~5 min, and export
      `invalidate()`.
- [x] `pool.js` (now via shared `src/db/connectionOptions.js`, reused by
      migrator.js too): when `DB_SECRET_ARN` is set, builds
      `{ host, port, database, user, password: getDbPassword, ssl: { ca } }`.
      `sslmode` never appears in a connection string alongside it — the two
      paths (`connectionString` vs discrete+`ssl`) are mutually exclusive.
- [x] On a connect error with code `28P01` (auth failed), calls `invalidate()`
      so the next connection re-fetches. Wraps `pool.query`/`pool.connect`
      directly, since `pool.on('error', ...)` only fires for an already-idle
      client, not a failed new-connection attempt (verified against
      pg-pool's source).
- [x] RDS CA bundle checked in at `backend/certs/rds-global-bundle.pem`
      (fetched live from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`).
- [x] Unit-tested cache and invalidation (`tests/dbCredentials.test.js`) with
      a stubbed SDK client — via direct `require.cache` injection, not
      `vi.mock`, because `vi.mock` only intercepts ESM `import`, not the
      `require()` this CommonJS codebase uses throughout (verified by
      experiment). Same technique in `tests/envDbConfig.test.js`.

### 6.2d · Secret loader entrypoint

- [x] `src/lambda.js`: if `SSM_PARAMETER_PATH` is set, calls
      `GetParametersByPath({ Path, WithDecryption: true, Recursive: false })`
      (paginated) and copies each `/dejavu/<env>/NAME` into `process.env.NAME`,
      without overwriting anything already set. Fetches the DB username from
      the `DB_SECRET_ARN` secret into `DB_USER`. Then `require('./server')`.
      If the variable is unset, just `require('./server')` — compose and
      local runs are unaffected.
- [x] Does not require `lib/logger` or `config/env.js` (verified by reading
      the file — only `@aws-sdk/client-ssm` and `@aws-sdk/client-secrets-manager`
      at the top). Boot failures logged as one plain JSON line to stderr,
      then `process.exit(1)`.
- [x] Measures the loader's own time and logs it (`boot.secrets_loaded`,
      `durationMs`).
- [x] Removed `DATABASE_URL` from the `parameters` map in `envs/dev/main.tf`
      (validated with `terraform validate`). Updated `.env.example`'s Phase 6
      comment to document both the `DATABASE_URL` and discrete `DB_*` paths.

### 6.2e · Migrator handler

- [x] `src/migrator.js`, a plain Lambda handler (not behind the adapter):
      `const { runner } = await import('node-pg-migrate')`, then runs `up`
      against `migrations/` with the **same `migrationsTable`** the CLI uses
      (`pgmigrations`, node-pg-migrate's own default) so local, CI and RDS
      share one history. Reuses `src/db/connectionOptions.js` from 6.2c
      (confirmed at the node-pg-migrate source level: `databaseUrl` as an
      object is passed straight to `new pg.Client(...)`, so the async
      `password` function works there too). Returns the list of applied names.
- [x] Accepts `{ "action": "up" }` (and, after 6.2f, `"seed"`) only.
      Anything else — including `"down"` — throws; a deployed database is
      never migrated backward by payload.
- [x] node-pg-migrate's advisory lock noted in a comment on `up()`.

### 6.2f · Seed for a deployed environment

- [x] Replaced the hardcoded `BASE_IMG_URL` with a `SEED_IMAGE_BASE_URL` (or
      `FRONTEND_URL`) derived default. Seed logic moved to `src/seed.js`
      (shared by the CLI and the migrator) since `scripts/` will be
      dockerignored from the migrator image in 6.3; `scripts/seed.js` is now
      a thin wrapper.
- [x] Exposed through the migrator as `{ "action": "seed" }`, refusing unless
      `DEPLOY_ENV === 'dev'` — unit-tested in `tests/migrator.test.js`
      (default DEPLOY_ENV in tests is unset, so the refusal is the tested
      default, not an opt-in). The local CLI script is intentionally **not**
      gated by `DEPLOY_ENV` — running `npm run seed` against your own
      `DATABASE_URL` is unchanged from before.

### 6.2g · Gate

- [x] `npm run lint && npm run test:all` green (80 unit + 49 integration,
      against real Postgres via `docker compose up -d db`). `docker compose up`
      (full stack) verified end to end: `/api/status`, `/api/ready`,
      `/api/version`, `/api/products`, and the frontend at `:5173` all served
      correctly; `npm run seed` re-verified through the refactored
      `scripts/seed.js` → `src/seed.js` path. Stack torn down after
      (`docker compose down`).

---

## 6.3 — Container image ($0)

Rewrite `backend/Dockerfile` as a multi-stage build with **two targets from
one dependency layer**:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- The API: plain Node web server + the Lambda Web Adapter as an extension
FROM node:22-bookworm-slim AS api
# Pin an exact adapter tag. Never :latest.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:<pinned> /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY certs ./certs
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER node
EXPOSE 5000
CMD ["node", "src/lambda.js"]

# --- The migrator: AWS base image, because it's a handler, not a server
FROM public.ecr.aws/lambda/nodejs:22 AS migrator
COPY --from=deps /app/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY src ${LAMBDA_TASK_ROOT}/src
COPY migrations ${LAMBDA_TASK_ROOT}/migrations
COPY certs ${LAMBDA_TASK_ROOT}/certs
CMD ["src/migrator.handler"]
```

- [x] Node 22 in the image to match `.nvmrc` (today's Dockerfile says 20).
- [x] Added `@aws-sdk/client-ssm` and `@aws-sdk/client-secrets-manager` as
      dependencies (already done in 6.2d/6.2c — `bookworm-slim` doesn't
      bundle the SDK the way the AWS base image does).
- [x] `.dockerignore`: added `tests/`, `coverage/`, `postman/`, `*.md`,
      `scripts/`, `eslint.config.mjs`, `vitest*.mjs`.
- [x] `docker-compose.yml`: `build: { context: ./backend, target: api }`.
      Reverified end to end after the switch: `docker compose up` (db +
      backend + frontend) serves `/api/status`, `/api/ready`, `/api/version`,
      `/api/products`, and the frontend — `src/lambda.js` correctly falls
      through to `server.js` with no SSM call logged, since
      `SSM_PARAMETER_PATH` is unset locally.
- [x] Filesystem stays read-only-safe: nothing in the app writes to disk
      (pino writes to stdout only) — unchanged by this step.
- [x] Local check: `docker buildx build --platform linux/arm64 --target api .`
      builds — **88 MB** (well under 250 MB). Confirmed `USER node` and
      `arm64` on the built image via `docker inspect`. Also built and
      **ran** the `migrator` target (not just built it): **143 MB**, verified
      live via the Lambda Runtime Interface Emulator against the local
      Postgres — `{"action":"up"}` correctly reported no pending migrations,
      `{"action":"down"}` was rejected, `{"action":"seed"}` was refused
      without `DEPLOY_ENV=dev` and succeeded (with `FRONTEND_URL`-derived
      image URLs, confirming 6.2f) once it was set. Local dev database
      reseeded with normal local values afterward; all test images/containers
      cleaned up.

Adapter environment (set on the function in 6.6, not in the image):
`AWS_LWA_PORT=5000`, `PORT=5000`, `AWS_LWA_READINESS_CHECK_PATH=/api/status`,
`AWS_LWA_INVOKE_MODE=buffered`. Readiness points at **liveness**, never at
`/api/ready`; a DB blip must not fail init.

---

## 6.4 — CI: image build + Trivy on every PR ($0)

New job(s) in `ci.yml` (or a new `image.yml`). **No AWS credentials** on PRs.

- [x] New `image` job in `ci.yml`, matrixed over `target: [api, migrator]`:
      `runs-on: ubuntu-24.04-arm`, `docker/setup-buildx-action@v4`,
      `docker/build-push-action@v7` with `cache-from/to: type=gha` (scoped per
      target) and `build-args: GIT_SHA=${{ github.sha }}`. Both targets build
      natively for `linux/arm64` and `load: true`.
- [x] Trivy (`aquasecurity/trivy-action`) on both images: `severity:
      HIGH,CRITICAL`, `exit-code: '1'`, `ignore-unfixed: true`,
      `trivyignores: backend/.trivyignore`. Verified the action's actual
      `action.yaml` at the pinned commit to confirm every input name.
- [x] **Pin third-party actions by commit SHA**, not tag, starting with the
      scanner: `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0`
      (resolved from the `v0.36.0` tag via the GitHub API, not guessed).
- [x] Added `image` to the `ci` aggregate gate's `needs`.
- [x] Push-to-ECR is **not** in this job — confirmed nothing ECR/login-related
      was introduced; that needs the push role from 6.5 and runs only on
      `main` (6.7).
- [x] Validated with `actionlint` (via Docker, since it's not installed
      locally) against the whole `.github/workflows/` directory — clean,
      exit 0.
- [x] **Found by actually running the scan locally before trusting the CI
      wiring, not anticipated in the plan:** both fresh images failed the
      gate the first time.
  - Both `node:22-bookworm-slim` (api) and the AWS Lambda Node.js base image
    (migrator) bundle npm's own CLI with vulnerable transitive deps (`tar`,
    `pacote`, `sigstore`, `path-to-regexp`, `brace-expansion`, `ip-address`,
    `picomatch` — 15 findings, 1 CRITICAL). Neither runtime image ever
    invokes `npm`/`npx` (deps are installed in the `deps` stage; the CMD is a
    plain `node` call or a Lambda handler), so both final stages now `rm -rf`
    npm and corepack — deletes the unreachable code rather than suppressing
    the finding, and shrinks the image as a side effect.
  - Two of our **own** production dependencies were carrying vulnerable
    transitives within their existing semver ranges: `express`'s `router`
    pinned `path-to-regexp@8.3.0` (fixed in 8.4.0, latest 8.4.2) and
    `node-pg-migrate`'s bundled `glob` pinned `minimatch@10.2.4` →
    `brace-expansion@5.0.4` (three HIGH CVEs, fixed by 5.0.9). A plain
    `npm update` (no `overrides` needed — both fixes were already inside the
    declared ranges) resolved both; reverified with `npm ls`, full unit +
    integration suites, and a rebuilt-image rescan (real exit code checked
    directly, not through a pipe to `tail`).
  - The migrator's AWS Lambda base image (Amazon Linux 2023) has a HIGH CVE
    in `openssl-fips-provider-latest`/`openssl-snapsafe-libs`
    (CVE-2026-14456) whose advertised fix isn't yet published to the
    `amazonlinux` dnf repo this base image points at — verified directly
    (`dnf update` reports "Nothing to do"), not assumed. Added
    `RUN dnf update -y openssl-fips-provider-latest openssl-snapsafe-libs`
    to the migrator stage anyway (self-heals the moment the fix ships, no
    further Dockerfile change needed) and added the one CVE to
    `backend/.trivyignore` with the verified reason and date, per this
    step's original guidance on CVEs with no reachable fix.
  - Both images reverified clean (`api`: exit 0 with no ignore file needed;
    `migrator`: exit 0 with the one dated `.trivyignore` entry), then the
    full local suite (lint, unit, integration, `docker compose up` end to
    end) re-run once more against the updated lockfile — all green.

---

## 6.5 — Bootstrap additions (human-applied with admin, ~$0)

All in `terraform/bootstrap/`, applied by you via SSO, never by CI. A new
`modules/workload-roles` keeps it tidy.

### ECR (account-level, shared by every environment)

- [x] `aws_ecr_repository "api"` and `"migrator"` (or one repo with suffixed
      tags): `image_tag_mutability = "IMMUTABLE"`, which makes "never
      overwrite a SHA tag" an AWS guarantee rather than a convention.
      `scan_on_push = true` (basic scanning is free).
- [x] Lifecycle policy: expire untagged after 1 day; keep the last ~15 tagged.
- [x] Repository policy allowing `lambda.amazonaws.com`
      `ecr:BatchGetImage` + `ecr:GetDownloadUrlForLayer`, conditioned on
      `aws:SourceArn` = `arn:aws:lambda:<region>:<acct>:function:dejavu-*`.
      Setting it here means the apply role never needs
      `ecr:SetRepositoryPolicy`.
- [x] Why ECR is in bootstrap: one image is promoted dev → prod by SHA in
      Phase 7, so the repo can't belong to either environment's state. —
      `modules/workload-roles`, instantiated once from `bootstrap/main.tf`.

### Push role

- [x] `dejavu-gha-push`: trusted for `repo:Ayprusss/dejavu:ref:refs/heads/main`
      only (PRs excluded). Its only permissions are `ecr:GetAuthorizationToken`
      (`*`) and push actions on the two repos. **Why a ref-scoped trust is
      acceptable here** when Phase 5 rejected it for apply: pushing an
      immutable, SHA-tagged image deploys nothing. The deploy is the gated
      step.

### Workload role (the Lambda execution role), per environment

- [x] `dejavu-dev-lambda`: trust `lambda.amazonaws.com`; attach
      `AWSLambdaVPCAccessExecutionRole` (ENI management + logs).
- [x] `ssm:GetParametersByPath` / `GetParameters` on
      `parameter/dejavu/dev` and `parameter/dejavu/dev/*`.
- [x] `secretsmanager:GetSecretValue` on `secret:rds!*`, conditioned on the
      secret's `aws:rds:primaryDBInstanceArn` tag equalling
      `arn:aws:rds:<region>:<acct>:db:dejavu-dev` via the
      `secretsmanager:ResourceTag/...` condition key (AWS's own documented
      pattern for scoping access to an RDS-managed secret). RDS-managed
      secret names are random, but the DB identifier is ours, so this scopes
      dev's role to dev's database without a cross-config reference.
      **Still to verify the exact tag key on the created secret in 6.7**,
      once RDS actually exists, and fix the condition if it differs.
- [x] One role serves both the API and the migrator in Phase 6. Splitting it
      is a note for Phase 7.

### RDS service-linked role

- [x] `aws iam get-role --role-name AWSServiceRoleForRDS` came back
      `NoSuchEntity`, so added `aws_iam_service_linked_role { aws_service_name
      = "rds.amazonaws.com" }` (no import needed) — created by the bootstrap
      apply.

### Widen the apply role (dev), and narrow its Deny

In `modules/iam-oidc`, gated behind a new `enable_workload_infrastructure`
flag so prod's apply role stays at its Phase 5 shape until Phase 7 (D6):

- [x] Rewrote `apply_boundary_deny` so that `iam:PassRole` + `iam:GetRole` on
      the workload role ARN survive, and **everything else in IAM is still
      denied**. IAM can't subtract actions inside one statement, so it's two
      Denies: (1) `iam:*` with `not_resources = [workload role ARN]`;
      (2) every mutating action (`iam:Create*`, `Delete*`, `Put*`, `Attach*`,
      `Detach*`, `Update*`, `Tag*`, `Untag*`) on the workload role ARN itself.
      The net effect is read + PassRole on one role, and nothing else. Added a
      `Condition iam:PassedToService = lambda.amazonaws.com` on the PassRole
      Allow (kept `GetRole` as its own unconditioned statement, since a
      condition on a context key that only exists for `PassRole` calls would
      otherwise deny `GetRole` outright).
- [x] Added Allows, scoped by region and by name prefix or tag wherever the
      service supports it:
  - **EC2/VPC:** create with `aws:RequestTag/Project = dejavu`, modify and
    delete with `aws:ResourceTag/Project = dejavu`; `Describe*` on `*`.
    **Expect to iterate** on the exact action list against real
    AccessDenied errors in 6.7.
  - **RDS:** instance, subnet group and parameter group on
    `…:db:dejavu-*`, `…:subgrp:dejavu-*`, `…:pg:dejavu-*`; `Describe*`.
    Included `RestoreDBInstanceToPointInTime` for 6.11's drill.
  - **Secrets Manager (for the RDS-managed secret):** `CreateSecret`,
    `TagResource`, `RotateSecret`, `DescribeSecret`, `DeleteSecret` on
    `secret:rds!*`.
  - **Lambda:** function + function URL + permission + concurrency on
    `function:dejavu-*`.
  - **ECR:** `BatchGetImage`, `GetDownloadUrlForLayer`, `DescribeImages` on
    the two repos.
  - **Logs:** create, delete, retention and tags on
    `log-group:/aws/lambda/dejavu-*` (plus `DescribeLogGroups` on `*`, a list
    call).
  - **SSM public AMI parameter:**
    `ssm:GetParameter` on `arn:aws:ssm:<region>::parameter/aws/service/*`
    (the apply role only has `/dejavu/<env>/*` today).
  - Validated with a real `terraform plan` (14 to add, 3 to change, 0 to
    destroy) and applied against the live account — no `AccessDenied`
    surfaced yet because nothing has exercised these grants; that happens in
    6.6/6.7.
- [ ] After the first successful dev *environment* apply (6.7, not this
      bootstrap apply), trim the policy with **IAM Access Analyzer policy
      generation** from CloudTrail and record the before and after sizes.

### Budgets

- [x] Activated the `Environment` cost-allocation tag via
      `aws_ce_cost_allocation_tag` (in `bootstrap/main.tf`) instead of a
      manual console click — same 24h/non-retroactive AWS behavior, just
      applied by Terraform instead of by hand.
- [x] `modules/budget`: added a `cost_filter` on `user:Environment$<env>`;
      dev raised to $30 (`envs/dev/terraform.tfvars`), prod left at $5. Added
      one **account-wide** backstop budget at $40
      (`module.budget_backstop` in bootstrap, `cost_filter_enabled = false`),
      because some charges (parts of data transfer, public IPv4) don't carry
      the tag.

### Outputs → GitHub variables

- [x] `AWS_PUSH_ROLE_ARN`, `ECR_API_REPO`, `ECR_MIGRATOR_REPO`, and
      `AWS_WORKLOAD_ROLE_ARN_DEV` set as GitHub repo variables via `gh
      variable set`, sourced from the applied bootstrap outputs.

### Applied

- [x] `terraform apply` run against the live account (admin credentials,
      same account as the 6.0 deviation note): **14 added, 3 changed, 0
      destroyed**. A follow-up `terraform plan` shows no changes.
- **Correction, found in 6.7:** at the time, this plan's removal of
  `budgets:TagResource`/`UntagResource`/`ListTagsForResource` from
  `ManageBudgets` (present in deployed state, absent from `main.tf`, `git
  diff` showed this step never touched that statement) was logged above as
  unrelated pre-existing drift, safe to leave for later. It was not drift -
  it was load-bearing: `aws_budgets_budget` picks up the provider's
  `default_tags`, and the AWS provider needs exactly those three actions to
  reconcile them. Removing them broke the real dev apply with `AccessDenied:
  ... budgets:ListTagsForResource ...` in 6.7 step 3. Fixed there by adding
  the three actions back to `modules/iam-oidc`'s `ManageBudgets` statement,
  with a comment on the statement explaining why they're required.

---

## 6.6 — Terraform modules ($0 until applied)

New modules, wired into **`envs/dev` only** (D6). `terraform fmt` and
`validate` stay green in the existing workflow.

### `modules/network`

- [x] VPC `10.20.0.0/16`, DNS support and hostnames on.
- [x] One public subnet (AZ a) for the NAT; **two private subnets (AZ a + b)**
      — picked dynamically via `data "aws_availability_zones"` rather than
      hardcoded `a`/`b` suffixes, so the module isn't region-specific.
      An RDS subnet group requires two AZs even for a single-AZ instance.
- [x] IGW; public route table `0.0.0.0/0 → igw`; private route table
      `0.0.0.0/0 → network_interface_id = NAT's primary ENI`.
- [x] NAT instance: `t4g.nano`, AL2023 arm64 from the SSM public parameter
      (name verified live: `/aws/service/ami-amazon-linux-latest/al2023-ami-
      kernel-default-arm64` — a Git-Bash path-mangling red herring on the
      first lookup attempt, confirmed correct once queried properly),
      **`lifecycle { ignore_changes = [ami] }`**, `source_dest_check = false`,
      `metadata_options { http_tokens = "required" }`, no key pair, no SSH, no
      instance profile, `associate_public_ip_address = true` (auto-assigned,
      not an EIP).
- [x] `user_data`: install `iptables-services`, `net.ipv4.ip_forward=1`
      persistently, MASQUERADE rule on the interface `ip route | awk
      '/^default/ {print $5; exit}'` resolves to at boot.
- [x] SGs: `lambda`/`rds`/`nat` as three bare `aws_security_group` resources
      with rules as separate `aws_vpc_security_group_{ingress,egress}_rule`
      resources (not inline blocks) — lambda and rds reference each other's
      SG id, and an inline block on both sides would be a dependency cycle.
- [x] **No interface VPC endpoints** — noted in the module's header comment,
      with the cold-start-path consequence spelled out.
- [x] NAT SPOF note added as a comment; nothing to configure (simplified
      automatic recovery is an account-level default).

### `modules/rds`

- [x] `postgres`, major `16`, `auto_minor_version_upgrade = true`,
      `db.t4g.micro`, 20 GB `gp3`, `storage_encrypted = true`,
      `publicly_accessible = false`, `multi_az = false`, identifier
      `dejavu-dev` (matches 6.5's secret condition).
- [x] `manage_master_user_password = true` (D8's master-username: chose
      `dejavu_admin`, distinct from the future least-privilege `dejavu_app`
      role D8 notes for "what I'd do differently").
- [x] `backup_retention_period = 7`, fixed backup/maintenance windows,
      `copy_tags_to_snapshot = true`.
- [x] Dev: `deletion_protection = false`, `skip_final_snapshot = true`,
      `apply_immediately = true`, all three parameterized (no defaults) so
      prod can't inherit dev's values by omission.
- [x] Parameter group `dejavu-dev-pg16` with `rds.force_ssl = 1`
      (`apply_method = "pending-reboot"`, the safe choice regardless of
      whether the parameter is static or dynamic).
- [x] Outputs: `address`, `port`, `db_name`, `master_user_secret_arn`
      (its description flags the 6.7-step-5 tag verification).

### `modules/lambda`

- [x] `aws_lambda_function "api"`: `package_type = "Image"`,
      `architectures = ["arm64"]`, `image_uri` built from a required
      `var.initial_image_tag` (no default — must be supplied at the first
      apply, 6.7 step 2), **`ignore_changes = [image_uri]`** (D5),
      `memory_size = 512`, `timeout = 15`, `vpc_config` on both private
      subnets and the `lambda` SG, execution role looked up by name
      (`data "aws_iam_role" "dejavu-dev-lambda"`) rather than plumbed through
      bootstrap outputs.
- [x] Environment: `NODE_ENV=production`, `DEPLOY_ENV=dev`, `PORT` and
      `AWS_LWA_*`, `PG_POOL_MAX=1`, `SSM_PARAMETER_PATH=/dejavu/dev`,
      `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_SECRET_ARN` (from `module.rds`'s
      outputs), `DB_SSL_CA_PATH=/app/certs/rds-global-bundle.pem`,
      `CORS_ORIGINS`, `FRONTEND_URL`, `TRUST_PROXY` (placeholder `0` until
      6.9's experiment). No secret values (D4).
- [x] `aws_lambda_function_url`: `authorization_type = "NONE"`,
      `invoke_mode = "BUFFERED"`, no `cors` block.
- [x] Public-invoke `aws_lambda_permission` for the URL — still needs the
      plain-`curl` verification against a real deployed function in 6.7.
- [x] `aws_lambda_function "migrator"`: same role, subnets and SG; migrator
      image; `timeout = 300`; no Function URL.
- [x] Reserved concurrency: **left unset**, not "say 5" — checked the
      account's quota first as instructed
      (`aws lambda get-account-settings`): `ConcurrentExecutions` is **10
      total** for this account, and AWS refuses any reservation that leaves
      fewer than 10 unreserved, so reserving even 1 today would fail the
      apply. `var.reserved_concurrency` defaults to `null` with a comment
      explaining why, ready to set once a quota increase is requested.
- [x] Outputs: `function_url`, `function_name`, `migrator_name`.

### `modules/observability`

- [x] `aws_cloudwatch_log_group` for `/aws/lambda/dejavu-dev-api` and
      `-migrator`, `retention_in_days = 14`. Ordered before the functions via
      `depends_on = [module.observability]` on `module.lambda` in
      `envs/dev/main.tf` (module-level, since the log groups aren't resources
      `modules/lambda` itself creates).
- [x] Alarms and SNS are Phase 7 — noted in the module's header comment.

### Wiring and validation

- [x] All four modules wired into `envs/dev/main.tf` only (D6) — `envs/prod`
      untouched.
- [x] `terraform fmt -recursive -check` and `terraform validate` clean across
      `bootstrap/`, `envs/dev/`, `envs/prod/`.
- [x] Real `terraform plan` against the live account (read-only, not
      applied): **28 to add, 1 to change** (the budget module's Phase 6
      `cost_filter`/$30 limit from 6.5, not yet applied to `envs/dev`), **1 to
      destroy** (the `DATABASE_URL` SSM parameter — pre-existing removal from
      6.2d, unrelated to this step). No errors; every data source
      (`dejavu-dev-lambda` role, `dejavu-api`/`dejavu-migrator` ECR repos,
      the public AMI parameter) resolved against the real account. **Not
      applied** — that's 6.7, and it starts real billing.

---

## 6.7 — First deploy to dev (billing starts here)

Order matters (correction 9). Do it from the branch, before merging.

1. [x] Bootstrap (6.5) already applied with admin credentials. Outputs
       already in GitHub variables (6.5).
2. [x] Built and pushed the first images (`:bootstrap` tag) with the admin
       credentials in this session, via `docker buildx build --platform
       linux/arm64 --provenance=false --sbom=false ...`. `--provenance=false
       --sbom=false` turned out to be load-bearing, not cosmetic - buildx's
       default attestation attachment produces an OCI image index that
       Lambda's `CreateFunction` rejects outright (see round 7 below); added
       the same two flags to `ci.yml`'s `push-image` job so CI's future
       SHA-tagged pushes don't hit it either.
3. [x] **Tested the apply role before merge.** `dev`'s deployment branch
       policy was already unrestricted (`null`), so no temporary allow was
       needed. Ran `terraform.yml` via `workflow_dispatch` from this branch
       **eight times** before a clean apply - every failure diagnosed from
       real `AccessDenied`/API errors and fixed in `modules/iam-oidc`,
       `modules/network`, `modules/lambda`, or `envs/dev`, each round
       committed, pushed and re-dispatched. In order:
     1. `budgets:ListTagsForResource` etc. missing - the very "drift" 6.5
        called unrelated cleanup was actually load-bearing (corrected there).
     2. EC2 create actions authorize against **both** the new resource and
        the pre-existing parent VPC/IGW; `RequestTag` only covers the new
        resource's leg, so the parent leg needs `ResourceTag` instead. Also
        missing `rds`/`logs`/`lambda` `ListTagsForResource`/`ListTags` (same
        provider tag-readback pattern as budgets).
     3. `ec2:CreateTags` on a brand-new subnet/SG/IGW needs `RequestTag`, not
        `ResourceTag` - the resource has no tags yet. Missing
        `ecr:DescribeRepositories` for the Lambda module's repo lookup.
     4. Missing `ecr:ListTagsForResource` (same pattern, on the ECR
        data-source read).
     5. `aws_vpc_security_group_{ingress,egress}_rule` creates a distinct
        `security-group-rule` ARN resource (AWS's newer per-rule model),
        needing `RequestTag`, not `ResourceTag`. Also: this account rejected
        RDS `backup_retention_period = 7` with `FreeTierRestrictionError`;
        dropped dev to `1` (still > 0, so 6.11's PITR stays possible).
     6. `RunInstances` is authorized against every resource type it touches;
        the auto-created network interface and the AMI never carry our tag
        (the instance's tag spec doesn't extend to them), so neither
        condition could ever match - added a narrow unconditioned grant on
        exactly those two resource types. Also: RDS's `storage_encrypted`
        needs its own `kms:CreateGrant`/`DescribeKey`/etc. (`ViaService=rds`)
        even though the default `aws/rds` key already existed and was
        enabled.
     7. `t4g.nano` isn't Free Tier-eligible on this account (`t4g.micro` and
        `t4g.small` are, per `aws ec2 describe-instance-types`) - bumped the
        NAT instance size, keeping D2's arm64 choice. Both `:bootstrap`
        images failed `CreateFunction` with an unsupported manifest media
        type - the buildx attestation issue described in step 2.
     8. **Succeeded.** VPC, NAT, RDS (encrypted, available), both Lambda
        functions and the Function URL all created cleanly.
4. [x] Real values set in SSM: a fresh 48-random-byte `JWT_SECRET`, and the
       `sk_test_…` key already sitting in the local `backend/.env` (already
       test-mode, satisfying 6.0's "dev never holds a live key").
       `STRIPE_WEBHOOK_SECRET` stays for 6.8.
5. [x] RDS-managed secret's tags checked via `aws secretsmanager
       describe-secret`: `aws:rds:primaryDBInstanceArn` =
       `arn:aws:rds:us-east-1:059317926288:db:dejavu-dev`, exactly matching
       `modules/workload-roles`'s condition - no fix needed.
6. [x] `{"action":"up"}` → all seven migrations listed, after two more real
       fixes found by actually invoking it (not IAM - application and
       infrastructure bugs):
     - The migrator handler isn't run through `lambda.js`, so nothing loaded
       SSM secrets before its top-level `require`s hit `config/env.js`'s
       require-time validation. Extracted the SSM-loading logic into
       `src/lib/loadSecretsFromSsm.js`, shared by both entrypoints; migrator
       now awaits it first and defers its `env`/`connectionOptions` requires
       into `up()`/`seed()`.
     - NAT still didn't work after the images were fixed:
       `EHOSTUNREACH`/`ETIMEDOUT` reaching real AWS IPs through it, even with
       `ip_forward=1` and the MASQUERADE rule both confirmed correct.
       Diagnosed by temporarily attaching an SSM instance profile (created,
       used, fully detached and deleted afterward - the "no instance
       profile" default is unchanged) and running `iptables -L FORWARD -n
       -v` directly: AL2023's `iptables-services` package ships a default
       ruleset whose filter table ends `-A FORWARD -j REJECT`, loaded by
       `systemctl enable --now iptables`, in a completely different table
       from the one the NAT rule touches. Fixed `modules/network`'s
       `user_data` with two `ACCEPT` rules inserted ahead of it (one for
       `RELATED,ESTABLISHED` reply traffic, one for the VPC CIDR's outbound
       leg), applied live via SSM first to confirm, then folded into
       Terraform and re-applied for real (a clean stop/modify/start, not a
       full replace - same instance ID, same private IP).
7. [x] `{"action":"seed"}` → `{"seeded":true}`.
8. [x] Smoke test, all four passing against the real Function URL:
       `/api/status` (200), `/api/ready` (200 - proves Lambda → RDS over TLS
       with the lazy password), `/api/version` (`{"sha":"4100dc8"}`, matching
       the deployed image), `/api/products` (seeded items returned). One more
       fix needed first: `DB_SSL_CA_PATH` was hardcoded to `/app/certs/...`,
       correct for the api image's `WORKDIR /app` but not the migrator's AWS
       base image (`/var/task`) - removed the override entirely, since
       `connectionOptions.js`'s own `__dirname`-relative fallback already
       resolves correctly for both.
9. [ ] Not yet exercised - no `put-parameter` has happened since the
       functions came up warm. Applies whenever `STRIPE_WEBHOOK_SECRET` is
       set in 6.8.

Note: private RDS means no `psql` from your laptop, by design. Inspect data
through the app's own admin endpoints and CloudWatch. Session Manager port
forwarding through the NAT would need an instance profile - used exactly
once, temporarily, for the NAT debug above, and fully removed afterward. A
standing version of it is a reasonable Phase 7+ addition, but it's an
addition, not a default.

---

## 6.8 — The raw-body gate (Phase 6's checkpoint)

The plan calls this the single biggest risk on the Lambda path, so it gets
settled before anything else is built on top.

- [x] Webhook endpoint created via the Stripe API (equivalent to the
      Dashboard path - `webhook_endpoints create`, since the Stripe CLI's
      cached session key had expired and the account's local `.env` key
      turned out to be expired too, not just the CLI's): `<function-url>
      /api/webhooks/stripe`, event `checkout.session.completed` only -
      confirmed via `webhookController.js` that it's the only type actually
      handled (anything else already gets acknowledged 200 as unhandled, per
      the checkpoint's existing design). Found and fixed two expired
      credentials as a prerequisite: the CLI's stored session key, and the
      `STRIPE_SECRET_KEY` already sitting in SSM from 6.7 step 4 - both
      replaced with a fresh key from the Stripe Dashboard.
- [x] Real `STRIPE_WEBHOOK_SECRET` set in SSM, `CONFIG_REV` bumped
      (`aws lambda update-function-configuration` with the full existing
      environment map re-sent plus the new `CONFIG_REV` value - the API
      replaces the whole map, so this reads-modifies-writes rather than
      setting one key).
- [x] `stripe trigger checkout.session.completed` (via the Stripe CLI,
      installed this session with `winget install Stripe.StripeCli`) → a
      real 200 response from the live Function URL; CloudWatch logs show
      `order.created` with a real order id, **no `webhook.signature_invalid`
      anywhere**. This is the checkpoint - end to end, through the Function
      URL → Lambda Web Adapter → `express.raw` → Stripe SDK signature
      verification, the raw body survives intact.
- [ ] Full path from the storefront (Vercel) - **deferred to 6.9**, which is
      where the frontend actually gets pointed at this Function URL and
      `CORS_ORIGINS` gets a real value to test against.
- [x] Duplicate delivery, tested without the Dashboard's "Resend" (not
      exposed via the API - confirmed by trying it and getting
      `Unrecognized request URL`): self-signed a real captured
      `checkout.session.completed` payload against a temporary webhook
      endpoint's own secret (created, used, deleted - never touched via
      Dashboard, secret never written to disk or printed, only held
      in-process for the one script that used it), POSTed it twice with the
      same event id. Both attempts logged `webhook.duplicate` /
      `Event already processed, skipping` - confirms the `StripeEvent`
      `ON CONFLICT DO NOTHING` claim.
- [x] Negative signature test: same approach, one byte of the event `type`
      field changed after computing the signature over the original body →
      **400**, `webhook.signature_invalid` logged, exact message
      `No signatures found matching the expected signature for payload`.
      Signature verification is doing real cryptographic work, not passing
      through by accident.
- [x] Signatures never failed to verify on a genuine, unmodified delivery -
      no base64/charset investigation was needed. Cleaned up after testing:
      deleted the two now-orphaned webhook endpoints created along the way
      (their secrets got superseded when SSM was rotated for the next test),
      landing on one final, permanent endpoint whose secret is what's live
      in SSM now - reverified with one more real `stripe trigger` against it
      (clean `order.created`, no duplicate, no signature error).

---

## 6.9 — Runtime checks (measure, then write down the numbers)

- [x] **`TRUST_PROXY`, found by experiment - and the experiment overturned
      the plan's own assumption.** Added a temporary `/api/debug/ip` route
      (added, used, removed - never shipped) and sent `curl -H
      'X-Forwarded-For: 1.2.3.4'` at the live Function URL. Result: the
      adapter passes a client-supplied `X-Forwarded-For` straight through
      **unmodified** - my spoofed value replaced the real IP entirely, with
      no trace of the genuine address anywhere. There is no CloudFront or
      ALB in front of this Function URL to sanitize it. That means **no
      value of `app.set('trust proxy', N)` is safe here**: any `N > 0` would
      let a single caller mint a fresh rate-limit bucket per request for the
      price of one header - strictly worse than the "everyone shares one
      bucket" problem, not a fix for it. `TRUST_PROXY` stays `0`, now
      confirmed correct rather than a guess (Terraform variable description
      updated accordingly).
    - The real fix: the true source IP does reach the app, just not as
      `X-Forwarded-For`. AWS puts it in `requestContext.http.sourceIp` on
      the Function URL event, and the adapter forwards that as the
      `x-amzn-request-context` header - confirmed **not** spoofable by
      trying to forge that header too (a fake `sourceIp` inside it had zero
      effect; AWS overwrites the header before the adapter ever sees the
      request). Added `src/lib/clientIp.js` to read it directly, wired into
      both rate limiters via `keyGenerator` (unit tested,
      `tests/clientIp.test.js`).
    - Found a second real bug along the way: express-rate-limit validates
      custom `keyGenerator`s and flagged that a raw IPv6 address is not a
      safe bucket key on its own (a caller with a `/56` or wider allocation
      could walk one address per request). Fixed with the library's own
      `ipKeyGenerator` helper, collapsing to the containing `/56`.
    - **Proved it live, not just in a unit test:** 11 failed logins against
      a real seeded user hit exactly 10× `401` then `429` (limit is 10);
      resending with a spoofed `X-Forwarded-For: 8.8.8.8` and then
      `6.6.6.6` both still returned `429`; the `ratelimit.login` log line
      showed my real IPv6 address throughout, never the spoofed ones.
- [x] Honest caveat confirmed as still true and unchanged by the above: the
      limiter is in-memory **per execution environment** - concurrency still
      multiplies the effective budget, and a recycle still resets it.
      Nothing here changes that; it only closes the *spoofing* hole, not the
      *per-instance-budget* one. Reserved concurrency would bound it, but
      this account's 10-execution ceiling (6.6) means none is set. The real
      fix (shared store, or WAF in front of a CloudFront-fronted URL) stays
      out of scope, per the original plan.
- [x] **Cold start:** 11 forced cold starts (bumping `CONFIG_REV` before each
      invoke to guarantee a fresh execution environment). `Init Duration`
      p50 **≈1159 ms** (range 777–1543 ms); `boot.secrets_loaded` (the SSM
      fetch inside that) p50 **≈221 ms** (range 181–248 ms) - so the SSM
      round trip is a consistent ~19% of cold start, the rest being Node
      startup, module load, and the adapter's own init. No provisioned
      concurrency, as specified.
- [x] **bcryptjs cost:** first pass against a nonexistent email measured the
      wrong thing entirely - `authController.js` returns 401 before ever
      calling `bcrypt.compare` when the user isn't found, so that path never
      touches bcrypt at all (worth noting: also a timing side-channel for
      user enumeration, out of scope to fix here). Re-measured against
      `test@example.com` (a real seeded user, wrong password) so
      `bcrypt.compare` actually runs: **512 MB p50 ≈513 ms** (9 warm
      samples, 476–537 ms) vs **1024 MB p50 ≈332 ms** (9 warm samples,
      313–339 ms) - about 35% faster. Not quite cost-neutral though: in
      GB-seconds, 512 MB costs ~0.26 and 1024 MB costs ~0.33 per call, about
      29% more expensive for the faster response. Left the deployed function
      at the Terraform-declared 512 MB (reverted the live test change) -
      whether the latency is worth the ~29% is a product call, not made
      here.
- [x] **Connections:** a 20-concurrent burst (`Promise.allSettled` over
      `fetch`, since neither `hey` nor `autocannon` was installed) against
      `/api/products` returned exactly **10× 200, 10× 429** - matching the
      account's 10-execution concurrency ceiling (6.6) precisely; the excess
      never touched the app at all, thrown back by Lambda itself.
      `DatabaseConnections` peaked at **2** during the window (`PG_POOL_MAX
      =1`, and most of the 10 successful requests reused already-warm
      environments with pooled connections from the cold-start/bcrypt
      testing minutes earlier) - nowhere near a risky level either way.
- [x] **CORS from the real frontend.** `dejavu-ten.vercel.app` was dead (the
      project no longer exists under this account). Installed the Vercel
      CLI, logged in via its device-code flow, and deployed `dejavu/` as a
      new project. Production alias **`dejavu-seven.vercel.app`** (stable
      across future `vercel --prod` redeploys, unlike per-deploy preview
      URLs - confirmed distinct from the deployment-specific URL in the same
      output). Set `VITE_API_URL` to the dev Function URL for the
      `production` Vercel environment (inlined at build) and pointed
      `envs/dev`'s `cors_origins`/`frontend_url` at this URL instead of the
      module's `dejavustudio.xyz` default, applied via the normal CI path.
    - Verified with a real browser (Claude in Chrome), not just curl:
      `/pages/shop` fetched `/api/products` (200) and rendered both seeded
      products correctly in the DOM (name, price, links) with **no CORS
      error** in the console; the product detail page's own fetch
      (`/api/products/:id`) also succeeded; a direct `OPTIONS` preflight
      against `/api/checkout` with `Origin: https://dejavu-seven.vercel.app`
      returned 204 with the right `access-control-allow-origin` - Express is
      answering every preflight this frontend will send.
    - **Found, out of scope to fix here:** the actual "add to cart, click
      checkout" click-through is currently blocked because product images
      point at `dejavustudio.xyz/images/...` and 404, and the add-to-cart
      control never renders as a result. **Correction (6.12):** not a
      frontend hardcode. The URLs are seed data, written by the migrator,
      which had no `FRONTEND_URL` and fell back to `env.js`'s default. Fixed
      in 6.12 (`modules/lambda` shared environment) and re-seeded; images
      load. Original note, for the record: "a pre-existing frontend bug"
      (confirmed via the accessibility tree: no add-to-cart button exists in
      the DOM anywhere on the product page, despite the product data itself
      loading correctly). This is a frontend asset/data issue, not a
      CORS/Lambda/Terraform one - Phase 6 is the infra phase, and this bug
      predates it. Worth its own fix, not folded in here.

---

## 6.10 — Secret rotation, actually exercised

The whole reason one secret moved to Secrets Manager is that its rotation
gets used. So use it once.

- [x] Warm the function, then
      `aws secretsmanager rotate-secret --secret-id <rds!db-…>`. Done twice
      (runs 1 and 2 below).
- [x] Keep hitting `/api/ready` and `/api/products` through the rotation.
      Expect at most a blip: a `28P01` → `invalidate()` → reconnect with the
      new password. **No redeploy, no cold start forced.** Exactly that: one
      503, then recovery on the very next request (run 2).
- [x] Record what you saw. Nothing failed beyond the expected blip, so no
      change to the cache TTL or invalidation from 6.2c.

**Run 1 (2026-09-16, `rotate-secret` run by hand - the agent's auto-mode
classifier blocks Secrets Manager writes, correctly):** a scripted drill hit
`/api/ready` + `/api/products` about once a second, rotated at ~20:10Z, and
`LastRotatedDate` landed at **20:11:08Z** (about a minute).
- **Held connection through a rotation: verified.** 1,078 invocations from
  20:08:58Z to 20:21:15Z, **all in one execution environment** (one log
  stream), **zero** error/warn app lines, no `28P01`, no
  `readiness.failed`. One `Init Duration`, at 20:08:58, the drill's own first
  request, before the rotation; none caused by it. The RDS
  `postgresql.log` for the hour has **no** `password authentication failed`
  line (Postgres logs those at FATAL by default), so the server agrees. This
  is the expected mechanism: a password change doesn't end a session that's
  already logged in.
- **Stale-cache reconnect (`28P01` → `invalidate()`): NOT exercised.** Found
  by reading the timestamps back, not assumed. RDS-managed rotation leaves
  `AWSPENDING` attached to the **same** version as the new `AWSCURRENT` once
  it finishes, and the drill's completion check waited for `AWSPENDING` to
  disappear, so it rode out its 10-minute cap. The reconnect after that came
  ~10 min after the last password fetch - past the 5-min cache TTL - so it
  simply re-fetched the new password. The path 6.2c exists for never ran.
  Worth knowing for Phase 7's alarms: a leftover `AWSPENDING` on this secret
  is normal, not a stuck rotation.
- Can't tell from logs *when* the pool reconnected: `log_connections` is at
  the engine default (off).

**Run 2 (same day, drill's completion check fixed to "`AWSCURRENT` moved"):**
the rotation was requested at 20:41:44Z and `AWSCURRENT` moved at 20:42:52Z
(**68 s**). The drill then idled 45 s (longer than the pool's 30 s
`idleTimeoutMillis`) and reconnected at 20:43:37Z, when the cached password
was **115 s old**, well inside the 5-min TTL, so the old password was still
cached.
- **186 requests, 185× 200, exactly one non-200:** `/api/ready` → **503** at
  20:43:37.801Z. The app logged `readiness.failed` with `code: "28P01"`,
  `password authentication failed for user "dejavu_admin"`, raised through
  `pool.<computed> [as query] (src/db/pool.js)`, which is the wrapper that
  calls `invalidate()`. The RDS `postgresql.log` shows the matching `FATAL`
  from the Lambda's private IP at the same second.
- **Recovery on the very next request:** `/api/products` at 20:43:38.078Z →
  200 (277 ms, which includes the Secrets Manager re-fetch plus a new TLS
  connection), then steady ~50-60 ms 200s through the end of the drill.
- **No cold start caused by the rotation, no redeploy:** one execution
  environment the whole run; its single `Init Duration` is the drill's first
  request at 20:40:42Z, before `rotate-secret`.
- **Also settled a question run 1 couldn't answer:** a Lambda environment
  frozen between invocations *does* close its idle pool connection on the
  next thaw (the idle timer is overdue and fires before the request is
  handled). The FATAL above can only come from a new connection. So after a
  rotation, a warm environment that has sat idle for >30 s is exactly the
  one that takes the blip.
- **What the blip costs, and the fix if it matters:** one failed request per
  warm environment, and only when its password was fetched <5 min before the
  rotation *and* it reconnects before the cache expires. At the default
  7-day schedule, that's rare. If it ever needs to be invisible, the
  `invalidateOn28P01` wrapper in `pool.js` could retry the call once after
  `invalidate()`. Not done here, because 6.10's bar was "at most a blip" and
  it was met. Noted for 6.13's "what I'd do differently."
- Drill script (not checked in): polls both endpoints about once a second,
  calls `rotate-secret` and polls `describe-secret` from the same process, and
  logs one JSON line per event.

---

## 6.11 — PITR restore drill (the plan calls an untested backup a hypothesis)

Write this into `terraform/README.md` (or `docs/runbooks/`) **as you do it**,
with the real timestamps and gotchas.

Done 2026-09-16. The full runbook is in `terraform/README.md` → "Restoring
the database to a point in time"; this section keeps only the checkboxes.

- [x] Insert a marker row through the app (e.g. create a product via admin).
      Note the UTC time. Wait ~10 minutes (PITR lags the latest restorable
      time by ~5 min). Delete the marker. — Marker product created via
      `POST /api/admin/products` at **20:48:33Z**. There is no delete
      endpoint, so the "bad write" was `PUT /api/admin/products/:id`
      overwriting its name at **20:52:02Z**, the same test. The lag between
      the wall clock and `LatestRestorableTime` was ~6-7 min, not ~5.
- [x] `aws rds restore-db-instance-to-point-in-time …` to **20:50:00Z**,
      started 20:54:50Z, with subnet group `dejavu-dev`, SG `dejavu-dev-rds`,
      parameter group `dejavu-dev-pg16`, `db.t4g.micro`, private, and tags
      passed explicitly. No free-tier refusal on a second instance
      (unlike 6.7's `backup_retention_period = 7`).
- [x] Point the API at the restored endpoint (`DB_HOST` override), confirm
      the marker row is back, then point it home. — Ran by hand (the agent's
      classifier blocks live function-config changes) via a script that swaps
      **only** `DB_HOST` and restores the saved map on exit. Restored: marker
      back with its original name and `updatedAt`, `/api/ready` 200. Home:
      overwritten name again. Live environment then diffed against the saved
      copy: identical, 15 vars. Two cold starts (one per config change), no
      errors.
- [x] Record: time to available; how credentials worked on the restored
      instance; and that the restore is **outside Terraform state**.
    - **Time to available: 37 min 43 s**, of which `backing-up` was 22 min
      (the copy inherits 1-day retention and takes a fresh backup first).
    - **Credentials:** the copy got **no managed secret**
      (`MasterUserSecret: null`) and needed nothing. The password is in the
      data, so the copy carries whatever was current at 20:50:00Z, which the
      source secret still held (last rotation 20:42:52Z, from 6.10). Nothing
      done. A restore to before a later rotation would not be that lucky;
      the README spells out both ways out, including the role-policy catch
      with `--manage-master-user-password`. Not drilled.
    - **Outside Terraform state:** confirmed by construction. Created by the
      CLI, never imported, invisible to `plan`, and `destroy` wouldn't
      remove it.
- [x] Delete the restored instance (it bills while it exists). Record the
      total cost of the drill. — `delete-db-instance --skip-final-snapshot
      --delete-automated-backups` at 23:13:19Z; instance gone 23:14:59Z, its
      automated snapshot cleared 23:15:50Z. Only `dejavu-dev` and its own
      automated backups remain. It lived ~2.4 h (the wait
      for a human to run the swap was most of it). **~$0.05** at on-demand
      rates; 6.12's Cost Explorer check confirms the real figure.
- The marker product is still in dev's `Product` table (no delete endpoint;
  it shows up on `/pages/shop` as a $1 item with no images). The next
  `{"action":"seed"}` truncates it, and 6.12's destroy → re-apply → seed
  loop does that anyway.

---

## 6.12 — Destroy → re-apply drill, and a cost check

The plan's cost story is "`destroy` after a demo, `apply` before an
interview". Prove that loop works before relying on it.

Done 2026-09-16/17. The runbook is in `terraform/README.md` → "Tearing dev
down and bringing it back". As in 6.10/6.11, every live-infrastructure
command was run by hand from a prepared script (the agent's classifier blocks
destroy, apply, Stripe endpoint changes and Vercel production deploys), and
the agent read the logs back and verified.

- [x] `terraform destroy` on `envs/dev` (compute and data only; bootstrap and
      ECR stay). **Expect the subnets and SGs to hang for 20–40 minutes** on
      Lambda's ENIs (correction 10). Record the wall time.
    - **20 min 23 s** (23:36:39 → 23:57:02Z), 28 resources. Lambda
      functions 6 s, RDS 1m51s, NAT 40 s; then the Hyperplane ENIs:
      private subnets ~18 min, the `lambda` SG **20m05s**. Correction 10's
      estimate held, at its low end.
    - Afterwards: no VPC, ENI, RDS instance, function, log group or public
      IP left (NAT listed as `terminated`, which is how EC2 shows a deleted
      instance for a while).
- [x] Decide what survives. — **SSM parameters and the budget.** Not a
      separate state: `-target=module.lambda -target=module.rds
      -target=module.network -target=module.observability` on the destroy,
      plus `prevent_destroy = true` on `modules/secrets`' parameters, so an
      untargeted `terraform destroy` now **fails** instead of taking the real
      values with it (verified: plain `plan -destroy` errors; targeted plan =
      28 to destroy, 4 kept). A split state would be cleaner at more
      environments; at one, it's a new directory, backend key and CI job
      for four resources. All three parameters kept their real values
      through the loop (checked, not assumed).
- [x] `apply` again → migrate → seed → smoke test. Time the whole loop from
      zero to a verified webhook. That number goes in the README.
    - **~13 min 11 s from zero to a verified webhook**: 12m50s from
      `terraform apply` to four passing smoke checks, plus 21 s for the
      webhook stage. The first script aborted in between on its own bug
      (it captured the Stripe CLI's stderr banner into the JSON it then
      parsed), and that 17-minute pause isn't counted.
    - Apply 12m30s (28 added): **RDS 8m32s**, then both functions **3m44s**
      each (VPC Lambdas wait for their ENIs on create too), NAT 14 s.
    - Migrate: all 7 migrations. Seed. `/api/status`, `/api/ready`,
      `/api/version` (`57c6892`), `/api/products` all 200. Real
      `stripe trigger checkout.session.completed` → one `order.created`, no
      `webhook.signature_invalid`.
    - **Three things the loop has to redo that a plain `apply` doesn't:**
      1. **The Function URL changes** (`mbjiendiy…` → `bcswopais…`): the ID is
         generated per function. The Stripe endpoint's URL was updated in
         place (`webhook_endpoints update`, which keeps its signing secret,
         so SSM didn't change), and Vercel's `VITE_API_URL` was reset and
         the site redeployed; the new bundle has only the new URL. A stable
         domain in front (CloudFront or a custom domain) would remove both
         steps; noted for "what I'd do differently".
      2. **The image tag.** `initial_image_tag` defaults to `bootstrap`, which
         predates the 6.7 migrator SSM fix and 6.9's `clientIp` fix. Re-apply
         with `-var initial_image_tag=4100dc8` (present in both repos), then
         `update-function-code` the api to `57c6892`, the live pair
         before the destroy. CI's apply passes no tag, so **a CI-driven
         re-create would bring back the stale image**. Phase 7's pipeline
         deploy has to follow any re-create.
      3. **The Stripe CLI key expires** (~90 days) and is needed for the
         trigger; `stripe login` again, in the **same** test environment that
         has the endpoint (a second, older Render endpoint in that account is
         untouched and ignored by the script).
    - **Found by looking at the result, not in the plan:** product images
      still didn't load. Traced to the **migrator lacking `FRONTEND_URL`**:
      only the api function had it, so `seed` fell back to `env.js`'s
      `https://dejavustudio.xyz` default and wrote image URLs that 404.
      That is the real cause of the "no images" 6.9 recorded (6.9 blamed a
      hardcoded frontend domain; corrected there). Moved `FRONTEND_URL` into
      `modules/lambda`'s shared environment (plan: exactly one in-place
      change on the migrator), applied, re-seeded: all 7 image URLs now 200
      from `dejavu-seven.vercel.app/images/…`, and the shop shows them.
- [x] Cheaper middle ground to document: **stop** RDS (auto-restarts after 7
      days) and the NAT instance, and storage is the only cost. Note the
      auto-restart. — Written up in the README, **not drilled**. The catches
      worth knowing: RDS starts itself again after 7 days and starts billing
      without telling you; the NAT's auto-assigned public IP is released on
      stop and a new one comes on start (nothing depends on it); and while
      the NAT is stopped, **every Lambda cold start fails**, because the SSM
      fetch has no route out (no VPC endpoints, 6.6). Stopping the NAT and not
      RDS saves little and breaks the API.
- [x] Check Cost Explorer after ~48h against the table below, and correct the
      table with real numbers. — First look (at the drill): this account is
      on the AWS **Free plan** (`freetier get-account-plan-state`: `FREE`,
      `ACTIVE`, $159.59 credits remaining). Month-to-date usage was
      **$0.41**, fully offset by credits, and the RDS, NAT and public IPv4
      hours all bill at $0 under the free tier. The table below is corrected
      to list prices and the NAT's real `t4g.micro` size (6.7).
      **Re-checked 2026-09-23** (issue #23), a six-day sample rather than
      48 h: dev has run continuously since this re-create (RDS
      `InstanceCreateTime` 2026-09-17T00:22Z). `aws ce get-cost-and-usage`
      for 2026-09-01 to 2026-09-23, monthly, grouped by service: every
      service line $0 (or a ~1e-8 rounding artifact), total ≈ −$0.00000012.
      RDS, EC2 (NAT) and public-IPv4 hours are all $0 under the free tier
      with one environment up. `freetier get-account-plan-state`:
      **$174.32** credits remaining, higher than the $159.59 above, and the
      plan expires **2027-03-10T22:53:06Z**.

---

## 6.13 — Docs, execution plan, merge

- [x] `terraform/README.md`: Phase 6 layout, first-deploy order (6.7),
      rotation note, restore runbook (6.11), destroy caveats (6.12).
- [x] `CLAUDE.md`: env vars (`DB_*`, `SSM_PARAMETER_PATH`, `GIT_SHA`,
      `DEPLOY_ENV`, `AWS_LWA_*`), the `src/lambda.js` entrypoint, the
      migrator, `bcryptjs`, the image targets. — New "Deployment (AWS,
      Phase 6)" section, plus the `clientIp` rate-limit keying.
- [x] `backend/.env.example`: document the new optional variables.
      (`SEED_IMAGE_BASE_URL`, `GIT_SHA`, `DEPLOY_ENV`, `SSM_PARAMETER_PATH`,
      the adapter vars; `TRUST_PROXY` guidance corrected per 6.9.)
- [x] `dejavu-execution-plan.md`: mark Phase 5 and 6 `[x]`, add a **"What
      Phase 6 actually turned up"** section (start from the corrections list
      above and keep only the ones that bit), and fix the cost table.
- [x] "What I'd do differently": app-level DB role instead of master (D8);
      IAM DB auth instead of a password; VPC endpoints vs NAT at higher
      traffic; RDS Proxy if concurrency × pool ever approaches
      `max_connections`; a shared rate-limit store; retry once on `28P01`
      after `invalidate()` so a rotation is invisible to callers (6.10).
      Also added: a stable hostname in front of the Function URL (6.12),
      IAM Identity Center (6.0), and split SSM state at more environments.
- [ ] Merge. `apply-dev` runs on the merge and should be a no-op plan, because
      you applied from the branch in 6.7. If it isn't, find out why before
      shipping anything else.
- [x] Delete this file before merge, as with Phase 5, or keep it. Your call.
      — **Kept in the repo** (unlike Phase 5's): it's the only record of
      every measurement and gotcha, and `terraform/README.md`,
      `envs/dev/main.tf` and the execution plan link to it.

---

## Exit criteria

- [x] A real Stripe test-mode webhook to the Function URL verifies its
      signature and records exactly one order (6.8).
- [x] RDS is not publicly accessible; 5432 is reachable only from the Lambda
      SG (SG reference, not CIDR). — Checked live after the 6.12 re-create:
      `PubliclyAccessible: False`; the RDS SG's only ingress is 5432 from
      the `dejavu-dev-lambda` SG ID, with no CIDR.
- [x] No secret value in any Lambda environment variable, `.tf` file, tfvars,
      CI log, or (for the DB password) Terraform state. — Both functions'
      environments scanned (15 and 9 vars, nothing secret-shaped); no
      `sk_`/`whsec_` strings in tracked `terraform/` or `.github/`; the DB
      password is RDS-managed, so state holds only the secret's ARN. CI logs
      by construction: no application secret passes through CI at all, and
      the one GitHub secret the workflows read (the budget email) is masked. The
      caveat stands: SSM SecureString values *are* in state after a
      refresh (`modules/secrets` header; `value_wo` is the fix).
- [x] Images are tagged by git SHA in an immutable repo; `/api/version`
      returns the SHA that's live. — Both repos `IMMUTABLE`; live
      `dejavu-api:57c6892`, `/api/version` → `{"sha":"57c6892"}`.
- [x] Trivy gates every PR on HIGH/CRITICAL. — `ci.yml` `image` job,
      SHA-pinned `trivy-action`, `severity: HIGH,CRITICAL`, `exit-code: 1`,
      in the aggregate `ci` gate (6.4).
- [x] PITR restore performed once, steps written down (6.11).
- [x] Cold start and login latency measured and quoted (6.9).
- [x] `destroy` → `apply` round trip done and timed (6.12).

---

## Cost

Per month, dev running around the clock, us-east-1, on-demand. Verify against
current pricing and your account's free-tier status. The free tier changed for
accounts created after July 2025.

| Item | Monthly |
|---|---|
| RDS `db.t4g.micro`, single-AZ | ~$11.70 |
| RDS 20 GB gp3 + backups (≤ DB size free) | ~$2.30 |
| NAT instance **`t4g.micro`** (6.7: `t4g.nano` isn't free-tier eligible here) | ~$6.15 |
| NAT public IPv4 ($0.005/hr) | ~$3.65 |
| NAT 8 GB gp3 root volume | ~$0.65 |
| Secrets Manager, 1 secret | $0.40 |
| ECR storage (~15 images) | ~$0.20 |
| Lambda + CloudWatch Logs at this traffic | ~$0–1 |
| **Total at list price** | **~$25–26** (~$0.85/day) |

**What this account actually pays (6.12, re-checked 2026-09-23):** it is on
the AWS Free plan, and Cost Explorer bills the RDS instance hours, the NAT
instance hours and the public IPv4 at **$0** under the free tier. From
2026-09-01 to 2026-09-23 every service line is $0 (total ≈ −$0.00000012),
over six days of dev running continuously since the 6.12 re-create.
Credits remaining: **$174.32**; the plan expires **2027-03-10T22:53:06Z**.
The list-price table is what a paid account, or this one after the free
plan ends, would see. That's one environment; with prod up as well, the
second set of instance hours exceeds the free tier and draws credits (see
`phase-7-steps.md`'s Cost section).

With both RDS and the NAT stopped, storage and snapshots only: ~$3/month
(RDS restarts itself after 7 days). Fully destroyed (bootstrap + ECR + SSM
kept): ~$0.20/month.

---

## Deferred to Phase 7, explicitly

Pipeline-driven deploys and migrations; Lambda versions + alias rollback;
staging/prod separation and its cost; alarms + SNS (5xx, errors, throttles,
`checkout.oversell` metric filter); prod apply of these modules.
