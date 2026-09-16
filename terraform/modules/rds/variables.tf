variable "environment" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnet ids, at least two AZs (a DB subnet group requires it even for a single-AZ instance)."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  type = list(string)
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "GB, gp3."
  type        = number
  default     = 20
}

variable "master_username" {
  type    = string
  default = "dejavu_admin"
}

variable "db_name" {
  type    = string
  default = "dejavu"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_period" {
  description = "Days. Must be > 0 for PITR."
  type        = number
  default     = 7
}

# Dev and prod invert every one of these three.
variable "deletion_protection" {
  type = bool
}

variable "skip_final_snapshot" {
  type = bool
}

variable "apply_immediately" {
  type = bool
}
