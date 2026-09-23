output "state_bucket" {
  description = "Put this in each env's backend.tf."
  value       = aws_s3_bucket.state.id
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "plan_role_arn_dev" {
  description = "Set as the AWS_PLAN_ROLE_ARN repo variable."
  value       = module.roles_dev.plan_role_arn
}

output "apply_role_arn_dev" {
  value = module.roles_dev.apply_role_arn
}

output "plan_role_arn_prod" {
  value = module.roles_prod.plan_role_arn
}

output "apply_role_arn_prod" {
  description = "Set as the AWS_APPLY_ROLE_ARN_PROD repo variable."
  value       = module.roles_prod.apply_role_arn
}

output "push_role_arn" {
  description = "Set as the AWS_PUSH_ROLE_ARN repo variable."
  value       = module.workload_roles.push_role_arn
}

output "ecr_api_repository_url" {
  description = "Set as the ECR_API_REPO repo variable."
  value       = module.workload_roles.ecr_repository_urls["dejavu-api"]
}

output "ecr_migrator_repository_url" {
  description = "Set as the ECR_MIGRATOR_REPO repo variable."
  value       = module.workload_roles.ecr_repository_urls["dejavu-migrator"]
}

output "workload_role_arn_dev" {
  description = "Lambda execution role for dev - consumed by envs/dev's modules/lambda."
  value       = module.workload_roles.workload_role_arns["dev"]
}

output "workload_role_arn_prod" {
  description = "Lambda execution role for prod - consumed by envs/prod's modules/lambda. Set as AWS_WORKLOAD_ROLE_ARN_PROD."
  value       = module.workload_roles.workload_role_arns["prod"]
}

output "deploy_role_arn_dev" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN_DEV repo variable. Assumed by deploy.yml's deploy-dev job."
  value       = module.workload_roles.deploy_role_arns["dev"]
}

output "deploy_role_arn_prod" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN_PROD repo variable. Assumed by deploy.yml's deploy-prod job."
  value       = module.workload_roles.deploy_role_arns["prod"]
}
