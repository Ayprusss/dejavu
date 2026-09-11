/**
 * One pair of GitHub Actions roles for a single environment.
 *
 *   plan  - read-only, assumed on pull requests, produces the plan posted to
 *           the PR. Cannot change anything.
 *   apply - narrow write access to exactly the resources this project owns,
 *           assumed only from a job that names the GitHub environment.
 *
 * There are no AWS access keys anywhere in this design. GitHub mints a short
 * lived OIDC token per job; STS exchanges it for credentials that expire in an
 * hour. Nothing long-lived exists to leak.
 */

locals {
  name_prefix = "dejavu-gha-${var.environment}"

  oidc_host = "token.actions.githubusercontent.com"

  # SSM parameters this environment owns. Everything else in the account is
  # out of reach for the apply role.
  parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/dejavu/${var.environment}"
}

# ---------------------------------------------------------------------------
# Trust policies
# ---------------------------------------------------------------------------

# `aud` proves the token was minted for STS. `sub` proves which repository and
# which context inside it. Without the `sub` condition any GitHub repository on
# the internet could assume this role - the provider alone authenticates
# "GitHub Actions", not "your GitHub Actions".
data "aws_iam_policy_document" "plan_trust" {
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
      values = [
        # Pull requests opened from a branch of this repository. Pull requests
        # from forks never reach here: GitHub does not grant `id-token: write`
        # to a fork workflow run, so no token is minted to exchange.
        "repo:${var.github_repository}:pull_request",

        # Pushes to main, so the post-merge plan runs before an apply.
        "repo:${var.github_repository}:ref:refs/heads/main",
      ]
    }
  }
}

data "aws_iam_policy_document" "apply_trust" {
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

    # Scoped to the environment, not to `ref:refs/heads/main`.
    #
    # A ref-scoped role is assumable by any workflow that runs on main, which
    # includes a workflow added by a merged PR. GitHub only puts
    # `environment:<name>` in the token after that environment protection
    # rules have passed, so with a required reviewer this claim cannot be
    # obtained without a human approving the deployment.
    #
    # This depends on the repository staying public: environment protection
    # rules are a paid feature on private repositories, and without them the
    # claim is still issued but nothing is gating it.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

resource "aws_iam_role" "plan" {
  name               = "${local.name_prefix}-plan"
  description        = "Read-only Terraform plan role for ${var.github_repository} (${var.environment})"
  assume_role_policy = data.aws_iam_policy_document.plan_trust.json

  # An hour is longer than any plan takes and shorter than a working day.
  max_session_duration = 3600
}

resource "aws_iam_role" "apply" {
  name               = "${local.name_prefix}-apply"
  description        = "Terraform apply role for ${var.github_repository} (${var.environment})"
  assume_role_policy = data.aws_iam_policy_document.apply_trust.json

  max_session_duration = 3600
}

# ---------------------------------------------------------------------------
# Plan role permissions
# ---------------------------------------------------------------------------

# Everything Terraform reads to build a plan, and nothing that writes.
resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  # Read the state file. Not write it: `terraform plan` never persists state.
  statement {
    sid       = "ReadState"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${var.state_bucket_arn}/dejavu/${var.environment}/*"]
  }

  statement {
    sid       = "ListStateBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.state_bucket_arn]
  }

  # Terraform 1.11 locks through an S3 object next to the state file rather
  # than a DynamoDB table. Taking a lock is a write, so a genuinely read-only
  # role still needs these two actions - on the lock file only.
  statement {
    sid       = "StateLock"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.state_bucket_arn}/dejavu/${var.environment}/terraform.tfstate.tflock"]
  }

  # Refreshing an aws_ssm_parameter reads its value, and a SecureString value
  # comes back decrypted. ViaService keeps this from being a general-purpose
  # decryption grant: it only works when SSM is the caller.
  statement {
    sid       = "DecryptThroughSSM"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "terraform-state-read"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}

# ---------------------------------------------------------------------------
# Apply role permissions
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "apply" {
  statement {
    sid    = "StateReadWrite"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${var.state_bucket_arn}/dejavu/${var.environment}/*"]
  }

  statement {
    sid       = "ListStateBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.state_bucket_arn]
  }

  # Named to this environment prefix. The apply role for dev cannot read,
  # write or delete a production secret.
  statement {
    sid    = "ManageOwnParameters"
    effect = "Allow"
    actions = [
      "ssm:PutParameter",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParameterHistory",
      "ssm:DeleteParameter",
      "ssm:AddTagsToResource",
      "ssm:RemoveTagsFromResource",
      "ssm:ListTagsForResource",
      "ssm:LabelParameterVersion",
    ]
    resources = ["${local.parameter_arn_prefix}/*"]
  }

  # DescribeParameters is an account-wide list call and cannot be scoped to an
  # ARN. It returns metadata only - never a value.
  statement {
    sid       = "DescribeParameters"
    effect    = "Allow"
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"]
  }

  statement {
    sid       = "EncryptDecryptThroughSSM"
    effect    = "Allow"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  # Budgets is a global service whose resource-level permissions are limited;
  # this is scoped by action and by account.
  statement {
    sid    = "ManageBudgets"
    effect = "Allow"
    actions = [
      "budgets:ViewBudget",
      "budgets:ModifyBudget",
    ]
    resources = ["arn:aws:budgets::${var.account_id}:budget/*"]
  }

  # Reading tags and identity is how Terraform refreshes.
  statement {
    sid       = "ReadIdentityAndTags"
    effect    = "Allow"
    actions   = ["tag:GetResources", "sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apply" {
  name   = "terraform-apply-${var.environment}"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}

# An explicit ceiling, independent of the grants above. Even if a later phase
# widens the apply policy by mistake, the role cannot touch IAM, cannot create
# users or keys, and cannot escalate its own privileges. An explicit Deny beats
# every Allow in IAM evaluation, which is what makes this a ceiling rather than
# a suggestion.
data "aws_iam_policy_document" "apply_boundary_deny" {
  statement {
    sid    = "NoIdentityManagement"
    effect = "Deny"
    actions = [
      "iam:*",
      "organizations:*",
      "account:*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apply_deny_iam" {
  name   = "deny-identity-management"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply_boundary_deny.json
}
