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

## The dependency nobody writes down

Environment protection rules are **free on public repositories** and a **paid
feature on private ones**. If this repository is ever made private on a Free
plan, the protection rules stop applying — but GitHub still stamps
`environment:production` into the OIDC token, so the trust policy still matches
and the apply role becomes assumable from any workflow run that names the
environment. The security control fails open, silently, while the Terraform
still reads as though it were enforced.

If the repo goes private, GitHub Pro is not optional.
