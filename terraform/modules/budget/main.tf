/**
 * A cost ceiling that tells a human before the bill does.
 *
 * Two notifications rather than one, because they answer different questions:
 * ACTUAL at 80% says money has already been spent, FORECASTED at 100% says the
 * current run rate will breach the limit before the month ends. The forecast is
 * the one that catches a NAT gateway left running on a Friday.
 *
 * Budgets deliver to an email address directly, so this needs no SNS topic and
 * no subscription to confirm. Phase 7 adds SNS for operational alarms, which is
 * a different signal with a different audience.
 */

resource "aws_budgets_budget" "monthly" {
  name         = "dejavu-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = var.limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.notification_email]
  }
}
