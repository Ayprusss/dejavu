variable "aws_region" {
  description = "Region for the state bucket. Everything else follows it."
  type        = string
  default     = "us-east-1"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the CI roles. Scoping is the only thing between a fork and this account."
  type        = string
  default     = "Ayprusss/dejavu"

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "Must be in owner/repo form, e.g. Ayprusss/dejavu."
  }
}

variable "state_bucket_name" {
  description = "Override the state bucket name. Defaults to dejavu-tfstate-<account-id>."
  type        = string
  default     = null
}
