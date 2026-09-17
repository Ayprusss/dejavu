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

## Database secret rotation (exercised in 6.10)

RDS rotates the master password itself, every 7 days, in the
`rds!db-…` secret. The app never needs a redeploy for it:
`src/db/credentials.js` caches the password for 5 minutes, and `pool.js`
calls `invalidate()` on a `28P01`. Measured against two real `rotate-secret`
runs:

- A connection that is **already open** survives the rotation. 1,078
  requests over ~12 minutes of continuous traffic, zero errors.
- A **new** connection opened while the old password is still cached fails
  once (`/api/ready` → 503, `28P01`) and the very next request recovers.
  That happens to a warm environment idle for >30 s (the pool's idle timeout
  fires on thaw) whose password was fetched <5 min before the rotation.
- A rotation takes ~70 s. When it finishes, `AWSPENDING` stays attached to
  the same version as `AWSCURRENT`. That is normal, not a stuck rotation.

## Restoring the database to a point in time (drilled in 6.11)

Performed once against dev on 2026-09-16. The timestamps below are the real
ones.

### Runbook

1. **Pick the restore time** in UTC: after the last good write, before the
   bad one. It has to be ≤ `LatestRestorableTime`, which ran about **6-7
   minutes** behind the wall clock:
   ```bash
   aws rds describe-db-instances --db-instance-identifier dejavu-dev \
     --query 'DBInstances[0].LatestRestorableTime'
   ```
2. **Restore into a new instance.** PITR never rewinds the source in place.
   Pass the network explicitly: leave out the subnet group or security group
   and the copy lands in the default VPC/SG, where the Lambda can't reach it.
   Leave out the parameter group and you lose `rds.force_ssl`.
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier dejavu-dev \
     --target-db-instance-identifier dejavu-dev-restore \
     --restore-time 2026-09-16T20:50:00Z \
     --db-subnet-group-name dejavu-dev \
     --vpc-security-group-ids <rds SG id, `dejavu-dev-rds`> \
     --db-parameter-group-name dejavu-dev-pg16 \
     --db-instance-class db.t4g.micro \
     --no-publicly-accessible --no-multi-az --no-deletion-protection \
     --tags Key=Project,Value=dejavu Key=Environment,Value=dev Key=Purpose,Value=pitr-drill
   ```
   The tags are not inherited unless you ask; `Environment` is what the dev
   budget's cost filter matches on.
3. **Wait for `available`.** In the drill that took **37 min 43 s**: `creating`
   13 min → `backing-up` **22 min** → `modifying` 1 min → `available`. The
   long backup is because the restore inherits the source's backup retention
   (1 day), and RDS takes a fresh backup of the new instance before calling it
   available. Budget ~40 minutes, not ~10.
4. **Point the API at it.** Change `DB_HOST` only. `update-function-configuration`
   replaces the **whole** environment map, so save the current map first and
   send it back with one key changed:
   ```bash
   aws lambda get-function-configuration --function-name dejavu-dev-api \
     --query Environment > env-original.json
   # write env-swapped.json = same map, DB_HOST=<restored endpoint>
   aws lambda update-function-configuration --function-name dejavu-dev-api \
     --environment file://env-swapped.json
   aws lambda wait function-updated-v2 --function-name dejavu-dev-api
   ```
   Each config change is a cold start (~0.8-1.0 s `Init Duration` in the
   drill).
5. **Verify the data** through the app (no `psql`, since RDS is private), then
   **point it home** with `--environment file://env-original.json`, and diff
   the live map against the saved one.
6. **Delete the copy** (it bills while it exists):
   ```bash
   aws rds delete-db-instance --db-instance-identifier dejavu-dev-restore \
     --skip-final-snapshot --delete-automated-backups
   ```
   The instance disappeared ~1.5 min after the call, but its automated
   snapshot (`rds:dejavu-dev-restore-…`, from the `backing-up` phase) was
   still listed for another ~50 s before `--delete-automated-backups` cleared
   it. Re-check `describe-db-snapshots` a minute later before assuming a
   leftover.

For a real recovery rather than a drill, the choice at step 5 is between
pointing the app at the restored instance for good (then bring it under
Terraform with `terraform import`, or rename instances so the `dejavu-dev`
identifier refers to it) and copying the lost rows back into the source.
Neither was drilled.

### What the drill showed

- **Marker:** product created via the admin API at 20:48:33Z, name
  overwritten at 20:52:02Z (no delete endpoint exists; an overwrite is the
  same test). Restored to 20:50:00Z. Through the restored instance the API
  returned the original name and the original `updatedAt`; pointed home, it
  returned the overwritten one again.
- **Credentials:** the restored instance has **no managed secret**
  (`MasterUserSecret: null`). It didn't need one: the password lives in the
  database's own data, so the copy has whichever password was current at the
  restore time, and the source's `DB_SECRET_ARN` still held that one (the
  last rotation before the restore point was 20:42:52Z, and none came after
  it). `/api/ready` returned 200 with no credential change at all.
  **Not drilled, but follows from that:** restore to a time *before* a later
  rotation, and the source secret's `AWSCURRENT` no longer matches. Then
  either read `AWSPREVIOUS` (it only goes one rotation back), or run
  `modify-db-instance --manage-master-user-password` on the copy. That new
  secret's `aws:rds:primaryDBInstanceArn` tag names the *restored* instance,
  so `dejavu-dev-lambda`'s policy (scoped to `db:dejavu-dev`) can't read it
  until the policy is widened in `bootstrap/`.
- **Outside Terraform state.** Terraform never learns the restored instance
  exists: `plan` doesn't show it, and `destroy` would not remove it. Tag it,
  and delete it by hand.
- **Cost:** the copy existed from 20:54:50Z to ~23:15Z, about 2.4 h of
  `db.t4g.micro` plus 20 GB gp3. At on-demand rates that is **~$0.05**. Checked
  against Cost Explorer in 6.12.
- **Permissions note:** the swap in step 4 was run by a human. The agent's
  auto-mode classifier blocks changes to the live function's configuration,
  as it should.

## Tearing dev down and bringing it back (drilled in 6.12)

The cost story is "destroy after a demo, apply before an interview". Done
once on 2026-09-16/17; the numbers below are real.

### Destroy (~20 min)

```bash
cd terraform/envs/dev
export TF_VAR_budget_notification_email=...   # same value CI uses
terraform destroy \
  -target=module.lambda -target=module.rds \
  -target=module.network -target=module.observability
```

- **Always targeted.** It removes 28 resources and keeps the three SSM
  parameters (their real values) and the budget. A plain `terraform destroy`
  is refused on purpose: `modules/secrets` sets `prevent_destroy`, because
  destroying the parameters would lose every secret and the next apply would
  only bring back placeholders.
- **20 min 23 s**, and nearly all of it is waiting. The functions go in 6 s,
  RDS in ~2 min, the NAT in 40 s; then the private subnets (~18 min) and the
  `lambda` security group (**20 min**) wait for Lambda's Hyperplane ENIs to
  be released. Don't cancel it.
- Log groups go with it, so earlier Lambda logs are gone.

### Re-apply (~13 min to a verified webhook)

```bash
terraform apply -var initial_image_tag=<migrator tag live before the destroy>
aws lambda update-function-code --function-name dejavu-dev-api \
  --image-uri <ecr>/dejavu-api:<api tag live before the destroy>
aws lambda invoke --function-name dejavu-dev-migrator \
  --cli-binary-format raw-in-base64-out --payload '{"action":"up"}' out.json
aws lambda invoke --function-name dejavu-dev-migrator \
  --cli-binary-format raw-in-base64-out --payload '{"action":"seed"}' out.json
# smoke: /api/status /api/ready /api/version /api/products
```

- **Pass the image tag.** The default, `bootstrap`, is the first image ever
  pushed and predates later fixes. Terraform only uses the tag on create
  (D5), so record the live tags (`aws lambda get-function --query
  Code.ImageUri`) **before** destroying. CI's apply passes no tag, so a
  re-create driven from CI comes back on `bootstrap`.
- **Timings:** apply 12m30s (RDS 8m32s; both functions 3m44s, since VPC
  functions wait for their ENIs on create too); code deploy, migrate, seed
  and smoke ~20 s. With the webhook stage below: **~13 min 11 s** from zero
  to a verified webhook.

**The Function URL changes on every re-create**, so two things outside AWS
have to follow it:

1. **Stripe:** update the existing endpoint's URL instead of creating a new
   one. That keeps its signing secret, so `STRIPE_WEBHOOK_SECRET` in SSM
   stays valid:
   ```bash
   stripe webhook_endpoints update <we_…> --url <new url>/api/webhooks/stripe
   stripe trigger checkout.session.completed   # expect order.created, no signature_invalid
   ```
   The CLI's key expires; `stripe login` into the same test environment
   first. (It prints a "Running in …" banner on **stderr**, so don't
   capture `2>&1` into anything you parse as JSON.)
2. **Vercel:** reset `VITE_API_URL` for production to the new URL (no
   trailing slash; it's inlined at build time), then `vercel --prod`.

A stable hostname in front of the function (CloudFront or a custom domain)
would make both of those unnecessary.

### Stopping instead of destroying (documented, not drilled)

Stopping RDS (`aws rds stop-db-instance`) and the NAT instance (`aws ec2
stop-instances`) leaves only storage billing (~$3/month) and avoids the
20-minute destroy and the URL change. Two catches:

- **RDS starts itself again after 7 days** and resumes billing silently.
- **With the NAT stopped, every Lambda cold start fails.** The SSM fetch at
  boot has no route out (no VPC endpoints). Stop both or neither. The NAT's
  auto-assigned public IP changes on restart; nothing depends on it.

## The dependency nobody writes down

Environment protection rules are **free on public repositories** and a **paid
feature on private ones**. If this repository is ever made private on a Free
plan, the protection rules stop applying — but GitHub still stamps
`environment:production` into the OIDC token, so the trust policy still matches
and the apply role becomes assumable from any workflow run that names the
environment. The security control fails open, silently, while the Terraform
still reads as though it were enforced.

If the repo goes private, GitHub Pro is not optional.
