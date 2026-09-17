/**
 * Dejavu - dev environment.
 *
 * Phase 5 scope: the secrets this application needs, and a cost ceiling.
 * The IAM roles CI uses to apply this are NOT here - they live in
 * terraform/bootstrap and are applied by a human, so that the apply role
 * cannot widen its own permissions.
 *
 * Phase 6 adds the network, rds, lambda and observability modules alongside
 * these (D6: dev only - envs/prod stays as it is until Phase 7). Applying
 * this directory now starts billing (~$22-23/mo, see terraform/README.md and
 * phase-6-steps.md's Cost table) - `module.secrets` and `module.budget` are
 * still the only $0 pieces.
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
  #
  # No DATABASE_URL here: the password lives in the RDS-managed secret that
  # `modules/rds` creates (manage_master_user_password = true), fetched
  # lazily per-connection by backend/src/db/credentials.js. The rest of the
  # connection (DB_HOST, DB_PORT, DB_NAME, DB_SECRET_ARN) is non-secret and
  # is set directly as Lambda environment variables by `modules/lambda`, not
  # routed through SSM.
  parameters = {
    JWT_SECRET            = "Signs and verifies every JWT, including admin tokens"
    STRIPE_SECRET_KEY     = "Stripe API key used by checkoutController"
    STRIPE_WEBHOOK_SECRET = "Verifies the signature on every Stripe webhook delivery"
  }
}

module "budget" {
  source = "../../modules/budget"

  environment        = var.environment
  limit_usd          = var.budget_limit_usd
  notification_email = var.budget_notification_email
}

module "network" {
  source = "../../modules/network"

  environment = var.environment
  aws_region  = var.aws_region
}

module "rds" {
  source = "../../modules/rds"

  environment            = var.environment
  subnet_ids             = module.network.private_subnet_ids
  vpc_security_group_ids = [module.network.rds_security_group_id]

  # Dev inverts every one of these against prod's eventual values (6.6 notes).
  deletion_protection = false
  skip_final_snapshot = true
  apply_immediately   = true

  # Found in 6.7: this account rejected the module's default of 7 with
  # `FreeTierRestrictionError: ... exceeds the maximum available to free
  # tier customers`. Still > 0, so PITR (6.11) stays possible; revisit if
  # the account's plan changes.
  backup_retention_period = 1
}

module "observability" {
  source = "../../modules/observability"

  environment = var.environment
}

module "lambda" {
  source = "../../modules/lambda"

  environment              = var.environment
  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id

  db_host       = module.rds.address
  db_port       = module.rds.port
  db_name       = module.rds.db_name
  db_secret_arn = module.rds.master_user_secret_arn

  # Dev's own frontend for the 6.9 CORS check, not the module's default
  # (dejavustudio.xyz), which is the real production domain. dejavu-ten was
  # a stale project (404s) - dejavu-seven is this account's stable
  # production alias (`vercel --prod`), so it survives future redeploys.
  cors_origins = [
    "https://dejavu-seven.vercel.app",
    "http://localhost:5173",
  ]
  frontend_url = "https://dejavu-seven.vercel.app"

  # Defaults to "bootstrap" - 6.7 step 2 pushes both images tagged
  # :bootstrap by hand before the first apply, and every apply after that
  # ignores this argument (D5), so CI's automated apply never needs it.
  initial_image_tag = var.initial_image_tag

  # Log groups must exist before the functions that write to them.
  depends_on = [module.observability]
}
