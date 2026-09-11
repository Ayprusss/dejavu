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
| 6.0 | Verify Phase 5 is really applied | $0 | [ ] |
| 6.1 | Decisions (below) signed off | $0 | [ ] |
| 6.2 | App changes for Lambda (no AWS needed) | $0 | [ ] |
| 6.3 | Container image, two targets | $0 | [ ] |
| 6.4 | CI: image build + Trivy on every PR | $0 | [ ] |
| 6.5 | Bootstrap additions (human-applied) | ~$0 | [ ] |
| 6.6 | Terraform modules: network, rds, lambda, observability | $0 until applied | [ ] |
| 6.7 | First deploy to dev | **billing starts** | [ ] |
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

- [ ] Bootstrap state lives in S3: `terraform/bootstrap/terraform.tfstate` is
      0 bytes locally (it is — consistent with a completed `-migrate-state`),
      and `terraform -chdir=terraform/bootstrap init -backend-config=...` shows
      no local state.
- [ ] `envs/dev` applied: `aws ssm get-parameters-by-path --path /dejavu/dev/`
      lists the four parameters, and the budget exists.
- [ ] GitHub variables set: `AWS_REGION`, `TF_STATE_BUCKET`, the four role
      ARNs; secret `BUDGET_ALERT_EMAIL`.
- [ ] A PR touching `terraform/` has produced a plan comment (Phase 5 exit).
- [ ] You have a way to act as admin **without a static key**. Phase 5 deleted
      the temporary admin key, and step 6.5 needs admin again. Use IAM Identity
      Center (`aws configure sso`, then `aws sso login`) instead of minting
      another access key; it keeps the "no long-lived credentials" story true
      for humans too.
- [ ] Stripe **test-mode** keys ready. Dev must never hold a live key.

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

- [ ] **D1 · NAT instance: your own AL2023 instance plus ~10 lines of
      `user_data`, not the community `fck-nat` AMI.** fck-nat is fine, but it
      puts a third-party AMI on the path that carries your Stripe traffic. A
      hand-written `ip_forward` + `MASQUERADE` script is something you can
      explain line by line. (The plan already settled NAT instance over NAT
      Gateway.)

- [ ] **D2 · arm64 everywhere.** Lambda arm64 is ~20% cheaper per GB-second,
      and the NAT (t4g) and RDS (t4g) are Graviton already. Build natively on
      GitHub's free `ubuntu-24.04-arm` runners (free for public repos) instead
      of QEMU emulation, which is 5–10× slower.

- [ ] **D3 · The Lambda execution role lives in `bootstrap/`, beside the CI
      roles.** This follows the same principle as Phase 5: CI can't change the
      shape of any access. The apply role's Deny is narrowed from `iam:*` to
      "everything except `PassRole` on exactly this role, plus read-only
      `Get*`/`List*` on it". *Considered and rejected:* letting CI create
      workload roles under a permissions boundary. That's the standard
      delegation pattern and it avoids a cross-config reference, but it gives
      CI `iam:CreateRole`, which is more to defend than one extra bootstrap
      apply per phase.

- [ ] **D4 · Secrets are fetched by the process at cold start, not injected
      as Lambda environment variables.** Env vars written by Terraform would
      put every secret into state *and* into `lambda:GetFunctionConfiguration`,
      where any read-only principal can see them in plain text (the plan role
      has `ReadOnlyAccess`). Instead, a small entrypoint reads
      `/dejavu/<env>/*` from SSM before `config/env.js` loads, so `env.js`
      stays unchanged. The DB password is fetched lazily (correction 3).

- [ ] **D5 · Terraform creates the function; it does not deploy code.**
      `aws_lambda_function` gets `lifecycle { ignore_changes = [image_uri] }`.
      Code ships with `aws lambda update-function-code --image-uri …:<sha>`.
      This saves Phase 7 from fighting Terraform over which image is live, and
      alias-based rollback needs exactly this split.

- [ ] **D6 · Only dev is applied in Phase 6.** `envs/prod` stays as it is
      until Phase 7, which decides what staging and prod cost. Build the
      modules so prod is a copy-paste of the dev wiring.

- [ ] **D7 · Build the migrator Lambda now, not in Phase 7.** RDS is private,
      so you can't migrate it from a laptop. The alternatives (SSM tunnel,
      temporarily public DB) are exactly what the design exists to avoid.
      Phase 7 then only has to invoke it from the pipeline.

- [ ] **D8 · The app connects as the RDS master user, for now.** It's the
      honest shortcut. The right answer is a least-privilege `dejavu_app` role
      created by a migration. List it under "what I'd do differently", or do
      it in 6.2 if there's appetite.

---

## 6.2 — App changes for Lambda ($0, no AWS, all testable locally)

Land these first. Every one of them has to keep `docker compose up`, the unit
suite, and the integration suite green, because the local path must not change.

### 6.2a · `bcrypt` → `bcryptjs`

- [ ] `npm uninstall bcrypt && npm install bcryptjs` (v3).
- [ ] Swap the require at the three sites: `src/controllers/authController.js:1`,
      `scripts/seed.js:15`, `tests/integration/helpers.js:7` (and anything
      `grep -rn "require('bcrypt')"` finds later).
- [ ] Prove that existing hashes still verify. **Before** uninstalling, generate
      a `$2b$` hash with native bcrypt and commit it as a fixture. Then add a
      unit test that `bcryptjs.compare` accepts it, so the claim is tested
      rather than assumed.
- [ ] Note the cost. It gets measured for real in 6.9.

### 6.2b · Build identity: `GIT_SHA` and a version endpoint

- [ ] `env.js`: optional `GIT_SHA`, default `'unknown'`.
- [ ] `GET /api/version` → `{ sha: env.GIT_SHA }`. The plan says `/version`;
      every other route is under `/api`, so pick one path and use the same
      one in Phase 7's smoke test.
- [ ] supertest case. Also leave it out of pino-http auto-logging, like the
      health checks, because Phase 7's smoke test polls it.

### 6.2c · Database connection: discrete params, TLS, lazy password

- [ ] `env.js`: require **either** `DATABASE_URL` (local, CI, tests; unchanged)
      **or** `DB_HOST` + `DB_NAME` + `DB_SECRET_ARN` (+ optional `DB_PORT`,
      `DB_SSL_CA_PATH`). Error if neither set is complete. Add a `boot-check`
      CI case for an incomplete `DB_*` set.
- [ ] `src/db/credentials.js`: `getDbPassword()` reads the RDS-managed secret
      (`{ username, password }` JSON) through
      `@aws-sdk/client-secrets-manager`. Cache it for ~5 min, and export
      `invalidate()`.
- [ ] `pool.js`: when `DB_SECRET_ARN` is set, build
      `{ host, port, database, user, password: getDbPassword, ssl: { ca } }`.
      Don't also put `sslmode` in a connection string, because
      connection-string SSL params override the `ssl` object. Keep
      `connectionString` for the local path.
- [ ] On a connect error with code `28P01` (auth failed), call `invalidate()`
      so the next connection re-fetches. This covers the rotation window.
- [ ] Check the RDS CA bundle in at `backend/certs/rds-global-bundle.pem`
      (from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`).
      It's public, and committing it keeps builds reproducible and offline.
- [ ] Unit-test the cache and invalidation with a stubbed SDK client. Mocking
      the AWS SDK is fine; the no-mocks rule is about the database.

### 6.2d · Secret loader entrypoint

- [ ] `src/lambda.js`: if `SSM_PARAMETER_PATH` is set, call
      `GetParametersByPath({ Path, WithDecryption: true, Recursive: false })`
      (paginate) and copy each `/dejavu/dev/NAME` into `process.env.NAME`,
      without overwriting anything already set. Fetch the DB username from
      the secret into `DB_USER`. Then `require('./server')`. If the variable
      is unset, just `require('./server')`, so compose and local runs are
      unaffected.
- [ ] **It must not require `lib/logger` or anything else that pulls in
      `config/env.js`.** That module validates at require time, so importing
      it before the secrets load throws. Log failures as one plain JSON line
      to stderr and `process.exit(1)`.
- [ ] Measure the loader's own time and log it (`boot.secrets_loaded`,
      `durationMs`). Cold-start numbers in 6.9 need it split out.
- [ ] Remove `DATABASE_URL` from the `parameters` map in `envs/dev/main.tf`,
      because the password now lives in Secrets Manager and the rest is
      non-secret config. Update `.env.example`'s Phase 6 comment to match.

### 6.2e · Migrator handler

- [ ] `src/migrator.js`, a plain Lambda handler (not behind the adapter):
      `const { runner } = await import('node-pg-migrate')`, then run `up`
      against `migrations/` with the **same `migrationsTable`** the CLI uses
      (default `pgmigrations`) so local, CI and RDS share one history. Use the
      same TLS and secret logic as 6.2c. Return the list of applied names.
- [ ] Accept `{ "action": "up" }` only for now. `down` against a deployed
      database should be a deliberate manual act, not a payload.
- [ ] node-pg-migrate takes a Postgres advisory lock, so two concurrent
      invocations serialise rather than race. Say so in a comment, because
      Phase 7 will ask.

### 6.2f · Seed for a deployed environment

- [ ] Replace the hardcoded `BASE_IMG_URL` with `FRONTEND_URL`-derived (or
      `SEED_IMAGE_BASE_URL`) so the dev storefront doesn't render localhost
      images.
- [ ] Expose it through the migrator as `{ "action": "seed" }`, refusing
      unless `DEPLOY_ENV === 'dev'`. It truncates every table, and that guard
      is the only thing standing between it and prod.

### 6.2g · Gate

- [ ] `npm run lint && npm run test:all` green; `docker compose up` still
      serves the storefront end to end.

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

- [ ] Node 22 in the image to match `.nvmrc` (today's Dockerfile says 20).
- [ ] Add `@aws-sdk/client-ssm` and `@aws-sdk/client-secrets-manager` as
      dependencies. `bookworm-slim` doesn't bundle the SDK the way the AWS
      base image does.
- [ ] `.dockerignore`: add `tests/`, `coverage/`, `postman/`, `*.md`,
      `scripts/` (the migrator doesn't need it once the seed moves),
      `eslint.config.mjs`, `vitest*.mjs`.
- [ ] `docker-compose.yml`: `build: { context: ./backend, target: api }`. The
      same image runs in compose and in Lambda. The adapter in
      `/opt/extensions` does nothing outside Lambda.
- [ ] Remember that Lambda's filesystem is read-only except `/tmp`. Nothing
      in the app writes to disk today (pino writes to stdout). Keep it that
      way.
- [ ] Local check: `docker buildx build --platform linux/arm64 --target api .`
      builds, `docker compose up` still works, and the image is under ~250 MB.
      Record the size.

Adapter environment (set on the function in 6.6, not in the image):
`AWS_LWA_PORT=5000`, `PORT=5000`, `AWS_LWA_READINESS_CHECK_PATH=/api/status`,
`AWS_LWA_INVOKE_MODE=buffered`. Readiness points at **liveness**, never at
`/api/ready`; a DB blip must not fail init.

---

## 6.4 — CI: image build + Trivy on every PR ($0)

New job(s) in `ci.yml` (or a new `image.yml`). **No AWS credentials** on PRs.

- [ ] `runs-on: ubuntu-24.04-arm`, `docker/setup-buildx-action`,
      `docker/build-push-action` with `cache-from/to: type=gha` and
      `build-args: GIT_SHA=${{ github.sha }}`. Build both targets and `load` them.
- [ ] Trivy on both images: `severity: HIGH,CRITICAL`, `exit-code: 1`,
      `ignore-unfixed: true`. Document that last choice: failing on CVEs with
      no available fix blocks every PR on something no PR can change. Keep a
      `.trivyignore` with a reason and a date on each entry.
- [ ] **Pin third-party actions by commit SHA**, not tag, starting with the
      scanner. A tag is a mutable pointer, which is the same argument as "never
      deploy `latest`".
- [ ] Add the job to the `ci` aggregate gate's `needs`.
- [ ] Push-to-ECR is **not** in this job. It needs the push role from 6.5 and
      runs only on `main` (see 6.7).

---

## 6.5 — Bootstrap additions (human-applied with admin, ~$0)

All in `terraform/bootstrap/`, applied by you via SSO, never by CI. A new
`modules/workload-roles` keeps it tidy.

### ECR (account-level, shared by every environment)

- [ ] `aws_ecr_repository "api"` and `"migrator"` (or one repo with suffixed
      tags): `image_tag_mutability = "IMMUTABLE"`, which makes "never
      overwrite a SHA tag" an AWS guarantee rather than a convention.
      `scan_on_push = true` (basic scanning is free).
- [ ] Lifecycle policy: expire untagged after 1 day; keep the last ~15 tagged.
- [ ] Repository policy allowing `lambda.amazonaws.com`
      `ecr:BatchGetImage` + `ecr:GetDownloadUrlForLayer`, conditioned on
      `aws:SourceArn` = `arn:aws:lambda:<region>:<acct>:function:dejavu-*`.
      Setting it here means the apply role never needs
      `ecr:SetRepositoryPolicy`.
- [ ] Why ECR is in bootstrap: one image is promoted dev → prod by SHA in
      Phase 7, so the repo can't belong to either environment's state.

### Push role

- [ ] `dejavu-gha-push`: trusted for `repo:Ayprusss/dejavu:ref:refs/heads/main`
      only (PRs excluded). Its only permissions are `ecr:GetAuthorizationToken`
      (`*`) and push actions on the two repos. **Why a ref-scoped trust is
      acceptable here** when Phase 5 rejected it for apply: pushing an
      immutable, SHA-tagged image deploys nothing. The deploy is the gated
      step.

### Workload role (the Lambda execution role), per environment

- [ ] `dejavu-dev-lambda`: trust `lambda.amazonaws.com`; attach
      `AWSLambdaVPCAccessExecutionRole` (ENI management + logs).
- [ ] `ssm:GetParametersByPath` / `GetParameters` on
      `parameter/dejavu/dev` and `parameter/dejavu/dev/*`.
- [ ] `secretsmanager:GetSecretValue` on `secret:rds!db-*`, conditioned on the
      secret's `aws:rds:primaryDBInstanceArn` tag equalling
      `arn:aws:rds:<region>:<acct>:db:dejavu-dev`. RDS-managed secret names
      are random, but the DB identifier is ours, so this scopes dev's role to
      dev's database without a cross-config reference. **Verify the exact tag
      key on the created secret in 6.7**, and fix the condition if it differs.
- [ ] One role serves both the API and the migrator in Phase 6. Splitting it
      is a note for Phase 7.

### RDS service-linked role

- [ ] `aws iam get-role --role-name AWSServiceRoleForRDS`. If it's missing,
      add `aws_iam_service_linked_role { aws_service_name = "rds.amazonaws.com" }`.
      If it exists, `terraform import` it or leave it out, but don't create a
      second one.

### Widen the apply role (dev), and narrow its Deny

In `modules/iam-oidc`:

- [ ] Rewrite `apply_boundary_deny` so that `iam:PassRole` + `iam:GetRole` on
      the workload role ARN survive, and **everything else in IAM is still
      denied**. IAM can't subtract actions inside one statement, so use two
      Denies: (1) `iam:*` with `not_resources = [workload role ARN]`;
      (2) every mutating action (`iam:Create*`, `Delete*`, `Put*`, `Attach*`,
      `Detach*`, `Update*`, `Tag*`, `Untag*`) on the workload role ARN itself.
      The net effect is read + PassRole on one role, and nothing else. Add a
      `Condition iam:PassedToService = lambda.amazonaws.com` on the Allow.
- [ ] Add Allows, scoped by region and by name prefix or tag wherever the
      service supports it:
  - **EC2/VPC:** create with `aws:RequestTag/Project = dejavu`, modify and
    delete with `aws:ResourceTag/Project = dejavu`; `Describe*` on `*`.
    `RunInstances` touches image, subnet, SG, ENI and volume resources, and
    only some of them take tag conditions. Expect to iterate.
  - **RDS:** instance, subnet group and parameter group on
    `…:db:dejavu-*`, `…:subgrp:dejavu-*`, `…:pg:dejavu-*`; `Describe*`.
  - **Secrets Manager (for the RDS-managed secret):** `CreateSecret`,
    `TagResource`, `RotateSecret`, `DescribeSecret`, `DeleteSecret` on
    `secret:rds!*`.
  - **Lambda:** function + function URL + permission + concurrency on
    `function:dejavu-*`.
  - **ECR:** `BatchGetImage`, `GetDownloadUrlForLayer`, `DescribeImages` on
    the two repos.
  - **Logs:** create, delete, retention and tags on
    `log-group:/aws/lambda/dejavu-*`.
  - **SSM public AMI parameter:**
    `ssm:GetParameter` on `arn:aws:ssm:<region>::parameter/aws/service/*`
    (the apply role only has `/dejavu/<env>/*` today).
- [ ] After the first successful dev apply, trim the policy with **IAM Access
      Analyzer policy generation** from CloudTrail and record the before and
      after sizes. It's a good least-privilege story.

### Budgets

- [ ] In Billing, activate the `Environment` cost-allocation tag (manual;
      takes up to 24h to appear, and isn't retroactive).
- [ ] `modules/budget`: add a `cost_filter` on `user:Environment$<env>`;
      set dev to ~$30, leave prod at $5. Also keep one **account-wide**
      backstop budget at ~$40, because some charges (parts of data transfer,
      public IPv4) don't carry your tags.

### Outputs → GitHub variables

- [ ] `AWS_PUSH_ROLE_ARN`, `ECR_API_REPO`, `ECR_MIGRATOR_REPO`, and the
      workload role ARN (consumed by `envs/dev` as a variable or a
      `data "aws_iam_role"`).

---

## 6.6 — Terraform modules ($0 until applied)

New modules, wired into **`envs/dev` only** (D6). `terraform fmt` and
`validate` stay green in the existing workflow.

### `modules/network`

- [ ] VPC `10.20.0.0/16`, DNS support and hostnames on.
- [ ] One public subnet (AZ a) for the NAT; **two private subnets (AZ a + b)**.
      An RDS subnet group requires two AZs even for a single-AZ instance.
- [ ] IGW; public route table `0.0.0.0/0 → igw`; private route table
      `0.0.0.0/0 → network_interface_id = NAT's primary ENI`.
- [ ] NAT instance: `t4g.nano`, AL2023 arm64 from the SSM public parameter,
      **`lifecycle { ignore_changes = [ami] }`**, or every new AMI release
      plans a NAT replacement. `source_dest_check = false`,
      `metadata_options { http_tokens = "required" }`, no key pair, no SSH, no
      instance profile. Use an **auto-assigned public IP, not an EIP**:
      stopping the instance then releases the address and stops the IPv4
      charge, and nothing needs the address to be stable.
- [ ] `user_data`: install `iptables-services` (AL2023 doesn't ship it), set
      `net.ipv4.ip_forward=1` persistently, and add a MASQUERADE rule on the
      **default-route interface, detected at boot**:
      `ip route | awk '/default/ {print $5}'`. On Nitro instances it's `ens5`,
      not `eth0`, and hardcoding `eth0` is the classic silent failure.
- [ ] SGs: `lambda` has no ingress; egress 443 → `0.0.0.0/0` and 5432 → `rds`.
      `rds` allows ingress 5432 **from the `lambda` SG only**. `nat` allows
      ingress 443 from the `lambda` SG and egress 443 → `0.0.0.0/0`. Stripe,
      SSM and Secrets Manager are all HTTPS, so nothing else is needed.
- [ ] **No interface VPC endpoints.** Each costs ~$7/mo per AZ. The NAT
      carries SSM, Secrets Manager and Stripe, which also means **the NAT is
      on the cold-start path**, not just the checkout path. Write that down.
- [ ] The NAT is a single-AZ SPOF. EC2 simplified automatic recovery is on by
      default for t4g, which covers host failure, and "replace it with
      `terraform apply -replace`" covers the rest. That's the failure mode
      you can articulate.

### `modules/rds`

- [ ] `postgres`, major `16` (matches CI and compose),
      `auto_minor_version_upgrade = true`, `db.t4g.micro`, 20 GB `gp3`,
      `storage_encrypted = true`, `publicly_accessible = false`,
      `multi_az = false`, identifier `dejavu-dev` (6.5's secret condition
      depends on it).
- [ ] **`manage_master_user_password = true`.** RDS creates and rotates the
      Secrets Manager secret, and the password **never enters Terraform
      state**, unlike `password = …`. This is Phase 5's "move exactly one
      secret to Secrets Manager".
- [ ] `backup_retention_period = 7` (PITR needs > 0), fixed backup and
      maintenance windows, `copy_tags_to_snapshot = true`.
- [ ] Dev: `deletion_protection = false`, `skip_final_snapshot = true`,
      `apply_immediately = true`. Parameterise all three, because prod
      inverts every one.
- [ ] Parameter group `dejavu-dev-pg16` with `rds.force_ssl = 1`, set
      explicitly even though it's the default, so it's visible in code.
- [ ] Outputs: `address`, `port`, `db_name`, `master_user_secret_arn`.

### `modules/lambda`

- [ ] `aws_lambda_function "api"`: `package_type = "Image"`,
      `architectures = ["arm64"]`, `image_uri = var.initial_image_uri`,
      **`ignore_changes = [image_uri]`** (D5), `memory_size = 512` (revisit
      after 6.9), `timeout = 15` (the 3 s default is shorter than a Stripe
      call), `vpc_config` on both private subnets and the `lambda` SG,
      execution role from 6.5.
- [ ] Environment: `NODE_ENV=production`, `DEPLOY_ENV=dev`, `PORT` and
      `AWS_LWA_*` (6.3), `PG_POOL_MAX=1`, `SSM_PARAMETER_PATH=/dejavu/dev`,
      `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_SECRET_ARN`,
      `DB_SSL_CA_PATH=/app/certs/rds-global-bundle.pem`, `CORS_ORIGINS`,
      `FRONTEND_URL`, `TRUST_PROXY` (value decided in 6.9). **No secret values
      here** (D4).
- [ ] `aws_lambda_function_url`: `authorization_type = "NONE"`,
      `invoke_mode = "BUFFERED"`, **no `cors` block**. Express already answers
      CORS, and setting both produces duplicate `Access-Control-Allow-Origin`
      headers, which browsers reject.
- [ ] Public-invoke permission for the URL. AWS has tightened what a
      Function URL with auth `NONE` needs, so verify with a plain `curl` in
      6.7: a 403 `Forbidden` with no app log line is a resource-policy
      problem, not an app problem.
- [ ] `aws_lambda_function "migrator"`: same role, subnets and SG; migrator
      image; `timeout = 300`; **no Function URL**.
- [ ] Reserved concurrency as a ceiling (say 5) so concurrency × `max: 1`
      can't approach `max_connections`, and so a flood can't run up a bill.
      **Check the account's concurrency quota first.** New accounts can be
      capped at 10, and AWS refuses any reservation that leaves fewer than 10
      unreserved.
- [ ] Outputs: `function_url`, `function_name`, `migrator_name`.

### `modules/observability`

- [ ] `aws_cloudwatch_log_group` for `/aws/lambda/dejavu-dev-api` and
      `-migrator`, `retention_in_days = 14`. Create them **before** the
      functions (`depends_on`), or Lambda auto-creates them with
      never-expire retention and Terraform then fails on "already exists".
- [ ] Alarms and SNS are Phase 7. Leave a comment saying so.

---

## 6.7 — First deploy to dev (billing starts here)

Order matters (correction 9). Do it from the branch, before merging.

1. [ ] Apply bootstrap (6.5) with SSO admin. Put the new outputs into GitHub
       variables.
2. [ ] Build and push the first images with the push role's permissions. For
       the very first push, a manual push from your machine under SSO is fine:
       `docker buildx build --platform linux/arm64 --target api --build-arg GIT_SHA=$(git rev-parse HEAD) -t <repo>:$(git rev-parse HEAD) --push .`
       (and the same for `migrator`). Then add the `main`-only push job to CI
       so later images are built by CI from a known SHA.
3. [ ] **Test the apply role before the merge does.** Run `terraform.yml` via
       `workflow_dispatch` (environment `dev`) **from this branch**. The token
       carries `environment:dev` whatever the branch, so this exercises the
       real apply role's permissions. If the `dev` GitHub environment
       restricts deployment branches, allow this branch temporarily. Expect a
       few rounds of "AccessDenied → add the action → re-run"; keep a list.
4. [ ] Put real values into SSM (test mode):
       `JWT_SECRET` (fresh, 48 random bytes), `STRIPE_SECRET_KEY` (`sk_test_…`).
       `STRIPE_WEBHOOK_SECRET` comes in 6.8.
5. [ ] Check the RDS-managed secret's tags against 6.5's condition
       (`aws secretsmanager describe-secret`).
6. [ ] `aws lambda invoke --function-name dejavu-dev-migrator --payload '{"action":"up"}' --cli-binary-format raw-in-base64-out out.json`
       → all seven migrations listed.
7. [ ] `… --payload '{"action":"seed"}'` → seeded.
8. [ ] Smoke test: `curl <url>/api/status` (200), `/api/ready` (200, which
       proves Lambda → RDS over TLS with the lazy password), `/api/version`
       (matches the SHA), `/api/products` (the seeded items).
9. [ ] **Remember that SSM values are read at cold start.** After any
       `put-parameter`, force fresh execution environments by bumping a
       harmless env var (e.g. `CONFIG_REV`) with
       `aws lambda update-function-configuration`.

Note: private RDS means no `psql` from your laptop, by design. Inspect data
through the app's own admin endpoints and CloudWatch. Session Manager port
forwarding through the NAT would need an instance profile. It's a reasonable
Phase 7+ addition, but it's an addition, not a default.

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
