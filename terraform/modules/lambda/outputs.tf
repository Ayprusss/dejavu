output "function_url" {
  value = aws_lambda_function_url.api.function_url
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "migrator_name" {
  value = aws_lambda_function.migrator.function_name
}
