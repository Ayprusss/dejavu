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
