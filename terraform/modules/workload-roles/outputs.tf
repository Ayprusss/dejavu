output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "ecr_repository_arns" {
  value = { for k, r in aws_ecr_repository.this : k => r.arn }
}

output "push_role_arn" {
  value = aws_iam_role.push.arn
}

output "workload_role_arns" {
  description = "Keyed by environment name (dev, prod)."
  value       = { for k, r in aws_iam_role.workload : k => r.arn }
}

output "workload_role_names" {
  description = "Keyed by environment name (dev, prod)."
  value       = { for k, r in aws_iam_role.workload : k => r.name }
}
