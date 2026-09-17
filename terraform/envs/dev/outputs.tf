output "parameter_names" {
  description = "Parameter paths whose values must be set out of band."
  value       = module.secrets.parameter_names
}

output "parameter_prefix" {
  value = module.secrets.parameter_prefix
}

output "budget_name" {
  value = module.budget.budget_name
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "nat_public_ip" {
  value = module.network.nat_public_ip
}

output "rds_address" {
  value = module.rds.address
}

output "rds_master_user_secret_arn" {
  description = "Verify its aws:rds:primaryDBInstanceArn tag in 6.7 step 5."
  value       = module.rds.master_user_secret_arn
}

output "api_function_url" {
  value = module.lambda.function_url
}

output "migrator_function_name" {
  value = module.lambda.migrator_name
}

# 7.2: for verifying the alias by hand (`aws lambda get-alias`) without
# guessing the name the pipeline scripts hardcode ("live", per the shared
# interfaces list).
output "api_alias_name" {
  value = module.lambda.api_alias_name
}

output "api_alias_arn" {
  value = module.lambda.api_alias_arn
}
