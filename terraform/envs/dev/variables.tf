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

variable "initial_image_tag" {
  description = <<-DESC
    Git SHA of the images pushed to ECR before the first apply (6.7 step 2).
    Gives the Lambda functions a valid image_uri on creation only - every
    apply after that ignores the argument (D5). No default: the first apply
    must supply a real, already-pushed tag or the create fails.
  DESC
  type        = string
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
