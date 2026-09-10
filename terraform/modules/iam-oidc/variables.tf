variable "environment" {
  description = "dev or prod. Names the roles and scopes every ARN."
  type        = string
}

variable "github_repository" {
  description = "owner/repo permitted to assume these roles."
  type        = string
}

variable "github_environment" {
  description = "GitHub environment name the apply role sub claim requires (dev, production)."
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of the account GitHub OIDC provider."
  type        = string
}

variable "state_bucket_arn" {
  description = "ARN of the Terraform state bucket."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}
