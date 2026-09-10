/**
 * Account-level, create-once infrastructure.
 *
 * Two kinds of thing live here, and neither can live in envs/:
 *
 *   1. The S3 bucket every other config uses as its Terraform backend. A
 *      backend cannot store the state of its own creation, so this config
 *      starts on local state and then migrates into the bucket it just made.
 *
 *   2. The GitHub OIDC provider and the IAM roles CI assumes. These are
 *      applied by a human with admin credentials, never by CI, and that is
 *      deliberate: if the apply role could manage IAM it could widen its own
 *      permissions, and "narrow apply role" would be decoration. CI cannot
 *      edit the shape of its own access.
 *
 * Applied once, by hand. See README.md in this directory.
 */

terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70, < 7.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "dejavu"
      ManagedBy = "terraform"
      Config    = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Bucket names are globally unique across all of AWS, so the account id is
  # the cheapest thing that guarantees this one is available.
  state_bucket_name = coalesce(
    var.state_bucket_name,
    "dejavu-tfstate-${data.aws_caller_identity.current.account_id}",
  )
}

# ---------------------------------------------------------------------------
# Terraform state bucket
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name

  # State is the only record of what exists. Deleting it by accident means
  # reconciling reality by hand, so make the destroy path deliberate.
  lifecycle {
    prevent_destroy = true
  }
}

# The single most important setting here. A corrupt or truncated state file is
# recoverable only if the previous version still exists.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Keep old state versions long enough to recover from a bad apply, not forever.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Refuse any request that did not arrive over TLS. S3 is encrypted at rest by
# the rule above; this covers it in transit.
resource "aws_s3_bucket_policy" "state_tls_only" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.state.arn,
        "${aws_s3_bucket.state.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# GitHub OIDC identity provider
# ---------------------------------------------------------------------------

# One per account per issuer URL — creating a second is an error, which is why
# it belongs here and is consumed by envs/ through a data source.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS stopped validating this for providers behind a trusted root CA, and
  # GitHub's certificate rotates. It is kept because the API still accepts the
  # field and an empty list is rejected by older provider versions; nothing
  # here depends on the value being current.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# ---------------------------------------------------------------------------
# CI roles, one pair per environment
# ---------------------------------------------------------------------------

module "roles_dev" {
  source = "../modules/iam-oidc"

  environment       = "dev"
  github_repository = var.github_repository
  oidc_provider_arn = aws_iam_openid_connect_provider.github.arn
  state_bucket_arn  = aws_s3_bucket.state.arn
  aws_region        = var.aws_region
  account_id        = data.aws_caller_identity.current.account_id

  # Merging to main deploys dev automatically, so the gate is the branch, not
  # a reviewer. GitHub still stamps `environment:dev` into the token.
  github_environment = "dev"
}

module "roles_prod" {
  source = "../modules/iam-oidc"

  environment       = "prod"
  github_repository = var.github_repository
  oidc_provider_arn = aws_iam_openid_connect_provider.github.arn
  state_bucket_arn  = aws_s3_bucket.state.arn
  aws_region        = var.aws_region
  account_id        = data.aws_caller_identity.current.account_id

  # The whole security model. `environment:production` is only present in the
  # token once GitHub has run the environment's protection rules, so a required
  # reviewer stands between a merge and an apply.
  github_environment = "production"
}
