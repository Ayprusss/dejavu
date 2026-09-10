# Phase 5 — Terraform + GitHub OIDC

Everything in this phase is **built, validated, and not yet applied**. It costs
**$0/month**. The first recurring AWS charge arrives in Phase 6 with RDS.

---

## Status

| | |
|---|---|
| `terraform fmt -check -recursive` | clean |
| `terraform validate` (bootstrap, envs/dev, envs/prod) | 3/3 success |
| `.github/workflows/terraform.yml` | YAML parses |
| Applied to AWS | **no — waiting on the steps below** |
| Monthly cost | **$0** |

---

## What was built

```
terraform/
  bootstrap/          Account-level, create-once. Applied by a human, never by CI.
                        - S3 state bucket (versioned, encrypted, TLS-only, prevent_destroy)
                        - GitHub OIDC provider
                        - The four CI roles (plan/apply x dev/prod)
  modules/
    iam-oidc/         One plan role + one apply role for an environment
    secrets/          SSM Parameter Store SecureString parameters
    budget/           $5 monthly budget, actual@80% + forecast@100%
  envs/dev/           Workload resources, applied by CI on merge to main
  envs/prod/          Same, behind the protected `production` environment
  README.md           Runbook and trust-boundary verification steps

.github/workflows/terraform.yml
```

### Three decisions taken beyond the original plan

**1. The CI roles live in `bootstrap/`, not in `envs/`.**
If the apply role could manage IAM, it could edit its own trust policy — and
"narrow apply role" becomes decoration. Bootstrap is applied by a human with
admin credentials, so CI can never change the shape of its own access. The apply
role additionally carries an explicit `Deny` on `iam:*`, which beats every
`Allow` in IAM evaluation and therefore acts as a ceiling rather than a
suggestion.

**2. No DynamoDB lock table.**
The original plan called for S3 + DynamoDB locking. Terraform 1.10 added
S3-native locking via `use_lockfile = true`, and 1.11 deprecated the backend's
`dynamodb_table` argument. The table is now a resource to babysit for no
benefit.

**3. The Secrets Manager split is deferred to Phase 6; Phase 5 ships all-SSM.**
The split is still the intent, but its entire justification is Secrets Manager's
native RDS integration and managed rotation — and neither exists until there is
an RDS instance. Paying $0.40/month now to hold a credential for a database that
does not exist buys a line item and nothing else. Phase 6 moves exactly one
secret, the RDS master credential, into Secrets Manager.

### On secrets and state — the honest caveat

Terraform declares **which** parameters exist and who may read them. It does not
own their **values**: each is created with a placeholder and
`ignore_changes = [value]`, and the real value is written out of band. No secret
appears in a `.tf` file, a tfvars file, a CI log, or a pull request.

But `terraform refresh` reads SecureString values back, so after the first
refresh the real values **are** in the state file. That is why the state bucket
is encrypted, versioned, TLS-only, public-access-blocked, and readable only by
the two CI roles. The clean fix is the provider's write-only `value_wo`
argument, which never persists to state — the documented upgrade path.

---

## What you need to do

Steps 1–3 must happen in order. Everything here is free.

### 1. AWS account + a temporary admin key — ~10 min

Create the account, then IAM → Users → create a user with `AdministratorAccess`,
generate an access key, and run `aws configure`.

This key is used **once**, for bootstrap, and deleted in step 6. Nothing else in
this design ever uses a static key.

### 2. Run bootstrap — ~5 min

```bash
cd terraform/bootstrap
terraform init
terraform apply          # state bucket, OIDC provider, 4 roles
terraform output         # copy these — they become GitHub variables
```

Then move bootstrap's own state into the bucket it just created:

```bash
# Uncomment the backend block in bootstrap/backend.tf, paste the bucket name
terraform init -migrate-state
```

### 3. GitHub repository variables and secret — ~5 min

Settings → Secrets and variables → Actions.

**Variables** (not secrets — they are not sensitive, and visible values make a
failed assume-role far easier to debug):

| Name | Source |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `TF_STATE_BUCKET` | `terraform output state_bucket` |
| `AWS_PLAN_ROLE_ARN_DEV` | `terraform output plan_role_arn_dev` |
| `AWS_PLAN_ROLE_ARN_PROD` | `terraform output plan_role_arn_prod` |
| `AWS_APPLY_ROLE_ARN_DEV` | `terraform output apply_role_arn_dev` |
| `AWS_APPLY_ROLE_ARN_PROD` | `terraform output apply_role_arn_prod` |

**Secret:** `BUDGET_ALERT_EMAIL` — your email. It is a secret only so it stays
out of logs on a public repo.

### 4. Create the two GitHub environments — ~3 min — **this is the one that matters**

Settings → Environments.

- **`dev`** — no protection rules.
- **`production`** — check **Required reviewers** and add yourself. Set the
  deployment branch policy to `main` only.

Without that reviewer the prod apply role is assumable by any workflow run that
names the environment. It is the entire security control — see the note at the
bottom of this file.

### 5. Set the real secret values — ~5 min

```bash
aws ssm put-parameter \
  --name /dejavu/dev/JWT_SECRET \
  --type SecureString --overwrite \
  --value "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
```

Repeat for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`. Run
`terraform output parameter_names` in `envs/dev` for the exact paths.

Confirm one landed without printing it:

```bash
aws ssm get-parameter --name /dejavu/dev/JWT_SECRET --with-decryption \
  --query 'Parameter.Value' --output text | wc -c
```

### 6. Delete the admin access key from step 1

Then open a PR touching `terraform/` and confirm the plan comment appears.

### Verifying the trust boundary

The Phase 5 exit criterion is *"`terraform plan` runs on a PR with no AWS keys in
the repo, and the role cannot be assumed from a fork."*

1. Repo settings → there is no `AWS_ACCESS_KEY_ID` anywhere.
2. PR from a branch touching `terraform/` → plan comment appears.
3. PR from a **fork** → the plan job fails to obtain a token. GitHub does not
   grant `id-token: write` to fork workflow runs, so none is minted and there is
   nothing to exchange. **This failure is the control working, not a bug.**
4. `workflow_dispatch` against prod → waits for approval, and the apply role is
   unassumable until it is given, because `environment:production` is absent
   from the token until then.

---

## What each piece actually does

**Terraform** — describes infrastructure as text files, keeps a record (*state*)
of what it has built, and computes the diff between the two. `plan` shows the
diff, `apply` executes it. The real value here is not automation: it is that
`terraform destroy` reliably removes everything, so the stack can exist for an
interview and the bill can go back to zero afterwards.

**S3 state bucket** — the record of what exists. Lose it and Terraform no longer
knows it owns your resources, so it tries to create duplicates. Hence
versioning, encryption, and `prevent_destroy`. The locking prevents two
simultaneous applies from interleaving and corrupting it.

**IAM OIDC provider** — the interesting one. Normally CI needs an AWS access key
stored as a GitHub secret: a long-lived credential sitting somewhere a human can
copy, which is exactly the failure mode Phase 0 of this project was about. OIDC
replaces it with a proof-of-identity exchange:

1. The job asks GitHub for a token. GitHub mints a short-lived, signed JWT
   describing the run — *this repo, this branch, this environment*.
2. The job presents it to AWS STS.
3. AWS validates GitHub's signature against the registered provider, checks the
   claims against the role's trust policy, and returns credentials good for one
   hour.

**There is no secret to steal, because there is no secret.** The `sub` claim is
the load-bearing part: without it you have told AWS "trust GitHub Actions",
which means anyone's GitHub Actions.

**SSM Parameter Store** — encrypted key/value config storage, free at Standard
tier. In Phase 6 the Lambda reads these at boot instead of a `.env` file, which
does not exist in Lambda anyway.

**Secrets Manager** *(Phase 6)* — the same idea plus automatic rotation and a
native RDS integration, for $0.40/secret/month. Worth paying for one secret, not
for four.

**AWS Budgets** — emails at 80% actual and 100% forecast spend. The forecast
alert is the one that catches a resource left running on a Friday.

---

## The work so far — STAR

Mapped to `dejavu-mvp-roadmap.md`. Roadmap items #1, #2a, #3 and #5 are done or
built; #2b, #4 and #6 are Phases 6–7.

### Phase 0 — Credential remediation *(prerequisite to roadmap #3)*

- **Situation** — `backend/.env` had been committed to a public GitHub repository
  since commit `6d558a1`, exposing a live Stripe secret key and a Supabase
  service-role key. `node_modules` was tracked too: 2,434 of 2,638 files, and a
  187 MB `.git`. `JWT_SECRET` had a hardcoded fallback at three call sites, so an
  unset variable meant anyone could mint an `isAdmin: true` token.
- **Task** — Revoke the exposure, remove it from history, and eliminate the class
  of defect rather than the instance.
- **Action** — Rolled both keys at the provider; purged `.env` and
  `node_modules` from all 135 commits with `git filter-repo`; enabled
  secret-scanning push protection and added a gitleaks CI job; replaced the three
  `|| 'super_secret_jwt_key'` fallbacks with a boot-time validator that throws
  listing every missing variable. Fixed two response leaks — `error.stack` in a
  500 body and a raw user row including `passwordHash`.
- **Result** — No live credential in the working tree or history; tracked files
  fell from 2,638 to ~200. The API now refuses to boot without a real
  `JWT_SECRET`, asserted by a CI job rather than by convention.

### Phase 1 — Test suite + CI gate *(roadmap #1)*

- **Situation** — A payment-handling codebase with zero tests, zero CI, and no
  backend linter. `npm test` was the default stub that exits 1.
- **Task** — Establish a green gate on `main`, and test the logic that would
  survive the planned data-layer rewrite so none of it was throwaway work.
- **Action** — Vitest and Supertest across both workspaces. A table-driven
  `describe.each` covering the authorization boundary once rather than per route:
  missing header, malformed scheme, expired token, wrong-secret token, and a
  valid **non-admin** JWT against an admin route. Float-to-cents price
  arithmetic, and a test locking in that a client-supplied `price` field is
  ignored. GitHub Actions running lint, a Node 20/22 backend matrix, frontend
  tests and build, gitleaks, and a boot-check job, behind one aggregate status
  check so adding a job never means editing the branch-protection rule.
- **Result** — Red CI blocks merge on `main`. Coverage is reported via v8 and
  deliberately **not** gated on a number — chasing a percentage on a codebase
  this size produces tests written to touch lines rather than to catch bugs.

### Phase 2 — Postgres data layer + versioned migrations *(roadmap #2, non-AWS half)*

- **Situation** — 20 `supabase.from(...)` call sites spread across 6 controllers,
  no transactions available anywhere, and an orphaned `pg_dump` as the only
  record of the schema.
- **Task** — Replace the BaaS client with `pg` and turn the schema into
  versioned, reversible migrations — the prerequisite for any correctness work.
- **Action** — Seven numbered `node-pg-migrate` migrations, including dropping a
  UNIQUE constraint that made any multi-size product unseedable, adding
  `NOT NULL` + `CHECK ("stock" >= 0)`, a `StripeEvent` idempotency table, and a
  case-insensitive email index. Introduced `db/pool.js`, `db/withTransaction.js`,
  and repositories that take an **executor** as their first argument, so any
  query can run standalone or join a caller's transaction.
- **Result** — Zero Supabase imports; migrations verified `up → down 0 → up`
  against `postgres:16-alpine`. Two latent bugs fixed as a side effect of the
  driver change: `numeric` arriving as a string (which would have crashed the
  account page on `toFixed`), and `shippingAddress` stored as a JSON string
  scalar so `order.shippingAddress.city` read back `undefined`.

### Phase 3 — Webhook and checkout correctness *(roadmap #5, substance)*

- **Situation** — The webhook made `1 + 2N` independent round-trips with no
  transaction and no compensating rollback. A crash midway left a `PAID` order
  with partial items and partial stock — and because the order row then existed,
  every retry hit the idempotency check and skipped, cementing it permanently.
  Stock was read-modify-write. Registration claimed **every** past guest order
  matching an email string, so anyone who knew a buyer's address could inherit
  their order history and shipping addresses.
- **Task** — Make each of those scale-independent correctness properties hold.
- **Action** — One transaction covering the event claim, the order, its items and
  every stock decrement. Idempotency via `INSERT ... ON CONFLICT DO NOTHING` on
  the Stripe event id **inside** that transaction, so a rollback releases the
  claim and the delivery stays retryable. Stock via
  `UPDATE ... WHERE stock >= $n RETURNING` — zero rows means oversell, abort.
  Replaced automatic email-based order linking with an explicit claim on
  `stripeSessionId`, which only the actual buyer has. Added helmet, rate limits
  on login and checkout, centralized error handling, graceful shutdown, and split
  liveness (`/api/status`) from readiness (`/api/ready`).
- **Result** — Response semantics now distinguish retryable from deterministic
  failure: 400 for a bad signature, 200 for duplicate, unhandled and oversell,
  500 **only** where redelivery can help. A bounded pino error serializer took a
  single connection blip from several kilobytes on one line to 392 characters —
  at CloudWatch ingest rates, the difference between a log and a bill.

### Phase 4 — Integration against real dependencies *(roadmap #5)*

- **Situation** — Every correctness claim from Phase 3 was argued for, not
  demonstrated.
- **Task** — Prove idempotency and no-oversell against a real database, and prove
  the tests themselves are capable of failing.
- **Action** — 49 integration tests over Postgres service containers, isolated by
  `TRUNCATE ... RESTART IDENTITY CASCADE`, with a `globalSetup` that applies the
  same seven migrations the app ships and refuses to run against any non-local
  host. Webhook payloads are signed with
  `stripe.webhooks.generateTestHeaderString`, so `constructEvent` runs for real
  with no network. Added a barrier to the Stripe stub that holds every delivery
  until all have arrived — `Promise.all` alone lets each transaction finish
  before the next opens — and a `concurrency.test.js` driving two explicit
  connections that commits the first only once the second is provably blocked on
  its lock.
- **Result** — 49/49 green from a fresh database, gated in CI on every PR.
  Mutation-verified: reverting the atomic decrement to read-modify-write fails 3
  tests; reverting the event claim to read-then-write fails 1.
  **Correction found this session:** the execution plan claimed 7 and 2. The
  webhook suite's own concurrent-replay test also only catches the event-claim
  regression when run in isolation — `concurrency.test.js` is what actually holds
  that line. Recorded at the top of `README.md` for the next pass.

### Phase 5 — Terraform + GitHub OIDC *(roadmap #3)*

- **Situation** — Phase 0 turned "any credential a human can copy will eventually
  leak" from a slogan into a lived conclusion. The AWS footprint did not exist
  yet, and nothing had been provisioned by hand that Terraform would later need
  to own.
- **Task** — Codify the footprint and give CI an identity, with no static AWS key
  anywhere and no spend before Phase 6.
- **Action** — Split Terraform into a human-applied `bootstrap/` (state bucket,
  OIDC provider, four CI roles) and CI-applied `envs/`, so the apply role cannot
  edit its own trust policy — reinforced with an explicit `Deny` on `iam:*`.
  Apply roles trust `sub = repo:Ayprusss/dejavu:environment:production` rather
  than a branch ref, because a ref-scoped role is assumable by any workflow a
  merged PR adds. A read-only plan role posts a plan comment on every PR; apply
  runs behind a protected environment. Dropped DynamoDB locking in favour of
  S3-native `use_lockfile`.
- **Result** — `fmt -check` clean, all three configurations validate, and the
  monthly cost stays **$0**, because the Secrets Manager split was deferred to
  where rotation is actually used. Not yet applied — awaiting the AWS account and
  GitHub environment setup above.

---

## Tech used in this epic

### Application
| | |
|---|---|
| **Frontend** | React 19, Vite, React Router v7, React Compiler (`babel-plugin-react-compiler`) |
| **Backend** | Node.js 20/22, Express 5 (CommonJS), `jsonwebtoken`, `bcrypt`, `uuid` |
| **Payments** | Stripe SDK, Stripe Checkout, Stripe webhooks + signature verification, Stripe CLI |
| **Hardening** | `helmet`, `express-rate-limit`, centralized error middleware, `trust proxy` |
| **Logging** | `pino` + `pino-http`, structured JSON, stable dotted event keys, bounded error serializer |

### Data
| | |
|---|---|
| **Database** | PostgreSQL 16 |
| **Driver / access** | `pg` with an explicit `Pool`, custom `numeric` type parser, `withTransaction` helper, executor-first repositories |
| **Migrations** | `node-pg-migrate` — 7 reversible SQL migrations |
| **Postgres features** | `jsonb`, `CHECK` constraints, `NOT NULL`, partial/functional unique indexes (`lower(email)`), `BEFORE UPDATE` triggers, `INSERT ... ON CONFLICT DO NOTHING`, conditional `UPDATE ... WHERE stock >= $n RETURNING`, row-level locking, `TRUNCATE ... RESTART IDENTITY CASCADE` |

### Testing
| | |
|---|---|
| **Runners** | Vitest (separate unit and integration projects), Supertest |
| **Coverage** | `@vitest/coverage-v8` — reported, not gated |
| **Techniques** | Table-driven `describe.each`, locally signed webhook fixtures, barrier-synchronized concurrency stubs, two-connection lock tests, manual mutation testing |
| **Infrastructure** | GitHub Actions service containers (real Postgres, not mocked) |

### CI/CD
| | |
|---|---|
| **Platform** | GitHub Actions — `actions/checkout`, `setup-node`, `upload-artifact`, `github-script`, `hashicorp/setup-terraform`, `aws-actions/configure-aws-credentials` |
| **Gating** | Branch protection on `main`, single aggregate status check, concurrency groups |
| **Secret hygiene** | gitleaks, GitHub secret-scanning push protection, `git filter-repo` |
| **Quality** | ESLint 9 flat config, Prettier, Node 20/22 matrix, npm caching |

### Infrastructure as code
| | |
|---|---|
| **IaC** | Terraform 1.11, `hashicorp/aws` provider, reusable modules, `envs/` split, partial backend config |
| **State** | S3 backend — versioned, SSE, TLS-only, public-access-blocked — with S3-native `use_lockfile` locking |
| **Identity** | GitHub OIDC federation, `aws_iam_openid_connect_provider`, `sts:AssumeRoleWithWebIdentity`, `aws_iam_policy_document`, `sub`/`aud` claim conditions, explicit `Deny` ceilings |
| **AWS services** | IAM, S3, SSM Parameter Store (SecureString), KMS (`kms:ViaService` conditions), AWS Budgets |

### Tooling
Docker, Docker Compose, `postgres:16-alpine`, Git, GitHub PRs.

### Planned — Phases 6–7
AWS RDS, Lambda Web Adapter, ECR, Secrets Manager, CloudWatch (logs, metric
filters, alarms), SNS, NAT instance, Trivy, `bcryptjs`, Lambda aliases for
rollback.

---

## The dependency that is easy to miss

GitHub **environment protection rules are free on public repositories and a paid
feature on private ones.**

If this repository is ever made private on a Free plan, the protection rules stop
applying — but GitHub still stamps `environment:production` into the OIDC token,
so the trust policy still matches, and the apply role becomes assumable from any
workflow run that merely names the environment. The control fails open,
silently, while the Terraform still reads as though it were enforced.

Staying public is therefore a **security** decision, not just a billing one. If
the repo goes private, GitHub Pro is not optional.
