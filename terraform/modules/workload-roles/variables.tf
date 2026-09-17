variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "github_repository" {
  description = "owner/repo allowed to push images to ECR from main."
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of the account's GitHub OIDC provider (from bootstrap/main.tf)."
  type        = string
}

variable "ecr_repository_names" {
  description = <<-DESC
    Repository names, shared across every environment. One image is promoted
    dev -> prod by SHA in Phase 7, so these can't belong to either
    environment's Terraform state.
  DESC
  type        = list(string)
  default     = ["dejavu-api", "dejavu-migrator"]
}

variable "ecr_keep_tagged_count" {
  description = "How many tagged images to retain per repository."
  type        = number
  default     = 15
}

variable "workload_environments" {
  description = <<-DESC
    One entry per environment that gets a Lambda execution role. The map key
    is the environment name (dev, prod). rds_identifier is that environment's
    RDS instance identifier, used to scope the role's Secrets Manager grant to
    exactly that database's RDS-managed secret.
  DESC
  type = map(object({
    rds_identifier = string
  }))
  default = {}
}

variable "deploy_environments" {
  description = <<-DESC
    One entry per environment that gets a dedicated deploy role (7.3, D8),
    assumed by deploy.yml's jobs - separate from the Terraform apply role in
    modules/iam-oidc, because deploys happen on every merge and applies
    happen rarely. The map key is the environment name (dev, prod);
    github_environment is the GitHub Environment name that must appear in the
    OIDC token's `sub` claim (dev, production - matching the AWS environment
    name only for dev).
  DESC
  type = map(object({
    github_environment = string
  }))
  default = {}
}
