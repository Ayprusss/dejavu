/**
 * The two Lambda functions and the API's Function URL.
 *
 * Terraform creates the function; it does not deploy code (D5) - both
 * functions' image_uri is ignore_changes'd, and real deploys go through
 * `aws lambda update-function-code --image-uri ...:<sha>`.
 *
 * The execution role and the ECR repositories are account-level resources
 * from bootstrap (modules/workload-roles), looked up by their predictable
 * name rather than plumbed through as extra variables.
 */

locals {
  name_prefix = "dejavu-${var.environment}"

  common_environment = {
    NODE_ENV    = "production"
    DEPLOY_ENV  = var.environment
    PG_POOL_MAX = "1"

    SSM_PARAMETER_PATH = "/dejavu/${var.environment}"
    DB_HOST            = var.db_host
    DB_PORT            = tostring(var.db_port)
    DB_NAME            = var.db_name
    DB_SECRET_ARN      = var.db_secret_arn

    # Both functions need it: the api builds Stripe redirect URLs from it, and
    # the migrator's `seed` action builds product image URLs from it
    # (src/seed.js). Found in 6.12: set on the api only, the migrator fell back
    # to env.js's `https://dejavustudio.xyz` default and seeded image URLs that
    # 404 - which 6.9 had misread as a hardcoded domain in the frontend.
    FRONTEND_URL = var.frontend_url

    # No DB_SSL_CA_PATH: connectionOptions.js's own fallback
    # (`${__dirname}/../../certs/rds-global-bundle.pem`) resolves correctly
    # for both images without it, and a single hardcoded path here can't -
    # api's WORKDIR is /app, but the migrator's AWS base image uses
    # /var/task (LAMBDA_TASK_ROOT). Found via a real ENOENT invoking the
    # migrator: it was opening /app/certs/... on an image that only has
    # /var/task/certs/....
  }
}

data "aws_iam_role" "workload" {
  name = "${local.name_prefix}-lambda"
}

data "aws_ecr_repository" "api" {
  name = "dejavu-api"
}

data "aws_ecr_repository" "migrator" {
  name = "dejavu-migrator"
}

# ---------------------------------------------------------------------------
# API function
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  role          = data.aws_iam_role.workload.arn

  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.api.repository_url}:${var.initial_image_tag}"
  architectures = ["arm64"]

  memory_size = var.memory_size
  timeout     = var.timeout

  reserved_concurrent_executions = var.reserved_concurrency

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.common_environment, {
      PORT                         = "5000"
      AWS_LWA_PORT                 = "5000"
      AWS_LWA_READINESS_CHECK_PATH = "/api/status"
      AWS_LWA_INVOKE_MODE          = "buffered"
      CORS_ORIGINS                 = join(",", var.cors_origins)
      TRUST_PROXY                  = tostring(var.trust_proxy)
    })
  }

  tags = { Name = "${local.name_prefix}-api" }

  lifecycle {
    ignore_changes = [image_uri]
  }
}

# The pipeline (7.4) is what actually moves traffic: publish-version then
# update-alias. Terraform only has to create the alias once and then leave it
# alone (ignore_changes) - if Terraform "corrected" function_version back to
# whatever this config says on every apply, it would undo every deploy.
#
# Verified (not assumed, per 7.2's task): CreateAlias's function_version
# accepts the literal string "$LATEST" for a plain (non-weighted) alias - the
# provider's schema validates it against `(\$LATEST|[0-9]+)`, and AWS's own
# alias docs describe (while discouraging long-term use of) an alias pointed
# at $LATEST. So the function does NOT need `publish = true` just to give this
# alias something to reference on the first apply.
#
# That matters because `publish = true` on aws_lambda_function republishes a
# version on *any* change the provider applies, not only a code change - the
# argument's own description is "publish creation/change", and env-var/memory
# edits go through UpdateFunctionConfiguration same as code does. With
# image_uri already ignore_changes'd, the only edits Terraform still applies
# here are config ones (CORS_ORIGINS, FRONTEND_URL, etc.), and correction 2
# already covers keeping those live via a pipeline republish right after
# apply (7.5). Adding `publish = true` on top would make Terraform itself
# also publish an extra, never-smoke-tested version on that same apply -
# exactly the "bypass the pipeline" case this step warns about - for no
# benefit, since $LATEST already works. So: no `publish = true` here.
resource "aws_lambda_alias" "api_live" {
  name        = "live"
  description = "Traffic pointer for the api function; moved only by scripts/deploy/deploy.sh (7.4), never by Terraform."

  function_name    = aws_lambda_function.api.function_name
  function_version = "$LATEST"

  lifecycle {
    ignore_changes = [function_version]
  }
}

resource "aws_lambda_function_url" "api" {
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.api_live.name

  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"

  # No cors block: Express already answers CORS (CORS_ORIGINS above), and
  # setting both here and in the app produces duplicate
  # Access-Control-Allow-Origin headers, which browsers reject.
}

resource "aws_lambda_permission" "public_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  qualifier              = aws_lambda_alias.api_live.name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# 7.2 correction 1 / plan step 7.2: as of the AWS change that took effect
# October 2025 (all function URLs must comply by November 2026), a NONE-auth
# function URL needs a *second* resource-policy statement granting
# lambda:InvokeFunction, gated by the InvokedViaFunctionUrl condition key -
# lambda:InvokeFunctionUrl alone no longer authorizes the actual invoke.
# Confirmed against the AWS Lambda "Control access to function URLs" doc
# (docs.aws.amazon.com/lambda/latest/dg/urls-auth.html) and the CLI's own
# two-command example, which issues these as separate add-permission calls
# rather than one. Without this, a correctly created URL still 403s - not
# something 6.x's alias-less URL ever needed. `invoked_via_function_url`
# landed in hashicorp/aws 6.28.0; the lockfile here already resolves newer.
resource "aws_lambda_permission" "public_invoke_function" {
  statement_id             = "AllowPublicInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  qualifier                = aws_lambda_alias.api_live.name
  principal                = "*"
  invoked_via_function_url = true
}

# ---------------------------------------------------------------------------
# Migrator function - no Function URL, invoked directly (`aws lambda invoke`)
#
# 7.2: no alias here, on purpose. It never takes public traffic - the
# pipeline (7.4) invokes it at $LATEST right after its own
# update-function-code, before the api's alias moves - so there is nothing
# to roll back to and nothing an alias would protect.
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "migrator" {
  function_name = "${local.name_prefix}-migrator"
  role          = data.aws_iam_role.workload.arn

  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.migrator.repository_url}:${var.initial_image_tag}"
  architectures = ["arm64"]

  memory_size = var.memory_size
  timeout     = var.migrator_timeout

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.common_environment
  }

  tags = { Name = "${local.name_prefix}-migrator" }

  lifecycle {
    ignore_changes = [image_uri]
  }
}
