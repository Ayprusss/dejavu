output "parameter_names" {
  description = "Full parameter paths, for the runtime IAM policy in Phase 6."
  value       = [for p in aws_ssm_parameter.app : p.name]
}

output "parameter_arns" {
  value = [for p in aws_ssm_parameter.app : p.arn]
}

output "parameter_prefix" {
  value = local.prefix
}
