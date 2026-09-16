/**
 * Log groups only. Created ahead of the functions that write to them
 * (envs/dev/main.tf orders this module's apply before modules/lambda's) -
 * Lambda auto-creates a log group with never-expire retention the first time
 * a function writes to it, and Terraform then fails on "already exists" if
 * it tries to create one of its own afterward.
 *
 * Alarms and SNS are Phase 7.
 */

locals {
  name_prefix = "dejavu-${var.environment}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = var.retention_in_days
}

resource "aws_cloudwatch_log_group" "migrator" {
  name              = "/aws/lambda/${local.name_prefix}-migrator"
  retention_in_days = var.retention_in_days
}
