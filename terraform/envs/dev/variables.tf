variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type = string
}

variable "budget_limit_usd" {
  type    = string
  default = "5"
}

variable "budget_notification_email" {
  description = <<-DESC
    Where budget alerts go.

    No default and never committed: this repository is public, and an email
    address in a public repo is a spam magnet. Supply it as TF_VAR_budget_
    notification_email, which CI reads from the BUDGET_ALERT_EMAIL secret.
  DESC
  type        = string
  sensitive   = true
}
