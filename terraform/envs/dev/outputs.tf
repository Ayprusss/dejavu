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
