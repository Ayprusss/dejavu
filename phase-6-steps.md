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
| 6.8 | **Raw-body gate:** real Stripe webhook verifies | | [ ] |
| 6.9 | Runtime checks: proxy, cold start, bcryptjs, CORS | | [ ] |
| 6.10 | Secret rotation actually exercised | | [ ] |
| 6.11 | PITR restore drill, written down | | [ ] |
| 6.12 | Destroy → re-apply drill, cost check | | [ ] |
| 6.13 | Docs, execution plan, merge | | [ ] |

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

- [ ] Stripe dashboard (test mode) → Webhooks → add endpoint
      `<function-url>/api/webhooks/stripe`, events `checkout.session.completed`
      (plus anything else `webhookController` handles). This endpoint's
      `whsec_…` is **not** the one `stripe listen` prints.
- [ ] `aws ssm put-parameter --name /dejavu/dev/STRIPE_WEBHOOK_SECRET --type SecureString --overwrite --value whsec_…`,
      then bump `CONFIG_REV` (6.7 step 9).
- [ ] `stripe trigger checkout.session.completed` → the dashboard shows a
      **200** delivery; logs show `order.created`, **no
      `webhook.signature_invalid`**.
- [ ] Full path: from the storefront (Vercel pointed at the Function URL, see
      6.9), buy with `4242 4242 4242 4242` → `order.created` +
      `stock.decremented` → the order is visible via the admin API.
- [ ] "Resend" the same event from the dashboard → `webhook.duplicate`, still
      one order.
- [ ] Negative: POST a correctly signed payload with one byte changed → 400
      and `webhook.signature_invalid`.
- [ ] If signatures fail: log `req.headers['content-type']`, body length and a
      SHA-256 of the raw body next to the value Stripe shows, and compare. The
      suspect is base64 or charset handling between Function URL → adapter →
      `express.raw`. If it can't be made reliable, **Fargate + ALB is the
      documented fallback**; write down what failed before switching.

---

## 6.9 — Runtime checks (measure, then write down the numbers)

- [ ] **`TRUST_PROXY`, found by experiment:** temporarily log `req.ip`, the
      raw `X-Forwarded-For` and the socket address. Send
      `curl -H 'X-Forwarded-For: 1.2.3.4' <url>/api/status`. Choose the value
      for which `req.ip` is your real address and **not** `1.2.3.4`. Then
      prove the login limiter trips for you and doesn't trip for a second IP
      (phone hotspot). Remove the temporary logging.
- [ ] Record the honest caveat: the limiter is in-memory **per execution
      environment**, so on Lambda its budget multiplies with concurrency and
      resets on recycle. Reserved concurrency bounds it. The real fix (shared
      store, or WAF, which needs CloudFront in front of a Function URL) is
      deliberately not taken.
- [ ] **Cold start:** from the `REPORT` log line, record `Init Duration` at
      p50 over ~10 forced cold starts, with `boot.secrets_loaded` split out.
      Quote this number in the README. No provisioned concurrency.
- [ ] **bcryptjs cost:** time `POST /api/auth/login` warm at 512 MB. If it's
      painful, measure 1024 MB. More memory means more CPU and the same
      per-ms price, so it can be nearly cost-neutral. Record both.
- [ ] **Connections:** under a small burst (`hey`/`autocannon`, ~20
      concurrent), the RDS `DatabaseConnections` CloudWatch metric stays at or
      below the reserved concurrency (+ the migrator, if it's running), and
      excess requests are throttled (429s) rather than piling onto Postgres.
- [ ] **CORS from the real frontend:** point a Vercel deployment's
      `VITE_API_URL` at the Function URL (inlined at build, so rebuild).
      Add that origin to `CORS_ORIGINS` and `FRONTEND_URL`. Use a **stable**
      Vercel URL (branch alias or custom env); per-deploy preview URLs change
      every push. Browse → cart → checkout works in a real browser, with
      preflights answered by Express.

---

## 6.10 — Secret rotation, actually exercised

The whole reason one secret moved to Secrets Manager is that its rotation
gets used. So use it once.

- [ ] Warm the function, then
      `aws secretsmanager rotate-secret --secret-id <rds!db-…>`.
- [ ] Keep hitting `/api/ready` and `/api/products` through the rotation.
      Expect at most a blip: a `28P01` → `invalidate()` → reconnect with the
      new password. **No redeploy, no cold start forced.**
- [ ] Record what you saw. If it failed, the cache TTL or invalidation from
      6.2c is wrong. Fix it, then repeat.

---

## 6.11 — PITR restore drill (the plan calls an untested backup a hypothesis)

Write this into `terraform/README.md` (or `docs/runbooks/`) **as you do it**,
with the real timestamps and gotchas.

- [ ] Insert a marker row through the app (e.g. create a product via admin).
      Note the UTC time. Wait ~10 minutes (PITR lags the latest restorable
      time by ~5 min). Delete the marker.
- [ ] `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier dejavu-dev --target-db-instance-identifier dejavu-dev-restore --restore-time <before-delete> --db-subnet-group-name … --vpc-security-group-ids <rds-sg> --db-parameter-group-name dejavu-dev-pg16 --no-publicly-accessible`.
      **Pass the subnet group and SG explicitly.** Omitting them restores into
      defaults, which is the single most common restore mistake.
- [ ] Point the API at the restored endpoint (`DB_HOST` override), confirm
      the marker row is back, then point it home.
- [ ] Record: time to available; how credentials worked on the restored
      instance (whether it's tied to the source's managed secret or needed its
      own via `--manage-master-user-password`, and what you had to do); and
      that the restore is **outside Terraform state**.
- [ ] Delete the restored instance (it bills while it exists). Record the
      total cost of the drill.

---

## 6.12 — Destroy → re-apply drill, and a cost check

The plan's cost story is "`destroy` after a demo, `apply` before an
interview". Prove that loop works before relying on it.

- [ ] `terraform destroy` on `envs/dev` (compute and data only; bootstrap and
      ECR stay). **Expect the subnets and SGs to hang for 20–40 minutes** on
      Lambda's ENIs (correction 10). Record the wall time.
- [ ] Decide what survives. SSM parameters are free, and re-creating them
      means re-entering every secret, so consider moving them into their own
      config or state so a destroy of `envs/dev` leaves them alone.
- [ ] `apply` again → migrate → seed → smoke test. Time the whole loop from
      zero to a verified webhook. That number goes in the README.
- [ ] Cheaper middle ground to document: **stop** RDS (auto-restarts after 7
      days) and the NAT instance, and storage is the only cost. Note the
      auto-restart.
- [ ] Check Cost Explorer after ~48h against the table below, and correct the
      table with real numbers.

---

## 6.13 — Docs, execution plan, merge

- [ ] `terraform/README.md`: Phase 6 layout, first-deploy order (6.7),
      rotation note, restore runbook (6.11), destroy caveats (6.12).
- [ ] `CLAUDE.md`: env vars (`DB_*`, `SSM_PARAMETER_PATH`, `GIT_SHA`,
      `DEPLOY_ENV`, `AWS_LWA_*`), the `src/lambda.js` entrypoint, the
      migrator, `bcryptjs`, the image targets.
- [ ] `backend/.env.example`: document the new optional variables.
- [ ] `dejavu-execution-plan.md`: mark Phase 5 and 6 `[x]`, add a **"What
      Phase 6 actually turned up"** section (start from the corrections list
      above and keep only the ones that bit), and fix the cost table.
- [ ] "What I'd do differently": app-level DB role instead of master (D8);
      IAM DB auth instead of a password; VPC endpoints vs NAT at higher
      traffic; RDS Proxy if concurrency × pool ever approaches
      `max_connections`; a shared rate-limit store.
- [ ] Merge. `apply-dev` runs on the merge and should be a no-op plan, because
      you applied from the branch in 6.7. If it isn't, find out why before
      shipping anything else.
- [ ] Delete this file before merge, as with Phase 5, or keep it. Your call.

---

## Exit criteria

- [ ] A real Stripe test-mode webhook to the Function URL verifies its
      signature and records exactly one order (6.8).
- [ ] RDS is not publicly accessible; 5432 is reachable only from the Lambda
      SG (SG reference, not CIDR).
- [ ] No secret value in any Lambda environment variable, `.tf` file, tfvars,
      CI log, or (for the DB password) Terraform state.
- [ ] Images are tagged by git SHA in an immutable repo; `/api/version`
      returns the SHA that's live.
- [ ] Trivy gates every PR on HIGH/CRITICAL.
- [ ] PITR restore performed once, steps written down (6.11).
- [ ] Cold start and login latency measured and quoted (6.9).
- [ ] `destroy` → `apply` round trip done and timed (6.12).

---

## Cost

Per month, dev running around the clock, us-east-1, on-demand. Verify against
current pricing and your account's free-tier status. The free tier changed for
accounts created after July 2025.

| Item | Monthly |
|---|---|
| RDS `db.t4g.micro`, single-AZ | ~$11.70 |
| RDS 20 GB gp3 + backups (≤ DB size free) | ~$2.30 |
| NAT instance `t4g.nano` | ~$3.05 |
| NAT public IPv4 ($0.005/hr) | ~$3.65 |
| NAT 8 GB gp3 root volume | ~$0.65 |
| Secrets Manager, 1 secret | $0.40 |
| ECR storage (~15 images) | ~$0.20 |
| Lambda + CloudWatch Logs at this traffic | ~$0–1 |
| **Total** | **~$22–23** (~$0.75/day) |

With both RDS and the NAT stopped, storage and snapshots only: ~$3/month.
Fully destroyed (bootstrap + ECR + SSM kept): ~$0.20/month.

---

## Deferred to Phase 7, explicitly

Pipeline-driven deploys and migrations; Lambda versions + alias rollback;
staging/prod separation and its cost; alarms + SNS (5xx, errors, throttles,
`checkout.oversell` metric filter); prod apply of these modules.
