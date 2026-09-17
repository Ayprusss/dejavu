# Phase 7 — Runbook: from code-complete to signed off

`phase-7-steps.md` explains the *why*. This file is the *what to type, in what
order* for everything the agents couldn't do. Every step here touches a live
system (AWS, GitHub, Stripe or Vercel), so each one is run by you.

**Where things stand (2026-09-17):** all code-only work for 7.0, 7.2–7.7 and
7.9 is merged on the local branch `phase-7-cd`, which isn't pushed yet. On the
combined branch: backend lint and format check clean, 93 unit tests, 53
integration tests, frontend lint clean, 55 tests and a green build, Terraform
fmt/validate on bootstrap, dev and prod, actionlint, shellcheck, and 21/21
cases in the deploy-script harness. None of it has run against AWS yet.

Tracking issues: #7 (7.0), #9 (7.2), #10 (7.3), #11 (7.4), #12 (7.5),
#13 (7.6), #14 (7.7), #15 (7.8), #16 (7.9), #17 (7.10), #18 (7.11),
#19 (7.12).

---

## The order, at a glance

| # | Stage | Why it's in this position |
|---|---|---|
| 0 | Phase 6 leftovers (7.0) | Cost numbers feed the prod decision |
| 1 | GitHub secret `ALARM_EMAIL` | Every Terraform plan fails without it |
| 2 | Bootstrap apply + 3 GitHub variables | The apply role can't create aliases or alarms, and the deploy roles don't exist, until this runs |
| 3 | Push `phase-7-cd`, open the PR | CI on a real runner, plan comments for dev and prod |
| 4 | Apply dev **from the branch** | Prove the alias, alarms and pipeline before merging, the way 6.7 did |
| 5 | Follow the new URL: Stripe, Vercel | The alias gives the API a new URL |
| 6 | Verify alarms and the pipeline on dev | Metrics, filters and email routing are all still unproven |
| 7 | Merge | First hands-off dev deploy. **Reject the prod approval** (prod doesn't exist yet) |
| 8 | Stand up prod (7.8) | Prod billing starts |
| 9 | Prod data, Stripe, frontend (7.9) | |
| 10 | Checkpoint drill (7.10) | The phase's gate |
| 11 | Docs, sign-off, teardown (7.11, 7.12) | |

Conventions below: run from the repo root in Git Bash unless it says otherwise.
`AWS_REGION` is `us-east-1`. Commands that need admin credentials say so.

---

## Stage 0 — Phase 6 leftovers (issue #7)

Nothing here blocks stage 1, but do the cost check before stage 8.

**48-hour Cost Explorer check**

```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-09-01,End=2026-09-17 \
  --granularity DAILY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[].{day:TimePeriod.Start,groups:Groups[?Metrics.UnblendedCost.Amount!=`0`]}'
```

Put the real figures in `phase-6-steps.md`'s Cost section and in the execution
plan's cost table. Watch for anything nonzero from RDS, EC2 (NAT) or the
public IPv4 address. On the Free plan those should still be $0 while only dev
runs.

**Trim the dev apply role (optional).** Use the IAM console → Roles → the dev
apply role → *Generate policy* from CloudTrail over the Phase 6 apply window.
Write down the before and after statement counts in 7.0. Only change
`modules/iam-oidc` if the generated policy is clearly smaller, and apply it in
stage 2 together with the rest of bootstrap.

**Storefront click-through on dev.** Do it now, on the *current* URL, so there's
a known-good baseline before anything changes. Browse → add to cart → test
card `4242 4242 4242 4242` → success page → the order shows in admin.

---

## Stage 1 — `ALARM_EMAIL` secret

`envs/dev` now requires `alarm_email` with no default, and `terraform.yml`
passes it from this secret. Without it, the plan on the PR fails.

```bash
gh secret set ALARM_EMAIL --body "you@example.com"
```

---

## Stage 2 — Bootstrap apply (issue #10), with admin credentials

This creates `dejavu-gha-deploy-dev`, `dejavu-gha-deploy-prod` and
`dejavu-prod-lambda`. It widens both apply roles for aliases, SNS, alarms and
metric filters, and raises prod's apply role to dev's level.

```bash
git checkout phase-7-cd
cd terraform/bootstrap
terraform init            # backend already migrated in Phase 5
terraform plan            # expect: new roles/policies, in-place policy updates, 0 destroyed
terraform apply
```

Read the plan before applying. **Nothing should be destroyed.** If it shows the
state bucket, the OIDC provider or an ECR repository being replaced, stop.

Then set the new variables from the outputs:

```bash
gh variable set AWS_DEPLOY_ROLE_ARN_DEV    --body "$(terraform output -raw deploy_role_arn_dev)"
gh variable set AWS_DEPLOY_ROLE_ARN_PROD   --body "$(terraform output -raw deploy_role_arn_prod)"
gh variable set AWS_WORKLOAD_ROLE_ARN_PROD --body "$(terraform output -raw workload_role_arn_prod)"
cd ../..
```

**Check that the deploy role can't delete the function itself** (7.3's
unchecked Verify). The role only trusts GitHub OIDC, so you can't assume it
from a laptop. The IAM policy simulator evaluates its policies without
assuming it:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn "$(terraform -chdir=terraform/bootstrap output -raw deploy_role_arn_dev)" \
  --action-names lambda:DeleteFunction \
  --resource-arns \
    "arn:aws:lambda:us-east-1:059317926288:function:dejavu-dev-api" \
    "arn:aws:lambda:us-east-1:059317926288:function:dejavu-dev-api:7" \
  --query 'EvaluationResults[].[EvalResourceName,EvalDecision]' --output table
```

Expected: the unqualified ARN is `explicitDeny` and the `:7` version is
`allowed`.

---

## Stage 3 — Push and open the PR

```bash
git push -u origin phase-7-cd
gh pr create --base main --head phase-7-cd \
  --title "Phase 7: staging -> prod CD with rollback" \
  --body "Phase 7 code: Lambda alias + qualified URL, deploy/prod IAM, deploy scripts, deploy.yml, migration-safety guard, alarms, grant-admin. Plan: phase-7-steps.md. Runbook: phase-7-runbook.md."
```

What to check on the PR:

- **`ci`** is green, including the new steps:
  - `lint (backend)` runs shellcheck and the deploy-script harness (21 cases)
  - `migrations` runs the expand/contract guard
- **Terraform plan comment for `dev`:**
  - adds `aws_lambda_alias.api_live`, the second permission, the SNS topic,
    its subscription, 6 alarms and 3 metric filters
  - replaces the Function URL, because of the qualifier
  - **destroys nothing else**
- **Terraform plan comment for `prod`:** still Phase 5 shape, only the budget
  and secrets. Prod's modules come in stage 8.

If the dev plan fails with `AccessDenied`, the apply role is missing an
action. Fix it in `modules/iam-oidc`, re-apply bootstrap (stage 2), and push.
Expect this at least once, as in 6.7.

---

## Stage 4 — Apply dev from the branch (issues #9, #14)

The same approach as 6.7: dispatch the apply from the branch, so the merge
itself should be a no-op.

**Before you start, record the current URL and the live image**. The URL is
about to change:

```bash
OLD_URL=$(aws lambda get-function-url-config --function-name dejavu-dev-api --query FunctionUrl --output text)
aws lambda get-function --function-name dejavu-dev-api --query Code.ImageUri --output text
curl -s "${OLD_URL%/}/api/version"
```

**Dispatch the apply:**

```bash
gh workflow run terraform.yml --ref phase-7-cd -f environment=dev
gh run watch "$(gh run list --workflow terraform.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

What the run does, in order:

1. `plan -detailed-exitcode` → changes present
2. apply: the alias on `$LATEST`, the new URL, the permissions, SNS and alarms
3. **republish** (correction 2): it reads `/api/version` from the new URL,
   assumes the deploy role, and runs `deploy.sh dev <that sha>`. Because the
   alias starts on `$LATEST`, the first thing `deploy.sh` does is publish the
   current code and pin `live` to it.

Things that can go wrong here, and what they mean:

| Symptom | Meaning |
|---|---|
| `AccessDenied` during apply | Apply role gap. Fix in `modules/iam-oidc`, then re-run stage 2 |
| Republish can't assume the deploy role | Stage 2's variables not set, or the trust `sub` doesn't match `environment:dev` |
| Republish: `rollback target ... is no longer in ECR` | The live image (`57c6892`, hand-pushed in 6.12) was expired by the lifecycle policy. Deploy a known SHA with stage 6's dispatch instead |
| `curl` to the new URL → **403** | The second permission statement (`InvokeFunction` + `InvokedViaFunctionUrl`) is wrong or missing. That's 7.2's open Verify |

**Verify (7.2's open items):**

```bash
NEW_URL=$(aws lambda get-function-url-config --function-name dejavu-dev-api --qualifier live --query FunctionUrl --output text)
curl -s "${NEW_URL%/}/api/version"                       # same sha as before
curl -s -o /dev/null -w '%{http_code}\n' "${NEW_URL%/}/api/products"   # 200
aws lambda get-alias --function-name dejavu-dev-api --name live --query FunctionVersion   # a number, not $LATEST
curl -s -o /dev/null -w '%{http_code}\n' "${OLD_URL%/}/api/status"     # 403 or 404: the unqualified URL is gone
```

Tick the 7.2 checkboxes, and record whether the second permission turned out
to be required. The experiment: delete that statement by hand, `curl`, then
put it back with `terraform apply`.

---

## Stage 5 — Point Stripe and Vercel at the new URL

The same chore as 6.12, done once more because of the alias.

**Stripe.** Update the existing endpoint in place, so the signing secret and SSM
don't change:

```bash
stripe login                                   # the CLI key expires after ~90 days
stripe webhook_endpoints list                  # find the we_… that points at OLD_URL
stripe webhook_endpoints update we_XXXX --url "${NEW_URL%/}/api/webhooks/stripe"
stripe trigger checkout.session.completed
```

Then check the logs: one `order.created`, and no `webhook.signature_invalid`.
That re-proves the raw-body path through the alias:

```bash
aws logs tail /aws/lambda/dejavu-dev-api --since 5m --format short | grep -E 'order.created|signature_invalid'
```

**Vercel** (from `dejavu/`):

```bash
cd dejavu
vercel env rm VITE_API_URL production -y
printf '%s' "${NEW_URL%/}" | vercel env add VITE_API_URL production    # no trailing slash
vercel --prod
cd ..
```

Open `https://dejavu-seven.vercel.app/pages/shop` and confirm products load
with no CORS error.

---

## Stage 6 — Verify alarms and the pipeline on dev

### SNS email (7.7)

Click the confirmation link AWS emailed to `ALARM_EMAIL`, then check that the
subscription has a real ARN:

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:059317926288:dejavu-dev-alarms \
  --query 'Subscriptions[].SubscriptionArn'
```

It should not say `PendingConfirmation`. **Until it does, every alarm emails
nobody.**

### Metric dimensions really exist (7.7)

After stage 5's traffic:

```bash
aws cloudwatch list-metrics --namespace AWS/Lambda --metric-name Url5xxCount \
  --dimensions Name=FunctionName,Value=dejavu-dev-api
```

`Url5xxCount` is only published once there has been a 5xx. If the list is
empty, check `UrlRequestCount` the same way. The alarm assumes a `Resource`
dimension of `dejavu-dev-api:live`, so confirm the exact dimension names and
values shown. If they differ, fix `modules/observability` before relying on
the alarm.

### Log filters match real log lines (7.7)

This checks that Lambda doesn't prefix pino's JSON lines:

```bash
LINE=$(aws logs filter-log-events --log-group-name /aws/lambda/dejavu-dev-api \
  --filter-pattern '{ $.event = "order.created" }' --limit 1 \
  --query 'events[0].message' --output text)
echo "$LINE" | head -c 300; echo
aws logs test-metric-filter --filter-pattern '{ $.event = "order.created" }' \
  --log-event-messages "$LINE"
```

`filter-log-events` returning a line at all means JSON filters work on this log
group. `test-metric-filter` should report one match. If nothing comes back,
look at the raw line: a text prefix before the `{` would break every alarm
filter.

### Email routing (7.7)

Force one alarm into ALARM and back:

```bash
aws cloudwatch set-alarm-state --alarm-name dejavu-dev-api-5xx \
  --state-value ALARM --state-reason "7.7 routing test"
# wait for the email, then:
aws cloudwatch set-alarm-state --alarm-name dejavu-dev-api-5xx \
  --state-value OK --state-reason "7.7 routing test done"
```

You should get two emails, one ALARM and one OK. That proves routing, not
detection. Detection is 7.10's job.

### The pipeline itself (7.4, 7.5)

Deploy a real CI-built SHA through `deploy.yml`, from the branch. Use `main`'s
merge commit, which `push-image` already pushed to both repos:

```bash
aws ecr describe-images --repository-name dejavu-api --image-ids imageTag=ba7fa3552954803280d7d3dc7da2ac6a0e9602a2 --query 'imageDetails[0].imagePushedAt'
aws ecr describe-images --repository-name dejavu-migrator --image-ids imageTag=ba7fa3552954803280d7d3dc7da2ac6a0e9602a2 --query 'imageDetails[0].imagePushedAt'

gh workflow run deploy.yml --ref phase-7-cd \
  -f environment=dev -f sha=ba7fa3552954803280d7d3dc7da2ac6a0e9602a2
```

Expect the `deploy-dev` job to:

- migrate: "no migrations to run" (the payload is printed in the log)
- publish a new version and shift `live`
- smoke: three checks, each timed, well under 15 s
- write a job summary table with old version → new version and `Rolled back: false`

`deploy-prod` should show as **skipped** (dispatch targeted dev).

Then confirm by hand:

```bash
curl -s "${NEW_URL%/}/api/version"   # the full ba7fa35… sha
```

Also do a **rollback by hand** once, so you know the manual path works when
GitHub doesn't:

```bash
aws lambda get-alias --function-name dejavu-dev-api --name live --query FunctionVersion
aws lambda update-alias --function-name dejavu-dev-api --name live --function-version <previous number>
curl -s "${NEW_URL%/}/api/version"   # back to 57c6892
aws lambda update-alias --function-name dejavu-dev-api --name live --function-version <the ba7fa35 number>
```

---

## Stage 7 — Merge

```bash
gh pr merge --merge
```

What happens on merge:

1. **`Terraform` / apply-dev:** should say *No changes* (stage 4 already
   applied), so no republish runs. If it isn't a no-op, find out why before
   anything else ships (the same rule as 6.13).
2. **`CI` on `main`:** `push-image` pushes the merge SHA.
3. **`Deploy`**, triggered by CI's `workflow_run`:
   - `deploy-dev` migrates and deploys the merge SHA with no human action.
     **This is the first fully hands-off release.**
   - `deploy-prod` waits for approval. **Reject it.** Prod has no function
     yet, so it would fail at `promote-check` or `get-function`. Until
     stage 8, reject every prod approval.

Afterwards, check that `/api/version` on dev shows the merge SHA.

---

## Stage 8 — Stand up prod (issue #15) · prod billing starts

This is code and an apply, and it isn't written yet. It's the only stage that
still needs a PR's worth of Terraform. Do it on a new branch
(`phase-7-prod`). The full checklist is `phase-7-steps.md` 7.8; the parts
that bite:

- `envs/prod/main.tf` gets dev's module wiring with prod's values:
  - VPC `10.30.0.0/16`
  - RDS: `deletion_protection = true`, `skip_final_snapshot = false`
    plus a snapshot name, `apply_immediately = false`,
    `backup_retention_period = 1`
  - `initial_image_tag` = the SHA dev is running, never `bootstrap`
  - `alarm_email` variable, as in dev
- **`DATABASE_URL`** exists in prod's SSM and `prevent_destroy` will refuse
  its removal. Use a `removed { from = … lifecycle { destroy = false } }`
  block, then delete the parameter by hand. Record which you did.
- **Budgets:** raise prod's `limit_usd` to ~30. Raise bootstrap's $40
  account backstop to ~60, or accept that it will fire during the prod
  window. Two RDS instances exceed the free tier's 750 instance-hours
  (correction 11).
- **Concurrency (D7):** request the quota increase before you start:
  ```bash
  aws service-quotas request-service-quota-increase \
    --service-code lambda --quota-code L-B99A9384 --desired-value 50
  ```

Apply: PR → read the `prod` plan comment → merge → `gh workflow run
terraform.yml -f environment=prod` → approve in the `production`
environment. Record the apply time and whether any IAM round was needed.
It should be zero, because stage 2 raised prod's role to dev's level.

The first prod apply's republish step no-ops if the URL doesn't answer yet.
The real first deploy is stage 9's dispatch.

---

## Stage 9 — Prod data, secrets, Stripe, frontend (issue #16)

**Secrets.** Never reuse dev's:

```bash
aws ssm put-parameter --name /dejavu/prod/JWT_SECRET --type SecureString --overwrite \
  --value "$(openssl rand -base64 48)"
aws ssm put-parameter --name /dejavu/prod/STRIPE_SECRET_KEY --type SecureString --overwrite \
  --value "sk_test_…"          # test mode (D6)
```

**First prod deploy, through the gate:**

```bash
gh workflow run deploy.yml -f environment=prod -f sha=<sha dev is running>
```

Approve it in GitHub. `promote-check` should pass, because dev runs the same
digest. Then the migrator applies all 7 migrations and the alias moves.

**Admin and catalog:**

1. Register through prod's frontend (below). Or, before the frontend exists:
   ```bash
   PROD_URL=$(aws lambda get-function-url-config --function-name dejavu-prod-api --qualifier live --query FunctionUrl --output text)
   curl -s -X POST "${PROD_URL%/}/api/auth/register" -H 'content-type: application/json' \
     -d '{"email":"you@example.com","password":"…","firstName":"…","lastName":"…"}'
   ```
2. Grant admin:
   ```bash
   aws lambda invoke --function-name dejavu-prod-migrator \
     --cli-binary-format raw-in-base64-out \
     --payload '{"action":"grant-admin","email":"you@example.com"}' out.json && cat out.json
   ```
   Expect `{"granted":true,"alreadyAdmin":false,…}`. Check `out.json` for
   `errorMessage`, because `invoke` exits 0 even on failure.
3. Log in again (the old JWT says `isAdmin:false`), then create the products in
   the admin UI. Check one image URL returns 200 against prod's
   `FRONTEND_URL`.

**Stripe.** Create a *second* test-mode endpoint:

```bash
stripe webhook_endpoints create --url "${PROD_URL%/}/api/webhooks/stripe" \
  --enabled-events checkout.session.completed
# copy the whsec_… from the output
aws ssm put-parameter --name /dejavu/prod/STRIPE_WEBHOOK_SECRET --type SecureString --overwrite --value "whsec_…"
```

The function loads SSM at cold start, so republish to pick up the secret:
`gh workflow run deploy.yml -f environment=prod -f sha=<same sha>`, and
approve. Then run `stripe trigger checkout.session.completed` and expect
`order.created` in `/aws/lambda/dejavu-prod-api` and **nothing new** in dev's
log group.

**Frontend.** Decide between `dejavustudio.xyz` and a second Vercel project,
and write the choice in 7.9. Set that project's production `VITE_API_URL` to
`${PROD_URL%/}` and run `vercel --prod`.

**Click-through on prod:** browse → cart → `4242…` → success page → claim the
order → order visible in admin.

**SNS:** confirm prod's alarm subscription email, the same way as in stage 6.

---

## Stage 10 — The checkpoint drill (issue #17)

The full script is `phase-7-steps.md` 7.10. The shape:

1. **Broken build.** On `drill/broken-build`, make `GET /api/products`'s
   controller throw. Push that image **by hand** with admin credentials. The
   push role only trusts `main`, and that stays.
   ```bash
   SHA=$(git rev-parse HEAD)
   aws ecr get-login-password | docker login --username AWS --password-stdin 059317926288.dkr.ecr.us-east-1.amazonaws.com
   for t in api migrator; do
     docker buildx build --platform linux/arm64 --target $t \
       --provenance=false --sbom=false --build-arg GIT_SHA=$SHA \
       -t 059317926288.dkr.ecr.us-east-1.amazonaws.com/dejavu-$t:$SHA --push backend
   done
   ```
2. **Dev rehearsal:** `gh workflow run deploy.yml -f environment=dev -f sha=$SHA`.
   Expect the job to go **red**: smoke fails on `/api/products`, the alias
   rolls back, the re-smoke passes, the summary says "rolled back", and an
   ALARM email arrives, then OK.
3. **Prod, for the record:** `gh workflow run deploy.yml -f environment=prod
   -f sha=$SHA -f drill=true`, then approve. The summary shows the DRILL
   MODE banner.
4. **Record** from the job log timestamps:
   - `update-alias` bad → `update-alias` back (the exposure window; the
     claim is ≤ ~10 s)
   - the 5xx count
   - how long until the ALARM email, then the OK email
5. **Dev only:**
   - a build that doesn't boot (`src/lambda.js` throws at require time)
   - a migration that fails (`SELECT 1/0;`): expect the alias not to move
     and the migrator-errors alarm to fire
6. **Clean up:**
   - delete the branch
   - `aws ecr batch-delete-image` for the drill tags
   - confirm the failed migration isn't in `pgmigrations`
   - confirm the next normal deploy migrates cleanly

---

## Stage 11 — Docs, sign-off, teardown (issues #18, #19)

- **7.11:**
  - `terraform/README.md`: deploy/rollback runbook, prod first apply, and
    `deletion_protection` in the teardown
  - `CLAUDE.md`: a pipeline section, the expand/contract rule, and
    `grant-admin` (already added)
  - execution plan: Phase 7 `[x]`, fix Verification rows 3–4, and add "What
    Phase 7 actually turned up" and the two-environment cost table
- **7.12:**
  - Re-check every phase's gate on final `main`.
  - Fix the roadmap's resume bullets: Playwright was deferred, "staging" is
    dev, and it's an alias and a URL, not a task definition and an ALB.
  - Write "Known limitations" in `README.md`, then the top-level README
    itself.
- **Teardown to the ~$0.20 floor:**
  ```bash
  # prod: turn protection off first
  aws rds modify-db-instance --db-instance-identifier dejavu-prod --no-deletion-protection --apply-immediately
  # then, per env, the targeted destroy from terraform/README.md ("Tearing dev down")
  ```
  Allow ~20 min per environment for the ENI release. Afterwards, confirm in
  the console that no VPC, ENI, RDS instance, NAT or public IP is left, then
  run a last Cost Explorer check a few days later.
- **Tag it:** `git tag -a v1.0.0 -m "Dejavu 1.0" && git push origin v1.0.0`.

---

## Housekeeping

- The agent worktrees under `.claude/worktrees/` are untracked, and all their
  branches are merged. Remove them when convenient:
  `git worktree list`, then `git worktree remove <path>` and
  `git branch -d worktree-agent-…`.
- **After every stage,** tick the matching boxes in `phase-7-steps.md`, add
  real numbers, and comment on or close the issue. The steps file is the
  record, and this runbook is just the route.
