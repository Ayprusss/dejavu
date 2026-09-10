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
