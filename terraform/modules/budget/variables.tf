variable "environment" {
  type = string
}

variable "limit_usd" {
  description = "Monthly ceiling in dollars. Phases 0-5 should never approach this."
  type        = string
  default     = "5"
}

variable "notification_email" {
  description = "Where the alert goes. Never committed - passed in from CI or a local tfvars."
  type        = string
  sensitive   = true
}

variable "cost_filter_enabled" {
  description = <<-DESC
    Scope this budget to resources tagged Environment=<environment>, using
    the cost-allocation tag activated in bootstrap. False makes this an
    account-wide backstop - it also catches charges that don't carry the tag
    (parts of data transfer, public IPv4).
  DESC
  type        = bool
  default     = true
}
