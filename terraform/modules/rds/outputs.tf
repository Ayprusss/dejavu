output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "identifier" {
  value = aws_db_instance.this.identifier
}

output "master_user_secret_arn" {
  description = "Verify this secret's aws:rds:primaryDBInstanceArn tag matches modules/workload-roles's condition (6.7 step 5)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
