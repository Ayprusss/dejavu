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
