/**
 * Dejavu - dev environment.
 *
 * Phase 5 scope: the secrets this application needs, and a cost ceiling.
 * The IAM roles CI uses to apply this are NOT here - they live in
 * terraform/bootstrap and are applied by a human, so that the apply role
 * cannot widen its own permissions.
 *
 * Phase 6 adds the network, rds, lambda and observability modules alongside
 * these. Nothing in this directory costs money today.
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
      Project     = "dejavu"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

module "secrets" {
  source = "../../modules/secrets"

  environment = var.environment

  # Names match what backend/src/config/env.js validates at boot, so the
  # mapping from parameter to environment variable in Phase 6 is one to one
  # and needs no translation table.
  parameters = {
    JWT_SECRET            = "Signs and verifies every JWT, including admin tokens"
    STRIPE_SECRET_KEY     = "Stripe API key used by checkoutController"
    STRIPE_WEBHOOK_SECRET = "Verifies the signature on every Stripe webhook delivery"

    # Phase 6 moves this one to Secrets Manager, where RDS can rotate it.
    # Until an RDS instance exists there is nothing to rotate.
    DATABASE_URL = "Postgres connection string (moves to Secrets Manager in Phase 6)"
  }
}

module "budget" {
  source = "../../modules/budget"

  environment        = var.environment
  limit_usd          = var.budget_limit_usd
  notification_email = var.budget_notification_email
}
