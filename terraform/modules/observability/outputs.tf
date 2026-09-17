output "api_log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}

output "migrator_log_group_name" {
  value = aws_cloudwatch_log_group.migrator.name
}

output "sns_topic_arn" {
  description = "ARN of the alarms SNS topic, or null when enable_alarms is false. For whichever step wires IAM policies that reference it - this module's scope is Terraform resources, not the apply role's permissions."
  value       = var.enable_alarms ? aws_sns_topic.alarms[0].arn : null
}
