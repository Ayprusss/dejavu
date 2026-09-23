# Phase 7 — Staging → Production CD with Rollback

**Branch:** `phase-7-cd` · **Batch H** · roadmap #6 · **the last phase**

**Goal:** a merge to `main` ships the SHA it built to dev without anyone
touching it. The same image, promoted by SHA, reaches prod only after a human
approves. Migrations run inside the VPC before new code takes traffic. A smoke
test decides whether the release stays, and if it fails, the alias moves back
to the last good version without a human. Alarms reach an inbox when
something breaks after that.

**Checkpoint (from the execution plan):** deploy a deliberately broken build →
the smoke test fails → the alias reverts on its own → an alarm fires.

**After that checkpoint the project is signed off.** Section 7.12 lists what
"done" means, so the finish line is fixed before the work starts.

---

## Status

| # | Workstream | Cost | Status |
|---|---|---|---|
| 7.0 | Close out Phase 6's open items | $0 | [ ] |
| 7.1 | Decisions (below) signed off | $0 | [x] |
| 7.2 | Lambda aliases + Function URL on the alias (dev) | $0 (URL changes) | [ ] |
| 7.3 | Deploy role in bootstrap (human-applied) | $0 | [ ] |
| 7.4 | Deploy scripts: migrate → publish → shift → smoke → rollback | $0 | [x] |
| 7.5 | `deploy.yml`: auto to dev, gated promotion to prod | $0 | [~] code done; unverified on GitHub |
| 7.6 | Expand/contract: written rule + CI guard | $0 | [x] |
| 7.7 | Alarms + SNS (`modules/observability`) | ~$0 | [ ] |
| 7.8 | Stand up prod (`envs/prod`) | **prod billing starts** | [ ] |
| 7.9 | Prod data, secrets, Stripe, frontend | | [ ] |
| 7.10 | **Checkpoint drill:** broken build auto-reverts, alarm fires | | [ ] |
| 7.11 | Docs, execution plan, merge | | [ ] |
| 7.12 | Project sign-off | | [ ] |

---

## 7.0 — Close out Phase 6

Phase 6 is merged (PR #6). A few items were still open when it merged. Close
them before Phase 7 builds on top of them.

- [x] **Merge applied as a no-op.** The `Terraform` run on the merge commit
      (`35169774187`) printed `No changes. Your infrastructure matches the
      configuration.` 6.13's "if it isn't, find out why" doesn't apply. CI on
      `main` is green, so `push-image` has pushed `ba7fa35`-era images to
      both ECR repos. Confirm with `aws ecr describe-images`.
- [ ] **48 h Cost Explorer re-check** (6.12). Fix the Phase 6 cost table with
      real numbers. Prod's cost decision in 7.1 depends on it, so do this
      one first.
- [ ] **Trim the dev apply role with IAM Access Analyzer policy generation**
      (6.5, still unchecked). Record the before and after sizes. Optional, but
      7.3 adds another role, so this is the last cheap chance to learn what
      the first one really uses.
- [ ] **Full storefront click-through on dev** (6.8's deferred item). Browse →
      add to cart → Stripe test checkout → success page → order visible in
      admin. 6.12 fixed the images that blocked it. This is the manual version
      of the E2E test Phase 4 deferred, and the drill in 7.10 needs a known-good
      baseline to compare against.
- [x] **Phase 3's frontend follow-up:** `App.jsx` should generate an
      `idempotencyKey` once per checkout attempt and reuse it across retries
      (`grep idempotencyKey dejavu/src` finds nothing today). It's small and
      needs no AWS. Do it now or record it in 7.12's deferred list, but don't
      forget it.
      Done: the actual `/api/checkout` call lives in `Cart.jsx`, not
      `App.jsx`, so the key lives there. `dejavu/src/lib/checkoutAttempt.js`
      holds the pure reuse/rotation logic (`getCheckoutAttempt`,
      `cartAttemptSignature`) and `Cart.jsx` keeps the current attempt in a
      ref: same key on a retry (double-click, or clicking again after a
      network error with the cart unchanged), a fresh key once the cart's
      signature changes or once a checkout redirects to Stripe. Covered by
      `dejavu/tests/checkoutAttempt.test.js`.
- [ ] Execution plan's Verification table: rows 3 and 4 were never marked
      `[x]`, though both phases are done. Fix that in 7.11.

---

## Corrections to the execution plan

Reading the Phase 7 bullets against the code and infrastructure Phase 6 left
behind turned up these. Each one is handled in a step below.

1. **The Function URL points at `$LATEST`, so an alias can't roll it back.**
   `aws_lambda_function_url.api` has no `qualifier`. An alias only controls
   traffic that arrives *through the alias*. The URL has to move to a
   qualified `live` alias, which **creates a new URL**. The Stripe endpoint
   and Vercel's `VITE_API_URL` then have to follow it, once, the same chore
   as 6.12. → 7.2.

2. **Published versions freeze their environment variables.** Today a
   Terraform change to `CORS_ORIGINS` or `FRONTEND_URL` goes live on the next
   cold start. With an alias in front, that change only lands on `$LATEST`.
   Traffic keeps running the published version's old copy until the next
   deploy publishes a new one. So a config-only change needs a deploy to reach
   users. → 7.5 (`terraform.yml` apply is followed by a republish of the live
   SHA).

3. **Nothing in CI can publish versions, move aliases or invoke the
   migrator.** The dev apply role has `UpdateFunctionCode`, but not
   `PublishVersion`, `*Alias` or `InvokeFunction`. Prod's apply role is
   still at its Phase 5 shape (`enable_workload_infrastructure` is unset in
   `bootstrap/main.tf`). → 7.3.

4. **Terraform and the pipeline will race on merge.** A PR that touches both
   `terraform/` and `backend/` starts `terraform.yml`'s `apply-dev` and the
   deploy at the same moment. Lambda refuses a code update while a config
   update is in progress (`ResourceConflictException`, "An update is in
   progress"). Both workflows need **one shared `concurrency` group per
   environment**, and neither may cancel the other. → 7.5.

5. **`aws lambda invoke` exits 0 when the handler throws.** A failed
   migration comes back as HTTP 200 with `"FunctionError": "Unhandled"` in the
   response metadata and the stack trace in the payload file. A pipeline that
   checks only the exit code would shift traffic onto a schema that never
   migrated. → 7.4.

6. **The CLI's defaults can run a migration twice.** `aws lambda invoke` has a
   60 s read timeout and retries on timeout. The migrator's timeout is 300 s.
   A slow migration would be invoked again while the first run was still
   going. node-pg-migrate's advisory lock stops that turning into corruption,
   but the second invocation still fails and turns the job red. Use
   `--cli-read-timeout 310` and `AWS_MAX_ATTEMPTS=1`. → 7.4.

7. **CI's re-create brings back a stale image** (found in 6.12).
   `initial_image_tag` defaults to `bootstrap`, which predates two fixes. Once
   the pipeline owns deploys, a re-create is always followed by a deploy of the
   live SHA, and prod never gets a `:bootstrap` tag at all. → 7.8.

8. **ECR's lifecycle policy limits how far back you can roll.** It keeps the
   last ~15 tagged images. A published Lambda version whose image has been
   expired from ECR can't be invoked, so the rollback target has to exist.
   Every push to `main` adds a tag, so this bites sooner than it sounds. →
   7.4 (the pipeline checks the target's image exists before it shifts) and
   7.3 (prune old Lambda versions to match).

9. **The seed can't give prod a catalog or an admin.** `seed` refuses unless
   `DEPLOY_ENV=dev`, and correctly so, because it `TRUNCATE`s every table.
   But no other path creates an admin user, since there's no `psql` to a
   private RDS. Prod would come up with an empty shop and nobody who can fill
   it. → 7.9.

10. **Dev and prod share one 10-execution concurrency ceiling** (6.6/6.9:
    account-wide, so no reserved concurrency). A load test or retry storm in
    dev throttles prod. There's no Terraform fix on this account. The
    options are to request a quota increase (free to ask, may be refused on
    a new account) or to write it down as a known coupling. → 7.1 D7.

11. **Two always-on RDS instances exceed the free tier.** The free tier's
    750 instance-hours a month covers one `db.t4g.micro` running around the
    clock, not two. Phase 6's "$0 actually paid" doesn't carry over to prod.
    → 7.1 D5 and [Cost](#cost).

12. **Both deploy roles present the same OIDC subject.** `environment:production`
    is what a prod *apply* job and a prod *deploy* job both put in `sub`, so a
    trust policy can't tell them apart. Any job that passed the approval gate
    could assume either role. That's acceptable, because the gate is the
    control and both roles sit behind it. But be honest about it: the split is
    least privilege for mistakes, not a security boundary.
    (`job_workflow_ref` claim customization would make it one; not worth it
    here.) → 7.3.

---

## 7.1 — Decisions (recommendations; confirm or override)

- [x] **D1 · Dev *is* staging. No third environment.** The roadmap says
      "staging"; the execution plan says "dev". A third environment would add
      another ~$25/month, a third RDS instance and a third share of the
      10-execution ceiling, and it would prove nothing dev doesn't. Dev gets
      every merge automatically, which is what makes it a staging environment.
      Use "dev (staging)" in docs so the resume bullet and the repo agree.

- [x] **D2 · Rollback is a pipeline script, not CodeDeploy.** CodeDeploy's
      Lambda deployment groups do alias traffic shifting with alarm-triggered
      rollback out of the box. But that's another service, another IAM role
      and an AppSpec file, and it would own the most interesting part of the
      phase. At one user a canary shift has no traffic to measure. The script
      is about 60 lines, and every line of it can be explained. *Considered and
      rejected:* CodeDeploy `Linear10PercentEvery1Minute`. Mention it as what
      you'd use once there's traffic for a canary to learn from.

- [x] **D3 · Shift, then smoke-test the public URL.** Not "smoke-test a
      candidate, then shift". Testing before the shift would need either a
      second public Function URL on a `candidate` alias (a second unauthenticated
      endpoint) or hand-built Function-URL events sent through `lambda invoke`
      (the adapter accepts them, but the test would skip the real URL →
      adapter path that 6.8 proved). Shift-then-smoke tests exactly what users
      hit. It costs a window of ≤ ~10 s where a broken build is live. Stripe
      webhooks that land in that window get a 500 and are retried, which is
      the retry semantics Phase 3 designed. That trade-off is the point of the
      phase, so say it out loud.

- [x] **D4 · Promote by SHA, verify by digest.** Prod deploys the exact tag dev
      deployed, never a rebuild. The pipeline resolves the tag to its image
      digest in both environments and fails if they differ. Immutable tags
      already make this true, and the check turns it from a convention into
      something asserted.

- [x] **D5 · Prod shares nothing with dev, and doesn't run around the clock.**
      Separate VPC, NAT, RDS, SSM path, RDS secret, state key, workload role,
      Stripe webhook endpoint and SNS topic. Only the account, ECR (by design,
      so D4 works) and the concurrency ceiling (correction 10) are shared.
      *The cost answer:* ~$50/month at list price with both environments up.
      Prod runs for the build-out and the drills, then both environments go
      back to the ~$0.20 destroy floor. The 6.12 loop brings them back in about
      13 minutes each.
      *Considered and rejected:* prod reusing dev's VPC and NAT (saves ~$10/mo,
      but "shares nothing" becomes "shares its egress and its failure mode",
      and a dev destroy would take prod down).
      *Also rejected:* a staging DB that only exists during a deploy window.
      The window would be about 13 minutes of RDS creation per merge.

- [x] **D6 · Prod uses Stripe test mode.** This is a mock storefront with no
      goods to ship, so a live key would put real card charges behind a store
      that can't fulfil them. Use a **separate** test-mode webhook endpoint and
      secret per environment, so a dev replay can never reach prod's `StripeEvent`
      table. State this plainly: the approval gate protects prod's data, not
      real money.

- [x] **D7 · Accept the shared concurrency ceiling and write it down.** Request
      the quota increase (`aws service-quotas request-service-quota-increase
      --service-code lambda --quota-code L-B99A9384`) and record the outcome.
      If it's granted, reserve prod's share in `modules/lambda`
      (`reserved_concurrency` is already a variable). If it isn't, the
      coupling goes in "what I'd do differently".

- [x] **D8 · A dedicated deploy role per environment, separate from apply.**
      Deploys happen on every merge, applies rarely. The deploy role can touch
      two functions and read two ECR repos. It can't create a VPC, delete an
      RDS instance or edit SSM. See correction 12 for what the split does *not*
      buy.

- [x] **D9 · Dev deploys are skipped, not failed, while dev is destroyed.**
      D5 means dev will often not exist. The deploy job's first step is
      `aws lambda get-function`. If that returns `ResourceNotFoundException`,
      the job writes a notice to the job summary and exits green. Anything else
      fails. **Prod never skips.** A promotion to a missing prod is an error.

- [x] **D10 · Alarms: four, prod and dev, one SNS email topic each.**
      Details in 7.7. No dashboards and no paging. Each alarm maps to a
      specific question in the roadmap's "be ready to answer" list.

---

## 7.2 — Aliases, and the Function URL moves onto one (dev first)

`modules/lambda`, applied to dev through the normal PR → `terraform.yml` path.

- [x] `aws_lambda_alias "api_live"`: `name = "live"`,
      `function_version` = the function's current published version.
      **`lifecycle { ignore_changes = [function_version] }`**. Terraform
      creates the alias and the pipeline owns where it points (D5 from Phase 6,
      extended).
    - [x] **Verify, don't assume:** whether `CreateAlias` accepts `$LATEST`. If it
      doesn't, set `publish = true` on the function so the first apply creates
      version 1 for the alias to reference, and keep `ignore_changes` on
      `image_uri`. Check `publish` doesn't make every later config-only apply
      publish a version. That would bypass the pipeline and the smoke test.
      **Verified via docs (provider source + AWS API docs), not a live call:**
      `function_version` accepts the literal `"$LATEST"` for a plain
      (non-weighted) alias - the provider validates it against
      `(\$LATEST|[0-9]+)`, and AWS's alias docs describe (while discouraging
      long-term use of) exactly this. So `publish = true` isn't needed, which
      also sidesteps the bypass risk: `publish`'s own description is "publish
      creation/**change**", and env/memory edits go through
      `UpdateFunctionConfiguration` the same as code - so `publish = true`
      would have made Terraform publish an extra, unsmoked version on every
      config-only apply. Used `function_version = "$LATEST"` instead; see the
      comment above `aws_lambda_alias.api_live` in `modules/lambda/main.tf`.
- [x] `aws_lambda_function_url.api`: add `qualifier = aws_lambda_alias.api_live.name`.
      `aws_lambda_permission.public_invoke`: add the same `qualifier`.
- [ ] **Verify the Function URL's permission requirement against a real
      `curl`.** AWS has been tightening URL invoke permissions (both
      `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` on the resource
      policy for new URLs). A 403 from a correctly created URL looks exactly
      like a broken adapter. If a second permission statement is needed, add it
      with the same qualifier and write down why.
      **Not verified live (no deployed infra available to this workstream).**
      Docs research (docs.aws.amazon.com/lambda/latest/dg/urls-auth.html,
      current as of this reading) is unambiguous that `NONE` auth now needs a
      second statement: `lambda:InvokeFunction` gated on the
      `InvokedViaFunctionUrl` condition key, on top of the existing
      `lambda:InvokeFunctionUrl` statement - the note flags this as enforced
      for new function URLs since October 2025, all URLs by November 2026.
      Added `aws_lambda_permission.public_invoke_function` (qualified,
      `invoked_via_function_url = true`) on that basis. **Still needs a real
      `curl` against the deployed qualified URL** to confirm this is
      sufficient and no third statement is needed - flagging per the task's
      instructions, since that requires live AWS.
- [x] Migrator: **no alias.** It's invoked by the pipeline at `$LATEST`,
      straight after its own `update-function-code`. It never takes public
      traffic, so there's nothing to roll back to. (No code change needed -
      confirmed no alias resource exists for `aws_lambda_function.migrator`,
      and added a comment saying so.)
- [ ] Output `function_url` now reads the qualified URL. Update the Stripe
      endpoint in place (`webhook_endpoints update`, which keeps the signing
      secret, as in 6.12) and Vercel's `VITE_API_URL`, then redeploy the
      frontend.
      **Terraform part done** (`function_url` output is now the qualified
      alias URL by construction, since `aws_lambda_function_url.api` itself
      carries the qualifier). **The Stripe/Vercel live updates are out of this
      workstream's scope** (no Stripe/Vercel commands per the hard rules, and
      they only make sense once this is actually applied) - flagging as not
      done here.
- [ ] Verify: `/api/version` through the new URL; `stripe trigger
      checkout.session.completed` → one `order.created`, no
      `webhook.signature_invalid`. The raw-body path now runs through an alias,
      and that's worth re-proving once rather than assuming.
      **Not verified - needs live AWS + Stripe, out of scope here.**
- [ ] Verify the old unqualified URL is gone (it should 404 or DNS-fail), so
      nothing can reach `$LATEST` from the internet.
      **Not verified - needs live AWS, out of scope here.**

---

## 7.3 — Deploy role (bootstrap, human-applied)

In `modules/workload-roles`, beside `dejavu-gha-push`. Applied by you with
admin credentials, never by CI.

- [x] `dejavu-gha-deploy-dev`: trust `sub = repo:Ayprusss/dejavu:environment:dev`,
      `aud = sts.amazonaws.com`. — `modules/workload-roles/main.tf`'s new
      `deploy_trust`/`deploy` resources, `for_each` over a new
      `deploy_environments` variable, wired from `bootstrap/main.tf`.
- [x] `dejavu-gha-deploy-prod`: trust `sub = repo:Ayprusss/dejavu:environment:production`.
      — same `for_each`, `deploy_environments.prod.github_environment = "production"`.
- [x] Permissions, scoped to `function:dejavu-<env>-api` and
      `function:dejavu-<env>-migrator` (plus `:*` for qualified ARNs):
      `GetFunction`, `GetFunctionConfiguration`, `UpdateFunctionCode`,
      `PublishVersion`, `ListVersionsByFunction`, `DeleteFunction` (qualified
      ARNs only, for version pruning; condition it so it can't delete the
      unqualified function), `GetAlias`, `UpdateAlias`, and `InvokeFunction`
      on the **migrator only**.
    - **Researched, not live-verified:** a qualified Lambda ARN is the
      unqualified one with a literal `:<version-or-alias>` appended, and
      IAM's resource-pattern wildcard matches that trailing colon like any
      other character. So `function:name:*` as a resource matches every
      qualified ARN and provably none of the unqualified one — the pattern
      requires the literal substring `function:name:` to appear, and the bare
      ARN never contains that trailing colon. IAM *can* separate them
      cleanly, with no condition key needed; documented in
      `modules/workload-roles/main.tf`'s `deploy_function_arns` comment. Kept
      pruning in the role on that basis, plus a belt-and-suspenders explicit
      Deny on the two unqualified ARNs. **Still needs the plan's real
      `aws lambda delete-function --function-name dejavu-dev-api` check
      against a live role** — no AWS credentials in this session.
- [x] ECR: `BatchGetImage`, `GetDownloadUrlForLayer`, `DescribeImages` on the
      two repos (`UpdateFunctionCode` for an image checks the caller's ECR
      access too). — `deploy`'s `ReadEcrImages` statement.
- [x] `sts:GetCallerIdentity`. Nothing else. — `deploy`'s `WhoAmI` statement.
- [x] **Prod's workload role.** Add `prod = { rds_identifier = "dejavu-prod" }`
      to `workload_environments`, which creates `dejavu-prod-lambda` with SSM
      scoped to `/dejavu/prod/*` and Secrets Manager scoped by tag to
      `db:dejavu-prod`. — added in `bootstrap/main.tf`'s `module.workload_roles`
      call; the existing `for_each`-based resources in
      `modules/workload-roles/main.tf` needed no changes to pick it up.
- [x] **Prod's apply role.** `enable_workload_infrastructure = true`,
      `workload_role_arn` = prod's. Bring over every lesson from 6.7's eight
      rounds, so prod's first apply should need **zero** IAM iterations. If it
      needs any, that's a finding: record it. — set on `module.roles_prod` in
      `bootstrap/main.tf`. Also added, gated on the same flag (so both dev and
      prod's apply roles pick it up): the 7.2 alias/version Lambda actions and
      the full 7.7 SNS/CloudWatch-alarm/log-metric-filter statement set, in
      `modules/iam-oidc/main.tf`. **The "zero IAM iterations" claim is
      unverified** — it can only be tested against a real `terraform apply`
      to prod, which this session cannot run.
- [x] ECR repository policy: `aws:SourceArn` is already `function:dejavu-*`,
      which covers prod. Confirmed by reading
      `modules/workload-roles/main.tf`'s `local.function_arn_pattern` — it is
      not environment-scoped. No change made.
- [x] Outputs → GitHub variables: `AWS_DEPLOY_ROLE_ARN_DEV`,
      `AWS_DEPLOY_ROLE_ARN_PROD`, `AWS_WORKLOAD_ROLE_ARN_PROD`. — new
      `deploy_role_arn_dev`/`deploy_role_arn_prod`/`workload_role_arn_prod`
      outputs in `bootstrap/outputs.tf`. Setting the actual GitHub repo
      variables from an applied bootstrap is still a human, post-apply step.
- [ ] Verify the trust boundary like Phase 5 did: a `workflow_dispatch` from a
      non-`main` branch that names `environment: production` must stop at the
      approval gate (the environment's `branch_policy` + `required_reviewers`
      are both already set, as checked on the live repo). **Not done** — needs
      a live GitHub Actions run against the applied roles.

---

## 7.4 — Deploy scripts

`scripts/deploy/` at the repo root: plain bash with `set -euo pipefail`, so a
human can run the same script CI runs (with admin credentials, the way every
live step in Phase 6 went). One script per stage, so the workflow reads as the
sequence of stages.

### `migrate.sh <env> <sha>`

- [x] `update-function-code` the migrator to `dejavu-migrator:<sha>`, then
      `aws lambda wait function-updated-v2`.
- [x] Invoke `{"action":"up"}` with `--cli-read-timeout 310` and
      `AWS_MAX_ATTEMPTS=1` (correction 6).
- [x] **Fail on `FunctionError`, not just on exit code** (correction 5). Print
      the payload either way, so the applied-migration list lands in the job
      log.
- [x] **Verify** node-pg-migrate's transaction behaviour for the runner API as
      the migrator calls it (single transaction for the whole run, or one per
      migration?). A failure halfway through a multi-migration deploy should
      leave the schema at a known point, and the runbook has to say which.
      **Confirmed from `backend/node_modules/node-pg-migrate/dist/legacy/{runner,migration,migrationBuilder}.js`:**
      `runner()` only wraps the whole batch in one `BEGIN`/`COMMIT` when
      `options.singleTransaction` is truthy; `backend/src/migrator.js`'s
      `up()` never sets it, so it's `undefined` (falsy) - despite the
      TypeScript d.ts's `@default true` comment, nothing in the programmatic
      `runner()` path applies that default itself. Instead each migration
      gets its **own** individual `BEGIN`/`COMMIT` (`Migration._apply`, gated
      on `pgm.isUsingTransaction()`, which defaults `true`). So: **one
      transaction per migration, not one for the whole run.** A failure
      halfway through a multi-migration deploy leaves every earlier migration
      in that run committed and the failing one rolled back - the schema
      lands exactly at "all migrations before the failing one," never
      partially applied. `backend/MIGRATIONS.md` (7.6) should state this
      plainly for the runbook.

### `deploy.sh <env> <sha>`

- [x] Record the rollback target first: `get-alias live` → `PREVIOUS_VERSION`.
      Check its image still exists in ECR (correction 8), and **refuse to
      deploy** if it doesn't. A deploy with no rollback target is exactly
      the case this phase exists to prevent.
    - **Extra case found while implementing:** `get-alias live` can return
      `FunctionVersion: "$LATEST"` - not just on a brand-new function, but on
      *any* re-create, since 7.2's `aws_lambda_alias` is created pointing at
      `$LATEST` and `ignore_changes = [function_version]` leaves it there
      until something moves it. `$LATEST` can never be a rollback target (the
      next `update-function-code` would overwrite it, and it's the code
      about to be replaced), so `deploy.sh` detects this and calls
      `publish-version` (no `--code-sha256` guard - there's no prior
      `update-function-code` result to check it against) to pin whatever
      `$LATEST` is running right now to a real version number, points `live`
      at it, and uses *that* as `PREVIOUS_VERSION` before doing anything else.
      Covered by the harness (see below).
- [x] `update-function-code` the api to `dejavu-api:<sha>` → wait.
- [x] `publish-version --code-sha256 <from the update>`. The guard ensures the
      version published is the code just uploaded, not a concurrent change.
      **Note:** publishing code and config that haven't changed returns the
      existing version instead of a new one. Handle that as "already live",
      not as an error.
- [x] `update-alias live --function-version <new>`.
- [x] Run `smoke.sh`. On failure → `update-alias live --function-version
      $PREVIOUS_VERSION`, run `smoke.sh` **again against the rolled-back
      version**, and exit non-zero either way. A rollback that doesn't pass
      its own smoke test is a page, not a success. Say so in the job summary.
- [x] Prune: delete published api versions older than the newest ~10 that
      aren't the alias target. Keep this count below ECR's lifecycle count
      (correction 8). Skipped entirely on exit 2 (rollback's own smoke also
      failed) - that's an unresolved incident, not a moment to also be
      deleting Lambda versions.
- [x] Write the outcome to `$GITHUB_STEP_SUMMARY`: env, SHA, image digest, old
      version → new version, smoke timings, and whether it rolled back.
      (Smoke *timings* live in `smoke.sh`'s own stdout, captured in the job
      log rather than duplicated into the summary table.)

### `smoke.sh <url> <sha>`

The plan says under ~10 s, and exactly three checks.

- [x] `GET /api/status` → 200.
- [x] `GET /api/version` → `{"sha":"<sha>"}`. This is how the script proves
      the alias actually moved and it isn't testing the old version.
- [x] `GET /api/products` → 200 with ≥ 1 item. This one goes through RDS.
- [x] Per-request timeout ~4 s and a couple of retries, but a **hard ~15 s
      total budget**. The first request after a shift is a cold start (p50
      ≈1.16 s, max seen 1.54 s in 6.9), so a single try with a 1 s timeout
      would flake. A flaky smoke test is a random rollback.
- [x] Not `/api/ready`: it duplicates `/api/products`'s DB check with less
      signal. Not checkout: it creates Stripe objects on every run. Write down
      why each is excluded. The roadmap asks "why not more?" (Both reasons
      are in `smoke.sh`'s own header comment.)
- [x] **Known false-positive source: the weekly RDS secret rotation**
      (issue #22). After a rotation, a warm environment with a stale cached
      password fails its next new connection with one `28P01`. `pool.js`
      then calls `invalidate()`, and the following request recovers (6.10
      run 2). `/api/products` returns that failure as a 500. That could fail
      smoke, and `deploy.sh` would roll back a good deploy. The rollback's
      re-smoke is the most exposed, because it hits the previous version's
      warm environments. A new version's environments are cold and fetch the
      password as they connect.
      **Decision: smoke's retries are the fix, and `smoke.sh` stays as it
      is.** A `28P01` fails fast, not at the 4 s timeout. The retry fires
      right away, after `invalidate()`, and costs about a second of the 15 s
      budget. The harness now proves this, rather than it just being
      reasoned about: one transient `/api/products` 500 → smoke passes;
      in `deploy.sh`, no rollback; on the rollback's re-smoke, still exit 1,
      not exit 2. It was mutation-tested with `MAX_ATTEMPTS=1`, which fails
      5 checks. **What retries don't cover:** smoke doesn't pause between
      attempts, so all 4 can land in the same seconds. If the rotation is
      still in progress then (RDS has the new password but `AWSCURRENT`
      doesn't yet, a window 6.10 didn't measure), every attempt can fail.
      A backend retry-once wouldn't help there either, since it would
      re-fetch the same old secret. The mitigation for that case is timing:
      `phase-7-runbook.md` stages 6 and 10 check `NextRotationDate`. A
      rollback inside a rotation window is suspect until the log is checked
      for `28P01`.

### `promote-check.sh <sha>`

- [x] Resolve `dejavu-api:<sha>` and `dejavu-migrator:<sha>` to digests, and
      compare them with what dev's `live` alias version is running
      (`get-function --qualifier live` → `ResolvedImageUri`). Fail if prod
      would run anything dev didn't (D4). (The migrator has no alias - 7.2 -
      so its comparison is against `$LATEST` rather than a qualifier.)

- [x] Every script lint-clean under `shellcheck`, added to the `lint` job.
      (`scripts/deploy/.shellcheckrc` disables SC2016 repo-wide for this
      directory - every script deliberately compares against the literal
      string `"$LATEST"` - and SC2001 for one readability-over-purity `sed`
      in the test harness.)

**Verified with a fake-`aws`/fake-`curl` bash harness**
(`scripts/deploy/test/`, run via `scripts/deploy/test/run.sh`, no network or
AWS credentials): happy path; smoke failure → rollback → exit 1; rollback
smoke also failing → exit 2; migrator `FunctionError` → non-zero; missing
rollback image → refuse; `publish-version` returning an existing version
(no-op redeploy); the `$LATEST`-alias bootstrap case above; plus direct
`smoke.sh` and `promote-check.sh` cases. 21/21 pass. (Now 30/30, with the
issue #22 rotation-blip cases under `smoke.sh` above.) Mutation-tested by
temporarily disabling `migrate.sh`'s `FunctionError` check (`if false && ...`)
and confirming the harness caught it (red), then reverting (green again).

---

## 7.5 — `deploy.yml`

- [x] Triggers:
    - `workflow_run` on `CI`, `types: [completed]`, `branches: [main]`, with
      the job guarded by `github.event.workflow_run.conclusion == 'success'`
      and `event == 'push'`. **Deploy `github.event.workflow_run.head_sha`**,
      never `github.sha`. In a `workflow_run` run, `github.sha` is the
      *latest* `main`, which may not be the commit CI built and pushed.
    - `workflow_dispatch` with inputs `environment` (dev/prod) and `sha`.
      That covers re-deploying a known SHA, rolling forward a fix, and 7.10's
      drill. Added a third input, `drill` (boolean, default `false`), per
      7.10's bypass below.
- [x] `deploy-dev` job: `environment: dev`, assume `AWS_DEPLOY_ROLE_ARN_DEV`,
      D9's skip check, `migrate.sh dev`, `deploy.sh dev`. Exposes a job
      output (`skipped`) so `deploy-prod` can tell D9's runtime skip apart
      from a job-level skip (see next item).
- [x] `deploy-prod` job: `needs: deploy-dev`, `environment: production`
      (**required reviewer**, the gate), assume `AWS_DEPLOY_ROLE_ARN_PROD`,
      `promote-check.sh`, `migrate.sh prod`, `deploy.sh prod`.
    - If `deploy-dev` was *skipped* (dev destroyed), `deploy-prod` must not
      run. Nothing was verified in dev, so there's nothing to promote. Make
      that explicit in the `if:`. A skipped `needs` otherwise quietly skips
      dependants, and the next person to edit the condition may "fix" it.
      Done via `always()` + `needs.deploy-dev.result` + the `skipped` output;
      a `workflow_dispatch` that targets `prod` directly makes `deploy-dev`
      skip *by design* (its own `if` never matches), which is deliberately
      let through — see the comment above `deploy-prod`'s `if:` in the file
      for how the two "skipped" cases are told apart.
- [x] **Shared concurrency with `terraform.yml`** (correction 4):
      `concurrency: { group: dejavu-deploy-<env>, cancel-in-progress: false }`
      on both workflows' dev and prod jobs. Job-level, not workflow-level, so
      a prod approval waiting for hours doesn't block dev.
- [x] **After `terraform.yml`'s apply, republish** (correction 2): its apply
      jobs end with `deploy.sh <env> <live sha>`, reading the live SHA from
      `/api/version`, so config changes reach the alias. Skip it when the plan
      reported no changes. Detected with `terraform plan -detailed-exitcode`
      (0 = no changes, 2 = changes) run before `apply`, which now applies the
      saved plan file instead of re-planning inline. Assumes the deploy role
      (not the apply role) for the republish step only, since the apply role
      has no `UpdateFunctionCode`/`PublishVersion`/`UpdateAlias` (7.3).
- [x] **Prod's `terraform.yml` apply is still `workflow_dispatch`-only**
      (unchanged). Only code auto-promotes, never infrastructure.
- [x] Pin every third-party action in `deploy.yml` by commit SHA (6.4 started
      this with Trivy; the deploy path is where it matters most, because these
      jobs hold prod credentials). `actions/checkout` and
      `aws-actions/configure-aws-credentials` pinned by commit SHA resolved
      from their `v4` tags via `gh api .../git/ref/tags/v4` (and, for the
      annotated `configure-aws-credentials` tag, dereferenced to the commit
      it points at), with a `# vX.Y.Z` comment. `terraform.yml`'s own action
      refs were left as version tags, matching that file's existing
      convention — the pin-by-SHA requirement in the plan is scoped to
      `deploy.yml`.
- [x] `actionlint` clean (via Docker, as in 6.4). Ran
      `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
      against the whole `.github/workflows/` directory — no findings.
- [x] **Why the manual gate, when everything is automated?** Write the answer
      in the workflow comment, because the roadmap asks it. The smoke test
      only catches what it checks. The gate is where a human looks at dev
      after a real click-through and decides the change is one they meant to
      ship. On a Free-plan private repo the gate wouldn't enforce at all
      (Phase 5's finding), so staying public is still load-bearing. Written
      as the comment block directly above the `deploy-prod` job in
      `deploy.yml`.

---

## 7.6 — Expand/contract: the rule, and a guard

Migrations run before code (7.5). For the length of a deploy, and for as long
as a rollback might last, **the previous release runs against the new
schema**. Rolling back the code doesn't roll back the schema.

- [x] **Write the rule** in `backend/MIGRATIONS.md`: every migration
      must be safe for the release currently in prod. Allowed in one deploy:
      add a nullable column or one with a default, add a table, add an index
      (`CONCURRENTLY` where the table is big enough to matter; it isn't yet,
      and `CONCURRENTLY` can't run inside a transaction), widen a constraint.
      Not allowed in one deploy: drop or rename a column or table, add
      `NOT NULL` without a default, narrow a type, tighten a `CHECK` existing
      rows or old code might violate.
- [x] **The rename, worked through**, since the roadmap asks. `Order.status` →
      `Order.fulfillmentStatus` takes **three deploys**: (1) add the new
      column, write both, read the old; (2) backfill, then read the new while
      still writing both; (3) stop writing the old, and **only in a later
      deploy** drop it. Rollback from deploy N lands on deploy N−1, which is
      safe at every step only if the drop never ships alongside the code that
      stopped using the column. Written up in `backend/MIGRATIONS.md`.
      **Moved out of `backend/migrations/`** after the merge: node-pg-migrate
      reads every file in that directory, and `README.md` failed every run
      with `Cannot determine numeric prefix for "README.md"`. Found by
      running the integration suite on the combined branch.
- [x] **Guard in CI:** a `migration-safety` step in the `migrations` job. For
      `.sql` files *added* in the PR (diffed against the PR's base commit, or
      the pre-push commit on a push to `main`), grep the `-- Up Migration`
      section for `DROP COLUMN`, `DROP TABLE`, `RENAME`,
      `ALTER COLUMN ... TYPE` and `SET NOT NULL`, and fail unless the file
      carries a `-- contract: <why this is safe now>` line. The guard is a
      speed bump, not a proof, and it catches the accident rather than the
      deliberate choice. Implemented as
      `backend/scripts/check-migration-safety.sh`, invoked from the
      `migrations` job with `fetch-depth: 0` so the base commit is available
      to diff against.
- [x] Also fail if a PR **modifies** an existing migration file. CLAUDE.md
      already says never to do that, and CI can enforce it. The same script
      also fails on a **delete** (a rename is a delete of the old name plus
      an add of the new one, so it's caught the same way).
- [ ] **Stronger, optional:** a `backward-compat` job that migrates a fresh
      database with the PR's migrations, then runs `main`'s integration suite
      against it. That's the real claim ("old code works on new schema"),
      tested rather than argued. Not built in 7.6 — left for whoever picks it
      up, per the verification below.
    - **Verify first:** `main`'s `globalSetup` will see applied migrations it
      has no files for. node-pg-migrate's order check may refuse. If so, the
      job needs `checkOrder: false` for that run or a pre-migrated database it
      doesn't migrate at all. Decide once you've seen the real error.
      **Answer:** it does not refuse. `checkOrder`
      (`node_modules/node-pg-migrate/dist/bundle/index.js`, function
      `checkOrder` and its call site in `up()` around line 3578) only walks
      the two migration lists up to `Math.min(runNames.length,
      migrations.length)` — it never looks past the shorter list. Already-run
      migrations are read back ordered by `run_on, id`
      (`getRunMigrations`, same file, ~line 3516), i.e. application order,
      which matches filename order for a normal `up`. A PR's newest migration
      always sorts after everything `main` already knows about, so it falls
      past the compared prefix rather than inside it: `checkOrder` passes,
      `getMigrationsToRun` finds nothing new (the on-disk migrations are all
      already recorded as run), and `up()` logs "No migrations to run!" and
      returns cleanly — exactly the state a `backward-compat` job wants, no
      `checkOrder: false` needed. (It would only refuse if an unrun migration
      sorted *before* an already-run one it doesn't have a file for, which
      can't happen here since filenames are strictly increasing.)
- [x] Verify the guard by mutation, like Phase 4: add a throwaway migration
      with `DROP COLUMN` on a branch, watch it fail, add the `contract` line,
      watch it pass, then delete the branch. Also verified: modifying an
      existing migration fails independently. Done on a local scratch branch,
      deleted afterward — see the 7.6 commit message for the exact output.

---

## 7.7 — Alarms and SNS

`modules/observability` grows alarms, one module call per environment.

- [x] `aws_sns_topic "alarms"` + an `email` subscription from
      `var.alarm_email` (a GitHub secret, like `BUDGET_ALERT_EMAIL`, so the
      address isn't in a public repo). **The subscription stays
      `PendingConfirmation` until the email link is clicked**, and until then
      alarms go nowhere, silently. Confirm it and check
      `aws sns list-subscriptions-by-topic` shows a real ARN. — both in
      `modules/observability/main.tf`, gated on a new `enable_alarms`
      variable (default `true`) so an environment can turn the whole set off
      in one place. `var.alarm_email` wired into `envs/dev` and
      `TF_VAR_alarm_email: ${{ secrets.ALARM_EMAIL }}` added next to every
      `TF_VAR_budget_notification_email` line in `terraform.yml` (plan,
      apply-dev, apply-prod). **Not verified live** — confirming the
      subscription and its ARN needs a real apply and a clicked email link.
- [x] **Alarm 1 · 5xx on the live alias.** `AWS/Lambda` `Url5xxCount`,
      `Sum ≥ 1` over 1 × 60 s, `treat_missing_data = notBreaching`.
      **Verify the dimension names from `aws cloudwatch list-metrics` after
      real traffic has hit the alias.** Don't guess whether it's
      `FunctionName` + `Resource`, or what `Resource` holds for a qualified
      URL. An alarm on a metric that never exists is silently green forever.
      — Researched against AWS's own "Monitoring Lambda function URLs" docs
      (not guessed): `Resource` for a qualified URL is
      `"<function-name>:<alias>"` (AWS's own example:
      `hello-world-function:$LATEST`), so `aws_cloudwatch_metric_alarm.api_5xx`
      dimensions on `"dejavu-<env>-api:live"` (the alias 7.2 creates,
      hardcoded as a local since this module doesn't depend on
      `modules/lambda`). **Not live-verified** — needs `aws cloudwatch
      list-metrics` after real traffic through the alias, per the checklist.
- [x] **Alarm 2 · Lambda `Errors`** on the api (alias-qualified) and on the
      **migrator**, `Sum ≥ 1`. A failed migration should email someone even
      though the pipeline also goes red. — two alarms:
      `aws_cloudwatch_metric_alarm.api_errors` (`Resource =
      dejavu-<env>-api:live`) and `.migrator_errors` (`FunctionName =
      dejavu-<env>-migrator`, no alias — 7.2 gives the migrator none).
- [x] **Alarm 3 · Lambda `Throttles`** on the api, `Sum ≥ 1`. Given
      correction 10, this is the alarm most likely to fire for a reason that
      has nothing to do with the code. — `aws_cloudwatch_metric_alarm.api_throttles`,
      same `Resource` dimension as alarm 1/2.
- [x] **Alarm 4 · `checkout.oversell`.** `aws_cloudwatch_log_metric_filter` on
      the api log group, pattern `{ $.event = "checkout.oversell" }`, metric
      `Dejavu/<env>` `CheckoutOversell`, value 1, **default value 0**. Alarm
      on `Sum ≥ 1`. The log line means a customer was charged and nothing was
      recorded (Phase 3), so it's a refund for a human, and it's the one
      alarm here about money rather than uptime. — confirmed the event key
      exists verbatim (`grep -rn "checkout.oversell" backend/src` →
      `webhookController.js:69`) before wiring the filter pattern to it.
    - [x] Also filter `webhook.failed` → `WebhookFailed`. The roadmap's
      "failed-checkout rate" is this and `checkout.failed` together. One
      alarm on their sum, or two, whichever you can explain. — one alarm
      (`aws_cloudwatch_metric_alarm.failed_checkout`), a `metric_query`
      expression `webhook_failed + checkout_failed`, on the reasoning that a
      customer-visible failed checkout is one incident regardless of which
      side logged it. Also confirmed `webhook.failed`
      (`webhookController.js:83`) and `checkout.failed`
      (`checkoutController.js:123`) verbatim, and read `checkoutController.js`
      to confirm `checkout.failed` only fires on the catch-all 500 (a genuine
      Stripe/internal error), never on routine 400s like out-of-stock — so
      folding it into this alarm doesn't make it noisy.
    - [x] **Verify** each filter against a real log line with `aws logs
      test-metric-filter` before you trust it. CLAUDE.md's rule is that
      renaming an event key breaks an alarm, and this step is where that rule
      starts to matter. — **Researched, not live-verified** (no deployed log
      group to test against here): whether the pattern can even match depends
      on whether CloudWatch receives pino's raw JSON line unprefixed. Checked
      `backend/src/lib/logger.js` (plain pino, no `pino-pretty`, one JSON
      object per line) against AWS's "Configuring JSON and plain text log
      formats" docs: the JSON *wrapping* Lambda can add to application logs is
      implemented by patching a **managed runtime's** built-in logging calls
      (for Node.js, the runtime's own `console.*`) — it only applies inside
      that managed runtime's handler invocation path. The api image doesn't
      go through it: it's a container image running a plain Express process
      under the Lambda Web Adapter extension, invoked via a custom runtime
      bootstrap, so that wrapper never runs. Default log format is plain text
      regardless, which for a non-managed runtime means stdout bytes ship to
      CloudWatch as-is, one line per event, unprefixed — so `{ $.event =
      "..." }` should match pino's line directly. **Flagging per the
      checklist rather than trusting this**: run `aws logs
      test-metric-filter` against a real log line once the api is deployed
      and has logged at least one of these three events.
- [x] Every alarm has `alarm_actions` **and** `ok_actions` on the topic, so the
      drill's inbox shows both "ALARM" and "OK". That's how you know the
      rollback actually cleared it. — set on all six alarm resources.
- [ ] Apply-role additions (bootstrap, human-applied): `sns:*Topic*`,
      `sns:Subscribe`, `sns:Unsubscribe`, `sns:*Attributes`, `sns:*Tag*` on
      `arn:aws:sns:<region>:<acct>:dejavu-*`; `cloudwatch:PutMetricAlarm`,
      `DeleteAlarms`, `DescribeAlarms`, `ListTagsForResource`, `TagResource`
      on `alarm:dejavu-*`; `logs:PutMetricFilter`, `DeleteMetricFilter`,
      `DescribeMetricFilters`. Expect the provider's tag read-back to want at
      least one more action (the 6.7 pattern), and fix it from the real
      `AccessDenied`. — out of this workstream's file scope (7.3's agent adds
      this in `modules/iam-oidc`); left unchecked here on purpose.
- [ ] Cost: the first 10 alarm metrics are free, and so is SNS email at this
      volume. Two environments × ~5 alarms stays at or under ~$0. — six alarm
      resources per environment here, still comfortably under the free-tier
      10; not re-verified against a real bill (needs 7.0's Cost Explorer
      re-check).
- [ ] **Test each alarm once** with `aws cloudwatch set-alarm-state
      --state-value ALARM` to prove the email path works end to end. That
      proves routing, not detection. Detection is proven in 7.10. — needs a
      live, applied environment; left for 7.10/live verification.

---

## 7.8 — Stand up prod

`envs/prod/main.tf` becomes dev's wiring with prod's values. Prod's apply is
`workflow_dispatch` → `apply-prod` → approval.

- [ ] Remove `DATABASE_URL` from prod's `module.secrets` (6.2d did this for
      dev). **Check the plan first:** that parameter exists in prod today, so
      the plan will show it being destroyed, and `prevent_destroy` (6.12)
      will refuse. Remove it from state with a `removed` block, or delete it
      out of band. Record which.
- [ ] `module.network`: VPC CIDR **`10.30.0.0/16`**, not dev's `10.20`. Nothing
      peers them, but distinct ranges keep the option open and keep logs
      unambiguous.
- [ ] `module.rds`: `identifier = dejavu-prod` (it must match 7.3's secret
      condition), `deletion_protection = true`, `skip_final_snapshot = false`
      with a `final_snapshot_identifier`, `apply_immediately = false`,
      `backup_retention_period = 1` (free-plan cap, as 6.7 found; note that
      prod's PITR window is 24 h because of it).
    - `deletion_protection = true` changes D5's destroy loop: tearing prod
      down needs a `ModifyDBInstance` to turn protection off first, and that's
      deliberate. Put it in the runbook (7.11).
- [ ] `module.lambda`: `cors_origins`/`frontend_url` = prod's frontend (7.9),
      alias from 7.2, `initial_image_tag` = **the SHA currently live in dev**,
      never `bootstrap` (correction 7).
- [ ] `module.observability` with alarms (7.7).
- [ ] `module.budget`: prod's `limit_usd` from $5 to a number that fits D5
      (~$30 list, matching dev's). Revisit the **$40 account backstop**:
      both environments at list price is ~$50, so it would fire on day one.
      The whole reason 6.5 moved off $5 was not to have an alarm that always
      fires. Raise it to ~$60, or accept it firing only during the prod window
      and write down that you did.
- [ ] `terraform plan` from a PR → the plan comment for `prod` shows the
      expected resource count (dev's was 28, plus alarms and alias). Apply via
      dispatch → approve.
- [ ] Record the apply time and whether any IAM round was needed (7.3 should
      have made the answer zero).

---

## 7.9 — Prod data, secrets, Stripe, frontend

- [ ] SSM `/dejavu/prod/`: a fresh `JWT_SECRET` (never dev's, since a dev
      admin token must not verify in prod), a test-mode `STRIPE_SECRET_KEY`
      (D6), and `STRIPE_WEBHOOK_SECRET` once the endpoint exists. Set with
      `put-parameter --overwrite` out of band, as in Phase 5.
- [ ] Migrate via the pipeline, not by hand: `workflow_dispatch` `deploy.yml`
      with `environment=prod` and dev's live SHA. That's the first real use of
      the gate, and it should work first time.
- [ ] **Admin bootstrap and catalog** (correction 9). Recommended: a new
      migrator action `{"action":"grant-admin","email":"..."}` that sets
      `isAdmin = true` on an **already-registered** user, allowed in any
      environment and logged as `admin.granted`. Register through the real
      prod frontend, grant, then create the two products through the admin UI
      or API. That exercises the real write path instead of a truncating seed.
      — Code done: `migrator.js` exports and routes `grant-admin`
      (`src/migrator.js`), `userRepo.setAdminById` (`src/repositories/userRepo.js`).
      Still open: the manual prod bootstrap (register via the real prod
      frontend, invoke grant-admin, create the two products) is not part of
      this file scope.
    - [x] Unit-test the action's refusals (unknown email → error, not a silent
      no-op) beside `tests/migrator.test.js`. Also added an integration test
      (`tests/integration/migrator.test.js`) against real Postgres for the
      write path itself.
    - *Considered and rejected:* letting `seed` run in prod behind a
      confirmation flag. It still truncates, and one misread payload would
      wipe prod's orders.
    - The product images must resolve against prod's `FRONTEND_URL`. 6.12's
      bug was exactly this, so check an image URL returns 200 rather than
      assuming it does.
- [ ] Stripe: a **second** test-mode webhook endpoint pointing at prod's alias
      URL, `checkout.session.completed` only, and its own secret in SSM.
      Verify with `stripe trigger` → one `order.created` in **prod's** log
      group and nothing new in dev's.
- [ ] Frontend: prod on its own Vercel production build with `VITE_API_URL` =
      prod's alias URL. Dev keeps `dejavu-seven.vercel.app`. Decide whether
      prod is `dejavustudio.xyz` (the module's default, and the real brand
      domain) or a second Vercel project alias, and record the choice.
      `VITE_API_URL` is inlined at build time, so these are two builds, not
      one build with two configs.
- [ ] Full click-through on prod: browse → cart → test card `4242…` → success
      page → claim the order → order visible in admin.

---

## 7.10 — The checkpoint drill

The execution plan's gate: *deploy a deliberately broken build → smoke test
fails → alias auto-reverts → alarm fires.* Rehearse on dev, then run it for
the record on prod.

**Make the break real, not a flag.** Don't add a `BREAK_ME` environment
variable to the shipped code. A kill switch in prod code is its own bug.

- [ ] **Check the RDS secret's `NextRotationDate` first, and don't drill
      inside the rotation window** (issue #22; the command is in
      `phase-7-runbook.md` stage 10). A rotation blip is a known
      false-positive source for smoke-triggered rollback (7.4, `smoke.sh`).
      Here it would also corrupt the measurement: a stray 5xx in
      `Url5xxCount`, possibly a 5xx alarm the broken build didn't cause, and
      a blip on the rollback's re-smoke. Record `LastRotatedDate` and
      `NextRotationDate` with the numbers.

- [ ] On a throwaway branch `drill/broken-build`, make `GET /api/products`
      throw (the controller, not the route: it has to pass lint and build). The
      image builds, passes Trivy, boots, answers `/api/status` 200, and fails
      exactly one smoke check. That's the realistic kind of failure: the bad
      build is up, and wrong.
- [ ] Get the image into ECR. `dejavu-gha-push` trusts only `refs/heads/main`
      (6.5), and that stays. Push it by hand with admin credentials, as in
      6.7 step 2, tagged with the branch commit's SHA
      (`--provenance=false --sbom=false`). Record that the drill image went in
      by hand and why.
- [ ] **Dev rehearsal:** `workflow_dispatch deploy.yml environment=dev sha=<drill sha>`.
      Expect: migrate is a no-op → publish → shift → `/api/status` 200,
      `/api/version` matches, `/api/products` **500** → rollback → re-smoke
      passes on the previous version → job **red**. Then check the 5xx alarm
      emails ALARM and, a few minutes later, OK.
- [ ] **Prod, for the record:** same dispatch with `environment=prod`, approved
      through the gate. `promote-check.sh` will **refuse**, because dev isn't
      running the drill image, which is correct. For the drill only, run it
      with the check explicitly bypassed by a `drill: true` input that appears
      in the job summary. Don't weaken the check itself. Record that the
      bypass exists and what it's for.
- [ ] Measure and record, from the job log timestamps:
    - time from `update-alias` (bad) → `update-alias` (rollback) = **the
      broken-build exposure window**. The plan's claim is ≤ ~10 s.
    - `Url5xxCount` during the window, and how many real 5xx a user could
      have seen.
    - time until the ALARM email arrives, and until OK.
    - the `/api/version` SHA before and after (it should match).
- [ ] **Second drill, a build that doesn't boot.** Make `src/lambda.js` throw
      at require time on the drill branch. The adapter's readiness check never
      passes, so the Function URL returns 5xx for every request, including
      `/api/status`. Smoke fails on the first check, and the rollback path is
      the same. Run it on dev only. It proves the smoke test doesn't depend on
      the app being up enough to answer.
- [ ] **Third, migration failure (dev only).** A drill migration that fails
      (e.g. `SELECT 1/0;` in the Up section). Expect `migrate.sh` to fail on
      `FunctionError`, `deploy.sh` never to run, the alias not to move, and
      the migrator `Errors` alarm to fire. This is the one that proves
      correction 5 was fixed.
      **Clean up afterwards:** confirm the failed migration isn't recorded in
      `pgmigrations`, and that `main`'s next deploy migrates cleanly.
- [ ] Delete the drill branch and the drill images from ECR
      (`batch-delete-image`; tags are immutable, but images can still be
      deleted). Leave the Lambda versions the drill published for the pruner.
- [ ] Final state: both aliases on the same SHA as `main`, both environments'
      alarms `OK`, one clean `stripe trigger` per environment.

---

## 7.11 — Docs, execution plan, merge

- [ ] `terraform/README.md`: prod first-apply order, the deletion-protection
      step in the teardown runbook, "deploying and rolling back" (automatic
      and manual: `deploy.yml` dispatch with the last good SHA, or `aws lambda
      update-alias` by hand if GitHub is down), and the 7.10 numbers.
- [ ] `CLAUDE.md`: a Deployment section on the pipeline (auto dev → gated
      prod, migrate before shift, aliases, `deploy.yml`/`scripts/deploy/`),
      expand/contract as a rule for anyone writing a migration, and
      `grant-admin`. Update "Phase 6" wording where it now means both
      environments.
- [ ] `backend/MIGRATIONS.md` (7.6).
- [ ] `dejavu-execution-plan.md`: mark Phase 7 and batch H `[x]`; fix rows 3
      and 4 of the Verification table (7.0); add **"What Phase 7 actually
      turned up"**, keeping only the corrections that bit; and update the
      cost table for two environments.
- [ ] "What I'd do differently" for Phase 7. Candidates, keep the ones that
      turned out true: CodeDeploy canary once there's traffic to measure
      (D2); a pre-shift smoke against a candidate alias (D3); a stable
      hostname in front of both URLs (it bit again in 7.2, the third time); a
      concurrency quota separate from dev, or a second account for prod (the
      real "shares nothing"); `job_workflow_ref`-scoped roles (correction
      12); Playwright E2E as the blocking pre-promotion check that the manual
      gate stands in for today.
- [ ] Merge. `terraform.yml` apply-dev should be a no-op, and `deploy.yml`
      should deploy the merge SHA to dev and then **wait at the prod gate**.
      Approve it. That's the first fully hands-off release, and the last box
      in this file.
- [ ] Keep this file in the repo, as with Phase 6.

---

## 7.12 — Project sign-off

What "done" means for Dejavu as a whole, not just Phase 7.

### Every phase's gate, re-checked on the final `main`

- [ ] Phase 0: `git ls-files | grep -c node_modules` → 0; the app refuses to
      boot without `JWT_SECRET` (`boot-check` job green); no open GitHub
      secret-scanning alerts.
- [ ] Phase 1: branch protection still requires `ci`. Confirm on a real PR
      with a failing test, one last time.
- [ ] Phases 2–4: `docker compose up` → migrate → seed → storefront works
      locally; `npm run test:all` green; unit and integration counts recorded.
- [ ] Phase 5: `terraform plan` comments on a PR; fork still can't assume a
      role.
- [ ] Phase 6: live `/api/version` SHA = `main`'s head in both environments.
- [ ] Phase 7: 7.10's drill recorded, with numbers.

### Resume bullets match what's true

- [ ] Re-read every bullet in `dejavu-mvp-roadmap.md` against what was built,
      and edit the bullet where they differ. Known ones: roadmap #5's bullet
      claims **Playwright E2E**, which was deferred (Phase 4). Rewrite it or
      build it; don't leave it. Roadmap #6 says "staging" (D1: dev is
      staging) and "task definition"/"ALB" (it's a Lambda alias and a Function
      URL).
- [ ] Each "be ready to answer" question in roadmap #6 has an answer somewhere
      in this repo, with a pointer. That's the interview prep, and it's cheap
      to do now.

### Loose ends: finish or deliberately defer

Each one is either done or listed under a **"Known limitations"** heading in
`README.md`, with one line on why:
- [ ] Playwright E2E (Phase 4)
- [ ] `idempotencyKey` from the frontend (Phase 3 / 7.0)
- [ ] Least-privilege `dejavu_app` DB role (D8, Phase 6)
- [ ] Retry once on `28P01` (6.10). **Still deferred, now on purpose**
      (issue #22). The deploy-safety concern is covered: `smoke.sh`'s
      retries absorb one blip, and the harness proves it (7.4). What's left
      is a user-facing improvement, namely one invisible failed request per
      warm environment per week. It isn't a correctness fix, and it doesn't
      cover the mid-rotation window either (7.4). For "Known limitations",
      one line: "a weekly secret rotation can cost one failed request per
      warm Lambda environment."
- [ ] Shared rate-limit store or WAF (6.9)
- [ ] User-enumeration timing on login (6.9: 401 before bcrypt when the email
      doesn't exist)
- [ ] SSM `value_wo` so secret values leave state (Phase 5)
- [ ] IAM Identity Center instead of the static admin key (6.0)

### Top-level `README.md`

- [ ] Rewrite it for a reader who arrives from a resume link and gives it
      two minutes: what Dejavu is, an architecture diagram (Vercel → Function
      URL → Lambda alias → RDS, NAT → Stripe, the pipeline), how to run it
      locally, the correctness claims with links to the tests that prove them,
      the deploy/rollback story with 7.10's numbers, cost, and Known
      limitations. Link the execution plan and the `phase-*-steps.md` files
      for depth.

### Leave the account in a known state

- [ ] Decide dev's and prod's resting state (D5 recommends both destroyed to
      the ~$0.20 floor). Run the targeted destroys, turning off
      `deletion_protection` first for prod, and confirm in the console that no
      VPC, ENI, RDS instance, NAT or public IP is left.
- [ ] Confirm the Stripe webhook endpoints: either leave them in place
      (harmless; they'll fail delivery while the URL is gone, and each needs a
      URL update after the next apply anyway) or disable them. Write down which.
- [ ] Last Cost Explorer check a few days after teardown, to confirm the floor
      is real.
- [ ] Tag the release: `git tag v1.0.0` on the final `main` SHA, with a short
      release note pointing at the README.

---

## Exit criteria

- [ ] A merge to `main` deploys to dev (staging) with no human action, and
      prod deploys the **same image digest** only after an approval.
- [ ] Migrations run through the migrator Lambda before traffic shifts, and a
      failing migration stops the deploy with the alias unmoved (7.10, third
      drill).
- [ ] A deliberately broken build is rolled back automatically, the exposure
      window is measured, and an alarm emails both ALARM and OK (7.10).
- [ ] CI blocks a destructive migration without a `-- contract:` justification,
      verified by mutation (7.6).
- [ ] Four alarm classes (5xx, errors, throttles, oversell/failed checkout) are
      each proven to route to email, and their metrics are verified to exist.
- [ ] Prod shares no database, secret, network or state with dev, and the
      monthly cost of that choice is written down.
- [ ] 7.12 complete: the project is signed off.

---

## Cost

List prices, us-east-1, per month, around the clock. Check against 7.0's
Cost Explorer numbers and correct them.

| Item | Dev | Prod |
|---|---|---|
| RDS `db.t4g.micro` + 20 GB gp3 + backups | ~$14 | ~$14 |
| NAT `t4g.micro` + public IPv4 + root volume | ~$10.50 | ~$10.50 |
| Secrets Manager (RDS secret) | $0.40 | $0.40 |
| Lambda, CloudWatch Logs, alarms, SNS email | ~$0–1 | ~$0–1 |
| ECR (shared, both repos) | ~$0.20 | — |
| **Total** | **~$25–26** | **~$25** |
| **Both up** | **~$50/month (~$1.65/day)** | |

**On this account (Free plan):** the free tier covers **one** `db.t4g.micro`
for 750 h a month. Two RDS instances around the clock is 1,440 h, and the
NAT and public-IPv4 hours double too, so with prod up the extra hours draw
down the remaining credits ($159.59 at 6.12) rather than billing $0. At ~$25
extra a month that's months of runway, not days. But it's no longer the "$0
actually paid" story, and the budgets (7.8) should reflect it.

**D5's resting state:** both environments destroyed, with bootstrap, ECR and
SSM kept: ~$0.20/month. Bringing one environment back takes ~13 min plus a
pipeline deploy, and prod's teardown adds one `deletion_protection` toggle.

---

## Explicitly out of scope

Blue/green or canary traffic shifting (D2); multi-AZ RDS or a second NAT;
a custom domain or CloudFront (listed as "what I'd do differently" again);
a separate AWS account for prod; RDS Proxy; auto-refund on oversell (the alarm
hands it to a human, per Phase 3). Everything here is justified by the
execution plan's first honesty rule: claim nothing the traffic doesn't
support.
