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
