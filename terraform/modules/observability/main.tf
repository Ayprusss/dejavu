/**
 * Log groups, plus (7.7) the alarms and SNS topic that watch them and the
 * functions that write to them.
 *
 * Log groups are created ahead of the functions that write to them
 * (envs/<env>/main.tf orders this module's apply before modules/lambda's) -
 * Lambda auto-creates a log group with never-expire retention the first time
 * a function writes to it, and Terraform then fails on "already exists" if
 * it tries to create one of its own afterward. The alarms below don't need
 * that ordering: a metric filter or alarm can exist before the function does
 * and simply reports no data (treat_missing_data = "notBreaching" everywhere,
 * per 7.7) until traffic arrives.
 *
 * This module does not depend on modules/lambda's resources. Function and
 * alias names are derived from `environment` the same way modules/lambda
 * derives them (`dejavu-<env>-api` / `dejavu-<env>-migrator`), so the two
 * modules stay decoupled and can apply in either order once the log groups
 * exist. The cost of that decoupling: if 7.2's alias name or 7.3's function
 * names ever change, this module goes stale silently, the same risk
 * CLAUDE.md calls out for renaming an `event` key.
 */

locals {
  name_prefix = "dejavu-${var.environment}"

  # 7.2 creates this alias and moves the api's Function URL onto it
  # (`aws_lambda_alias.api_live`, name = "live"). Hardcoded here rather than
  # threaded through as a variable, matching this module's decision not to
  # take modules/lambda as a dependency.
  live_alias   = "live"
  api_resource = "${local.name_prefix}-api:${local.live_alias}"

  # aws_cloudwatch_metric_alarm requires zero-or-one instance per resource
  # address, so "disable alarms" is a count, not an if/else on each resource.
  alarm_count = var.enable_alarms ? 1 : 0

  # Custom metric namespace for the two log-derived metrics (D10 / 7.7).
  metric_namespace = "Dejavu/${var.environment}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = var.retention_in_days
}

resource "aws_cloudwatch_log_group" "migrator" {
  name              = "/aws/lambda/${local.name_prefix}-migrator"
  retention_in_days = var.retention_in_days
}

# ---------------------------------------------------------------------------
# SNS - one topic per environment, one email subscription (D10).
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  count = local.alarm_count
  name  = "${local.name_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count     = local.alarm_count
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email

  # The subscription stays PendingConfirmation until the address confirms by
  # clicking the email link (7.7) - Terraform can create the subscription but
  # can't complete it, so an apply alone doesn't prove the alarm path works.
}

# ---------------------------------------------------------------------------
# Alarm 1 - 5xx on the live alias's Function URL.
#
# Dimensions confirmed against AWS's Function URL monitoring docs (7.7 asks
# to verify, not assume): `Resource` is "<function-name>:<alias>" for a
# qualified URL (AWS's own example is "hello-world-function:$LATEST"), which
# scopes this alarm to exactly what 7.2's alias serves - not $LATEST, and not
# whatever the old unqualified URL served before 7.2 removed it. Still to be
# confirmed live with `aws cloudwatch list-metrics` once the alias is taking
# real traffic, per 7.7's checklist.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-api-5xx"
  alarm_description   = "5xx responses from the live alias's Function URL (7.7 alarm 1)."
  namespace           = "AWS/Lambda"
  metric_name         = "Url5xxCount"
  dimensions          = { Resource = local.api_resource }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]
}

# ---------------------------------------------------------------------------
# Alarm 2 - Lambda Errors, on the api (alias-qualified, same reasoning as
# alarm 1) and on the migrator (no alias - 7.2 says the migrator is invoked
# directly at $LATEST and never takes public traffic, so FunctionName is the
# only dimension that means anything for it).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-api-errors"
  alarm_description   = "Lambda-reported Errors on the api's live alias (7.7 alarm 2)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { Resource = local.api_resource }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "migrator_errors" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-migrator-errors"
  alarm_description   = "Lambda-reported Errors on the migrator - should email someone even though the pipeline also goes red (7.7 alarm 2)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = "${local.name_prefix}-migrator" }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]
}

# ---------------------------------------------------------------------------
# Alarm 3 - Throttles on the api. Correction 10 (phase-7-steps.md) says this
# is the alarm most likely to fire for a reason unrelated to the code: dev
# and prod share one account-wide concurrency ceiling.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_throttles" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-api-throttles"
  alarm_description   = "Lambda-reported Throttles on the api's live alias (7.7 alarm 3)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { Resource = local.api_resource }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]
}

# ---------------------------------------------------------------------------
# Alarm 4 - log-derived: checkout.oversell (money, alone) and the
# failed-checkout rate (webhook.failed + checkout.failed, summed).
#
# Metric filter patterns match src/lib/logger.js's `event` key exactly
# (backend/src/controllers/checkoutController.js and webhookController.js) -
# `default_value = 0` (7.7) so the metric always reports a real zero instead
# of "no data", which is what lets `treat_missing_data` mean something and
# what makes a metric-math sum below well-defined instead of "missing + N".
#
# Whether a container-image Lambda's stdout reaches CloudWatch as the raw
# JSON pino writes, or with a platform-added prefix, matters here: a prefixed
# line would never match `{ $.event = "..." }`. Researched for 7.7 (not just
# assumed): the JSON-wrapping in AWS's "advanced logging controls"
# (LogFormat=JSON) is implemented by patching each *managed runtime's*
# built-in logging calls (Node.js's own `console.*`, inside the Node.js
# managed runtime) - see AWS's "Configuring JSON and plain text log formats"
# docs, "the following built-in logging tools", Node.js listed as
# `console.*` methods. The api image is not that: it's a container image
# running a plain Express/node process under the Lambda Web Adapter
# extension, invoked through a custom runtime bootstrap, not Node.js's
# managed runtime - so that console-patching code path never runs, and there
# is no managed-runtime JSON wrapper to bypass or fight. Lambda's default log
# format is plain text either way (see "Default log formats" in the same
# doc), which for a non-managed runtime just means: whatever bytes the
# process writes to stdout become the CloudWatch log event, one line per
# event, unprefixed. pino writes exactly one compact JSON object per line
# (no `pino-pretty`, per logger.js's own comment), so each log event should
# be exactly that JSON object and `{ $.event = "..." }` should match.
# **Flagged per 7.7's checklist, not just assumed:** confirm this against a
# real log line with `aws logs test-metric-filter` before trusting either
# filter, and re-check after any change to the logging/adapter setup.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "checkout_oversell" {
  name           = "${local.name_prefix}-checkout-oversell"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.event = \"checkout.oversell\" }"

  metric_transformation {
    name          = "CheckoutOversell"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_log_metric_filter" "webhook_failed" {
  name           = "${local.name_prefix}-webhook-failed"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.event = \"webhook.failed\" }"

  metric_transformation {
    name          = "WebhookFailed"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_log_metric_filter" "checkout_failed" {
  name           = "${local.name_prefix}-checkout-failed"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.event = \"checkout.failed\" }"

  metric_transformation {
    name          = "CheckoutFailed"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "checkout_oversell" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-checkout-oversell"
  alarm_description   = "A customer was charged and nothing was recorded (Phase 3) - this is a refund for a human, the one alarm here about money rather than uptime (7.7 alarm 4)."
  namespace           = local.metric_namespace
  metric_name         = "CheckoutOversell"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]

  depends_on = [aws_cloudwatch_log_metric_filter.checkout_oversell]
}

# One alarm on the sum of webhook.failed + checkout.failed (the roadmap's
# "failed-checkout rate") rather than two, because a customer-visible failed
# checkout is one incident whichever side logged it, and one alarm means one
# ALARM/OK pair to read during the 7.10 drill instead of two that might
# disagree.
resource "aws_cloudwatch_metric_alarm" "failed_checkout" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-failed-checkout"
  alarm_description   = "webhook.failed + checkout.failed, summed - the roadmap's failed-checkout rate (7.7 alarm 4)."
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "webhook_failed"
    return_data = false
    metric {
      namespace   = local.metric_namespace
      metric_name = "WebhookFailed"
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id          = "checkout_failed"
    return_data = false
    metric {
      namespace   = local.metric_namespace
      metric_name = "CheckoutFailed"
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id          = "total"
    expression  = "webhook_failed + checkout_failed"
    label       = "Failed checkouts (webhook + checkout)"
    return_data = true
  }

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]

  depends_on = [
    aws_cloudwatch_log_metric_filter.webhook_failed,
    aws_cloudwatch_log_metric_filter.checkout_failed,
  ]
}
