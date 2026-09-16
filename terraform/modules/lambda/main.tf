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
      FRONTEND_URL                 = var.frontend_url
      TRUST_PROXY                  = tostring(var.trust_proxy)
    })
  }

  tags = { Name = "${local.name_prefix}-api" }

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_function_url" "api" {
  function_name = aws_lambda_function.api.function_name

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
  principal              = "*"
  function_url_auth_type = "NONE"
}

# ---------------------------------------------------------------------------
# Migrator function - no Function URL, invoked directly (`aws lambda invoke`)
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
