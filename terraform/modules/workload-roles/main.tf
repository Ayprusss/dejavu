/**
 * Account-level image registry, the role CI uses to push to it, and one
 * Lambda execution role per environment that runs images from it.
 *
 * ECR and the push role are account-level: one image is promoted dev -> prod
 * by SHA (Phase 7), so they can't belong to either environment's Terraform
 * state. The workload role is per-environment, because its Secrets Manager
 * grant is scoped to one environment's database.
 */

locals {
  oidc_host = "token.actions.githubusercontent.com"

  # Conditions Lambda's own SourceArn against, so only a dejavu-* function can
  # pull from these repositories - not just any Lambda in the account.
  function_arn_pattern = "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-*"
}

# ---------------------------------------------------------------------------
# ECR repositories
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "this" {
  for_each = toset(var.ecr_repository_names)

  name = each.value

  # Makes "never overwrite a SHA tag" an AWS guarantee rather than a
  # convention.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last ${var.ecr_keep_tagged_count} tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = var.ecr_keep_tagged_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Lets Lambda pull without the apply role ever needing ecr:SetRepositoryPolicy
# (correction/step note: this is set here, once, in bootstrap).
resource "aws_ecr_repository_policy" "lambda_pull" {
  for_each = aws_ecr_repository.this

  repository = each.value.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowLambdaPull"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
      Condition = {
        StringLike = {
          "aws:SourceArn" = local.function_arn_pattern
        }
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# Push role
#
# Trusted for pushes to main only (PRs excluded). Pushing an immutable,
# SHA-tagged image deploys nothing - the deploy is the separate, gated
# `update-function-code` step - so a ref-scoped trust is acceptable here even
# though Phase 5 rejected it for the apply role.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "push_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "push" {
  name        = "dejavu-gha-push"
  description = "Pushes immutable, SHA-tagged images to ECR for ${var.github_repository}. Cannot deploy anything by itself."

  assume_role_policy   = data.aws_iam_policy_document.push_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "push" {
  statement {
    sid       = "GetAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PushImages"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }
}

resource "aws_iam_role_policy" "push" {
  name   = "push-images"
  role   = aws_iam_role.push.id
  policy = data.aws_iam_policy_document.push.json
}

# ---------------------------------------------------------------------------
# Workload role - the Lambda execution role.
#
# One role serves both the API and the migrator function in Phase 6 (D3).
# Splitting it is a Phase 7 note.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "workload_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workload" {
  for_each = var.workload_environments

  name        = "dejavu-${each.key}-lambda"
  description = "Lambda execution role for dejavu ${each.key} (api + migrator)"

  assume_role_policy = data.aws_iam_policy_document.workload_trust.json
}

# ENI management for the VPC config, plus CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "workload_vpc_access" {
  for_each = var.workload_environments

  role       = aws_iam_role.workload[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "workload" {
  for_each = var.workload_environments

  statement {
    sid    = "ReadOwnParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParametersByPath",
      "ssm:GetParameters",
      "ssm:GetParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/dejavu/${each.key}",
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/dejavu/${each.key}/*",
    ]
  }

  # RDS-managed secret names are random, but the DB identifier is ours, so
  # this scopes each environment's role to its own database without a
  # cross-config reference. AWS's own documented pattern for this restricts on
  # the secret's `aws:rds:primaryDBInstanceArn` tag via the
  # secretsmanager:ResourceTag condition key - verify the exact tag key on the
  # created secret in 6.7, and fix this condition if it differs.
  statement {
    sid       = "ReadOwnDbSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:rds!*"]

    condition {
      test     = "StringEquals"
      variable = "secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn"
      values   = ["arn:aws:rds:${var.aws_region}:${var.account_id}:db:${each.value.rds_identifier}"]
    }
  }
}

resource "aws_iam_role_policy" "workload" {
  for_each = var.workload_environments

  name   = "dejavu-${each.key}-workload"
  role   = aws_iam_role.workload[each.key].id
  policy = data.aws_iam_policy_document.workload[each.key].json
}

# ---------------------------------------------------------------------------
# Deploy roles - one per environment (7.3, D8).
#
# A dedicated role per environment, separate from the Terraform apply role in
# modules/iam-oidc: deploys happen on every merge to main, applies happen
# rarely, and a deploy role can touch exactly two Lambda functions - it
# cannot create a VPC, delete an RDS instance or edit SSM. Trust is scoped to
# the GitHub Environment the same way modules/iam-oidc's apply role is
# (correction 12: a prod apply job and a prod deploy job both present
# `environment:production` in `sub`, so this split is least privilege for
# mistakes, not a security boundary that can tell the two jobs apart -
# GitHub's required-reviewer gate is the actual control on both).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy_trust" {
  for_each = var.deploy_environments

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repository}:environment:${each.value.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each = var.deploy_environments

  name        = "dejavu-gha-deploy-${each.key}"
  description = "Deploys dejavu-${each.key}-api and -migrator: publishes versions, shifts the live alias, invokes the migrator. Cannot touch any other infrastructure."

  assume_role_policy   = data.aws_iam_policy_document.deploy_trust[each.key].json
  max_session_duration = 3600
}

locals {
  # Unqualified plus qualified (any version or alias) ARNs for one
  # environment's two functions. A qualified Lambda ARN is the unqualified
  # one with a literal ":<version-or-alias>" appended, and IAM's "*"
  # wildcard matches that suffix - including the colon - without ever
  # matching the *absence* of a colon. So "function:name:*" as a resource
  # matches every qualified ARN and, provably, none of the unqualified one:
  # the pattern requires the literal characters "function:name:" to appear in
  # the string being tested, and the unqualified ARN doesn't contain that
  # trailing colon at all. This is the answer to 7.3's "verify whether IAM
  # can separate qualified and unqualified function ARNs" - it can, cleanly,
  # with no condition key needed. Used below to let DeleteFunction prune
  # versions without ever being able to delete the function itself.
  deploy_function_arns = {
    for env, cfg in var.deploy_environments : env => flatten([
      for fn in ["api", "migrator"] : [
        "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-${fn}",
        "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-${fn}:*",
      ]
    ])
  }

  deploy_migrator_arns = {
    for env, cfg in var.deploy_environments : env => [
      "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-migrator",
      "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-migrator:*",
    ]
  }

  deploy_unqualified_function_arns = {
    for env, cfg in var.deploy_environments : env => [
      "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-api",
      "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-${env}-migrator",
    ]
  }
}

data "aws_iam_policy_document" "deploy" {
  for_each = var.deploy_environments

  # Read, update and publish this environment's two functions, and move the
  # live alias to point at a new version. DeleteFunction is granted only on
  # the ":*"-suffixed (qualified) resources above, for deploy.sh's version
  # pruning - see the comment on deploy_function_arns for why that resource
  # scoping already excludes the unqualified function, with no separate
  # condition needed.
  statement {
    sid    = "ManageOwnFunctions"
    effect = "Allow"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
      "lambda:ListVersionsByFunction",
      "lambda:DeleteFunction",
      "lambda:GetAlias",
      "lambda:UpdateAlias",
      # deploy.sh and terraform.yml's republish both find the smoke-test URL
      # with get-function-url-config --qualifier live.
      "lambda:GetFunctionUrlConfig",
    ]
    resources = local.deploy_function_arns[each.key]
  }

  # promote-check.sh runs in the prod deploy job and compares the digest
  # prod is about to run with what dev's live alias is running (D4). That's
  # a read of dev's api, so prod's role gets exactly that read and nothing
  # else of dev's. Dev's role needs no such statement.
  dynamic "statement" {
    for_each = each.key == "prod" ? [1] : []
    content {
      sid       = "ReadDevLiveForPromoteCheck"
      effect    = "Allow"
      actions   = ["lambda:GetFunction"]
      resources = ["arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-dev-api:live"]
    }
  }

  # scripts/deploy/migrate.sh is the only script that invokes anything, and
  # only the migrator - the api never receives an Invoke call, only traffic
  # through its Function URL.
  statement {
    sid       = "InvokeMigratorOnly"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = local.deploy_migrator_arns[each.key]
  }

  # UpdateFunctionCode with an image URI checks the *caller's* ECR access as
  # well as the execution role's (that one's covered by the repository policy
  # above), so the deploy role needs its own read grant.
  statement {
    sid    = "ReadEcrImages"
    effect = "Allow"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
    ]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }

  statement {
    sid       = "WhoAmI"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = var.deploy_environments

  name   = "deploy-${each.key}"
  role   = aws_iam_role.deploy[each.key].id
  policy = data.aws_iam_policy_document.deploy[each.key].json
}

# Belt-and-suspenders on top of the resource scoping above: even if a future
# edit widens ManageOwnFunctions' resource list by mistake, this Deny still
# stops DeleteFunction from ever reaching the bare, unqualified function ARN.
# An explicit Deny beats every Allow in IAM evaluation (same reasoning as
# modules/iam-oidc's apply_boundary_deny), which is what makes this a ceiling
# rather than a second copy of the same intent.
data "aws_iam_policy_document" "deploy_deny_delete_unqualified" {
  for_each = var.deploy_environments

  statement {
    sid       = "DenyDeleteUnqualifiedFunction"
    effect    = "Deny"
    actions   = ["lambda:DeleteFunction"]
    resources = local.deploy_unqualified_function_arns[each.key]
  }
}

resource "aws_iam_role_policy" "deploy_deny_delete_unqualified" {
  for_each = var.deploy_environments

  name   = "deny-delete-unqualified-function"
  role   = aws_iam_role.deploy[each.key].id
  policy = data.aws_iam_policy_document.deploy_deny_delete_unqualified[each.key].json
}
