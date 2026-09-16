output "api_log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}

output "migrator_log_group_name" {
  value = aws_cloudwatch_log_group.migrator.name
}
