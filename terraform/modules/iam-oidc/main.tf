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
  #
  # The tag actions are separate from ModifyBudget. AWS provider 6.x calls
  # ListTagsForResource on every refresh and TagResource to apply default_tags,
  # so without them the apply role cannot even read a budget it already owns.
  statement {
    sid    = "ManageBudgets"
    effect = "Allow"
    actions = [
      "budgets:ViewBudget",
      "budgets:ModifyBudget",
      "budgets:ListTagsForResource",
      "budgets:TagResource",
      "budgets:UntagResource",
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

  # --- Everything below is Phase 6, and only present when
  # enable_workload_infrastructure is true (dev only, per D6). ---

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "PassWorkloadRoleToLambda"
      effect    = "Allow"
      actions   = ["iam:PassRole"]
      resources = [var.workload_role_arn]

      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["lambda.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "ReadWorkloadRole"
      effect    = "Allow"
      actions   = ["iam:GetRole"]
      resources = [var.workload_role_arn]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "Ec2VpcDescribe"
      effect    = "Allow"
      actions   = ["ec2:Describe*"]
      resources = ["*"]
    }
  }

  # RunInstances touches image, subnet, SG, ENI and volume resources, and only
  # some of them take tag conditions (correction/step note).
  #
  # Found by real AccessDenied in 6.7: many of these actions create a
  # resource *inside* an existing VPC, and EC2 authorizes the call against
  # BOTH the new resource (which aws:RequestTag/Project covers) AND the
  # parent VPC it's being created in (which isn't being tagged by this call,
  # so aws:RequestTag never matches for that leg - it needs
  # aws:ResourceTag/Project instead, since the parent VPC already carries the
  # tag by the time a subnet/SG/instance is created inside it). Actions that
  # touch an existing VPC/IGW at all - even ones that create nothing new,
  # like AttachInternetGateway or CreateRoute - are granted only via
  # ResourceTag, in the Ec2VpcModifyDelete statement below; actions that
  # create a genuinely new resource are granted in both statements, so
  # whichever leg IAM is checking finds a match.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "Ec2VpcCreate"
      effect = "Allow"
      actions = [
        "ec2:CreateVpc",
        "ec2:CreateSubnet",
        "ec2:CreateRouteTable",
        "ec2:CreateInternetGateway",
        "ec2:CreateSecurityGroup",
        "ec2:CreateNetworkInterface",
        "ec2:RunInstances",
        # Found in 6.7: the provider tags a brand-new resource with a
        # separate CreateTags call rather than folding default_tags into the
        # create call's own TagSpecifications. That resource has no tags yet,
        # so aws:ResourceTag can't match - only aws:RequestTag can, here.
        "ec2:CreateTags",
        # aws_vpc_security_group_{ingress,egress}_rule creates a distinct,
        # separately-ARNed "security-group-rule" resource (AWS's newer
        # per-rule model) rather than mutating the security group itself.
        # That new rule resource starts untagged, same reasoning as
        # CreateTags above - only RequestTag matches for creating it.
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
      ]
      resources = ["*"]

      condition {
        test     = "StringEquals"
        variable = "aws:RequestTag/Project"
        values   = ["dejavu"]
      }
    }
  }

  # RunInstances is authorized against every resource type it touches, not
  # just the new instance: the AMI, the subnet, the security group, the
  # auto-created network interface and the auto-created root volume. Found
  # via a real AccessDenied naming network-interface/* specifically - the
  # instance's own tag spec doesn't extend to the ENI or the AMI, so neither
  # RequestTag nor ResourceTag can match for those two. Subnet, security
  # group and volume are already tagged (or, for the volume, covered by
  # RequestTag in the statement above), so this is scoped to exactly the two
  # resource types that can never carry our tag.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "Ec2RunInstancesUntaggableComponents"
      effect = "Allow"
      actions = [
        "ec2:RunInstances",
      ]
      resources = [
        "arn:aws:ec2:${var.aws_region}:${var.account_id}:network-interface/*",
        "arn:aws:ec2:${var.aws_region}::image/*",
      ]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "Ec2VpcModifyDelete"
      effect = "Allow"
      actions = [
        # Also-created-elsewhere actions, granted here too for the
        # parent-VPC leg of authorization (see comment above).
        "ec2:CreateSubnet",
        "ec2:CreateRouteTable",
        "ec2:CreateSecurityGroup",
        "ec2:CreateNetworkInterface",
        "ec2:RunInstances",
        # Actions that tag or touch an existing resource, never a new one.
        "ec2:CreateTags",
        "ec2:DeleteTags",
        "ec2:CreateRoute",
        "ec2:AttachInternetGateway",
        "ec2:DetachInternetGateway",
        "ec2:ModifyVpcAttribute",
        "ec2:ModifySubnetAttribute",
        "ec2:ModifyInstanceAttribute",
        "ec2:ModifyNetworkInterfaceAttribute",
        "ec2:AssociateRouteTable",
        "ec2:DisassociateRouteTable",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:AssociateAddress",
        "ec2:DisassociateAddress",
        "ec2:StopInstances",
        "ec2:StartInstances",
        "ec2:TerminateInstances",
        "ec2:DeleteVpc",
        "ec2:DeleteSubnet",
        "ec2:DeleteRouteTable",
        "ec2:DeleteRoute",
        "ec2:DeleteInternetGateway",
        "ec2:DeleteSecurityGroup",
        "ec2:DeleteNetworkInterface",
      ]
      resources = ["*"]

      condition {
        test     = "StringEquals"
        variable = "aws:ResourceTag/Project"
        values   = ["dejavu"]
      }
    }
  }

  # RDS's storage_encrypted uses the account's default aws/rds key. The key
  # exists and is enabled at the account level, but the calling principal
  # still needs its own grant to use it - found via a real
  # KMSKeyNotAccessibleFault on the first CreateDBInstance attempt.
  # ViaService keeps this from being a general-purpose decryption grant, same
  # pattern as EncryptDecryptThroughSSM above.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "EncryptDecryptThroughRds"
      effect = "Allow"
      actions = [
        "kms:DescribeKey",
        "kms:CreateGrant",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]
      resources = ["*"]

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["rds.${var.aws_region}.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "RdsDescribe"
      effect    = "Allow"
      actions   = ["rds:Describe*"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "RdsManageOwn"
      effect = "Allow"
      actions = [
        "rds:CreateDBInstance",
        "rds:ModifyDBInstance",
        "rds:DeleteDBInstance",
        "rds:CreateDBSubnetGroup",
        "rds:ModifyDBSubnetGroup",
        "rds:DeleteDBSubnetGroup",
        "rds:CreateDBParameterGroup",
        "rds:ModifyDBParameterGroup",
        "rds:DeleteDBParameterGroup",
        "rds:AddTagsToResource",
        "rds:RemoveTagsFromResource",
        "rds:ListTagsForResource",
        "rds:RestoreDBInstanceToPointInTime",
      ]
      resources = [
        "arn:aws:rds:${var.aws_region}:${var.account_id}:db:dejavu-*",
        "arn:aws:rds:${var.aws_region}:${var.account_id}:subgrp:dejavu-*",
        "arn:aws:rds:${var.aws_region}:${var.account_id}:pg:dejavu-*",
      ]
    }
  }

  # For the RDS-managed master password secret (manage_master_user_password).
  # Reading its value belongs to the workload role, not this one.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageRdsManagedSecret"
      effect = "Allow"
      actions = [
        "secretsmanager:CreateSecret",
        "secretsmanager:TagResource",
        "secretsmanager:UntagResource",
        "secretsmanager:ListTagsForResource",
        "secretsmanager:RotateSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:DeleteSecret",
      ]
      resources = ["arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:rds!*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageLambda"
      effect = "Allow"
      actions = [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListVersionsByFunction",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags",
        "lambda:CreateFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency",
        "lambda:GetFunctionConcurrency",
        # 7.2: the alias Terraform now owns the lifecycle of, and the
        # published version it points at. PublishVersion is also required by
        # AWS whenever UpdateFunctionCode/CreateFunction is called with
        # Publish=true, which is a separate grant from UpdateFunctionCode
        # itself. The "dejavu-*" resource pattern below already covers
        # qualified ARNs (a version or alias suffix is just ":<name>" glued
        # onto the same string, and "*" matches colons too), so no separate
        # resource entry is needed for these.
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:DeleteAlias",
        "lambda:GetAlias",
        "lambda:ListAliases",
        "lambda:PublishVersion",
      ]
      resources = ["arn:aws:lambda:${var.aws_region}:${var.account_id}:function:dejavu-*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure && length(var.ecr_repository_arns) > 0 ? [1] : []
    content {
      sid    = "ReadEcrImages"
      effect = "Allow"
      actions = [
        "ecr:DescribeRepositories",
        "ecr:ListTagsForResource",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:DescribeImages",
      ]
      resources = var.ecr_repository_arns
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageLambdaLogGroups"
      effect = "Allow"
      actions = [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource",
        "logs:ListTagsForResource",
      ]
      resources = ["arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/dejavu-*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "DescribeLambdaLogGroups"
      effect    = "Allow"
      actions   = ["logs:DescribeLogGroups"]
      resources = ["*"]
    }
  }

  # The apply role only has /dejavu/<env>/* today; the NAT instance's AMI
  # comes from AWS's own public parameter namespace.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "ReadPublicAmiParameter"
      effect    = "Allow"
      actions   = ["ssm:GetParameter"]
      resources = ["arn:aws:ssm:${var.aws_region}::parameter/aws/service/*"]
    }
  }

  # --- 7.7: alarms and SNS. Same gate as the rest of this block, so it now
  # applies to both dev and prod once 7.3 turns enable_workload_infrastructure
  # on for prod's apply role too.
  #
  # This list is exactly what the 7.7 plan section specifies; it has not been
  # exercised against a live apply in this session (no AWS credentials).
  # Expect the provider's tag read-back to want at least one more action
  # once a real apply hits an AccessDenied - the same pattern 6.5/6.7 hit
  # repeatedly for budgets, EC2 and ECR - and fix it there rather than guess
  # further here.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageAlarmSns"
      effect = "Allow"
      actions = [
        "sns:*Topic*",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:*Attributes",
        "sns:*Tag*",
      ]
      resources = ["arn:aws:sns:${var.aws_region}:${var.account_id}:dejavu-*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageAlarms"
      effect = "Allow"
      actions = [
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListTagsForResource",
        "cloudwatch:TagResource",
      ]
      resources = ["arn:aws:cloudwatch:${var.aws_region}:${var.account_id}:alarm:dejavu-*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "ManageLogMetricFilters"
      effect = "Allow"
      actions = [
        "logs:PutMetricFilter",
        "logs:DeleteMetricFilter",
      ]
      resources = ["arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/dejavu-*"]
    }
  }

  # A list call, same reasoning as DescribeLambdaLogGroups above.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid       = "DescribeLogMetricFilters"
      effect    = "Allow"
      actions   = ["logs:DescribeMetricFilters"]
      resources = ["*"]
    }
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
  # Phase 5 shape: no IAM access at all. Unchanged for any role where
  # enable_workload_infrastructure is false (prod, until Phase 7).
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [] : [1]
    content {
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

  # Phase 6 shape: IAM is denied everywhere except the one named workload
  # role, and even there only Get*/List* and PassRole survive - every
  # mutating action on that role is denied by the second statement below. IAM
  # can't subtract actions from inside one statement, hence two Denies. The
  # net effect is read + PassRole on one role, and nothing else in IAM.
  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid           = "NoIdentityManagementExceptWorkloadRole"
      effect        = "Deny"
      actions       = ["iam:*"]
      not_resources = [var.workload_role_arn]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "NoOrgOrAccountManagement"
      effect = "Deny"
      actions = [
        "organizations:*",
        "account:*",
      ]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_workload_infrastructure ? [1] : []
    content {
      sid    = "NoMutatingWorkloadRoleManagement"
      effect = "Deny"
      actions = [
        "iam:Create*",
        "iam:Delete*",
        "iam:Put*",
        "iam:Attach*",
        "iam:Detach*",
        "iam:Update*",
        "iam:Tag*",
        "iam:Untag*",
      ]
      resources = [var.workload_role_arn]
    }
  }
}

resource "aws_iam_role_policy" "apply_deny_iam" {
  name   = "deny-identity-management"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply_boundary_deny.json
}
