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

variable "enable_workload_infrastructure" {
  description = <<-DESC
    Widens this apply role for Phase 6: VPC/EC2, RDS, Lambda, ECR reads, its
    own log groups, the public AMI SSM parameter, and PassRole on exactly the
    named workload role. False keeps the role at its Phase 5 shape (SSM
    parameters and budgets only) - which is where prod's apply role stays
    until Phase 7 (D6: only dev is applied in Phase 6).
  DESC
  type        = bool
  default     = false
}

variable "workload_role_arn" {
  description = "ARN of this environment's Lambda execution role. Required when enable_workload_infrastructure is true."
  type        = string
  default     = null
}

variable "ecr_repository_arns" {
  description = "ECR repository ARNs the apply role may read images from. Only meaningful when enable_workload_infrastructure is true."
  type        = list(string)
  default     = []
}
