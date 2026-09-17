output "function_url" {
  # 7.2: qualified now that aws_lambda_function_url.api carries
  # `qualifier = aws_lambda_alias.api_live.name` - this is a *different* URL
  # (and URL ID) than the unqualified one dev had in Phase 6, not the same
  # URL with an added parameter (correction 1).
  value = aws_lambda_function_url.api.function_url
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "migrator_name" {
  value = aws_lambda_function.migrator.function_name
}

output "api_alias_name" {
  value = aws_lambda_alias.api_live.name
}

output "api_alias_arn" {
  value = aws_lambda_alias.api_live.arn
}
