# Terraform — Phase 5

Infrastructure as code for Dejavu, plus the GitHub Actions identity that
applies it. **Nothing in here costs money.** The first recurring charge arrives
in Phase 6 with RDS.

## Layout

```
bootstrap/          Account-level, create-once. Applied by a human, never by CI.
                      - S3 state bucket (versioned, encrypted, TLS-only)
                      - GitHub OIDC provider
                      - The four CI roles (plan/apply x dev/prod)

modules/
  iam-oidc/         One plan role + one apply role for an environment
  secrets/          SSM Parameter Store SecureString parameters
  budget/           $5 monthly budget with actual + forecast alerts

envs/dev/           Workload resources, applied by CI
envs/prod/          Same, behind the protected `production` environment
```

## Why the IAM roles live in `bootstrap/` and not in `envs/`

Because the apply role would otherwise be able to edit its own trust policy and
permissions. A role that can grant itself more is not a narrow role, however
narrow the policy document reads. Bootstrap is applied by a human with admin
credentials; CI can never change the shape of its own access.

## Why there is no DynamoDB table

The original plan called for S3 + DynamoDB state locking. Terraform 1.10 added
S3-native locking via `use_lockfile = true`, and 1.11 deprecated the backend's
`dynamodb_table` argument. The table is now a resource to pay attention to for
no benefit.

## Secrets: what Terraform owns and what it does not

Terraform declares **which** parameters exist, where, and who may read them. It
does not own their **values** — each is created with a placeholder and
`ignore_changes = [value]`, and the real value is written out of band with
`aws ssm put-parameter --overwrite`. No secret ever appears in a `.tf` file, a
tfvars file, a CI log, or a pull request.

The honest caveat: `terraform refresh` reads SecureString values back, so after
the first refresh the real values *are* in the state file. That is why the state
bucket is encrypted, versioned, TLS-only, public-access-blocked, and readable
only by the two CI roles. The clean fix is the provider's write-only `value_wo`
argument, which never persists to state — the upgrade path once pinned to a
provider version that has it.

## First-time setup

Run once, locally, with admin credentials:

```bash
cd terraform/bootstrap
terraform init
terraform apply

# Note the outputs — they become GitHub repository variables.
terraform output
```

Then move bootstrap's own state into the bucket it just created:

```bash
# Uncomment the backend block in bootstrap/backend.tf, fill in the bucket name
terraform init -migrate-state
```

Per environment:

```bash
cd terraform/envs/dev
cp backend.hcl.example backend.hcl     # gitignored; fill in the bucket name
terraform init -backend-config=backend.hcl
TF_VAR_budget_notification_email=you@example.com terraform plan
```

## Setting a secret's real value

```bash
aws ssm put-parameter \
  --name /dejavu/dev/JWT_SECRET \
  --type SecureString \
  --overwrite \
  --value "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
```

Confirm without printing it:

```bash
aws ssm get-parameter --name /dejavu/dev/JWT_SECRET --with-decryption \
  --query 'Parameter.Value' --output text | wc -c
```

## Verifying the OIDC trust boundary

The Phase 5 exit criterion is "`terraform plan` runs on a PR with no AWS keys in
the repo, and the role cannot be assumed from a fork."

1. `gh secret list` / repo settings → there is no `AWS_ACCESS_KEY_ID` anywhere.
2. Open a PR touching `terraform/` from a branch → the plan comment appears.
3. Open a PR from a **fork** → the `plan` job fails to obtain a token. GitHub
   does not grant `id-token: write` to fork workflow runs, so no token is
   minted and there is nothing to exchange. This failure is the control
   working, not a bug.
4. Try `workflow_dispatch` against prod as a non-reviewer → it waits for
   approval, and the apply role is unassumable until approval is given, because
   `environment:production` is absent from the token until then.

## Phase 6 runtime numbers (dev, measured in 6.9)

Cold start `Init Duration` p50 **≈1159 ms** over 11 forced cold starts (range
777–1543 ms), of which `boot.secrets_loaded` (the SSM fetch) is p50 **≈221
ms** — about 19% of the total, the rest being Node startup, module load, and
the Lambda Web Adapter's own init. No provisioned concurrency.

`bcrypt.compare` on `POST /api/auth/login`, warm, against a real user (a
nonexistent email short-circuits before ever calling bcrypt — measure against
one that exists): **512 MB p50 ≈513 ms**, **1024 MB p50 ≈332 ms** (~35%
faster). Not quite cost-neutral: 512 MB costs ~0.26 GB-s per call and 1024 MB
~0.33 GB-s, about 29% more for the faster response. Deployed dev stays at the
Terraform-declared 512 MB; bumping it is a product call, not made here.

A 20-concurrent burst against `/api/products` returned exactly 10× `200` and
10× `429`, matching this account's 10-execution Lambda concurrency ceiling
(see `../phase-6-steps.md` 6.6 on reserved concurrency). `RDS
DatabaseConnections` peaked at 2 during the burst (`PG_POOL_MAX=1`), nowhere
close to a risky level.

**`TRUST_PROXY` stays `0`, confirmed by experiment, not left as a guess.**
This Function URL has no CloudFront or ALB in front of it, and the Lambda Web
Adapter does not sanitize `X-Forwarded-For` — a client-supplied header
reaches Express completely unmodified. Any nonzero trust-proxy value would
make that header authoritative, letting one caller mint a fresh rate-limit
bucket per request for the price of one header. The real source IP does
reach the app, just not through Express's trust-proxy mechanism: it's in the
`x-amzn-request-context` header's `http.sourceIp` field, which AWS sets from
the actual Lambda event and overwrites regardless of what a caller sends
(`backend/src/lib/clientIp.js` reads it directly; both rate limiters key on
it instead of `req.ip`).

## The dependency nobody writes down

Environment protection rules are **free on public repositories** and a **paid
feature on private ones**. If this repository is ever made private on a Free
plan, the protection rules stop applying — but GitHub still stamps
`environment:production` into the OIDC token, so the trust policy still matches
and the apply role becomes assumable from any workflow run that names the
environment. The security control fails open, silently, while the Terraform
still reads as though it were enforced.

If the repo goes private, GitHub Pro is not optional.
