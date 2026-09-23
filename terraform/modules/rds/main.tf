/**
 * One Postgres 16 instance, private, TLS-enforced, with an
 * RDS-managed master credential.
 */

locals {
  name = "dejavu-${var.environment}"
}

resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = var.subnet_ids

  tags = { Name = local.name }
}

# rds.force_ssl defaults to 1 from PG 15 on. Set explicitly anyway, so it's
# visible in code rather than an assumption about the engine default.
resource "aws_db_parameter_group" "this" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "this" {
  identifier = local.name

  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.master_username

  # RDS creates and rotates the Secrets Manager secret; the password never
  # enters Terraform state, unlike `password = ...` (correction 3, D8).
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.vpc_security_group_ids
  parameter_group_name   = aws_db_parameter_group.this.name

  multi_az            = var.multi_az
  publicly_accessible = false

  backup_retention_period = var.backup_retention_period
  backup_window           = "07:00-07:30"
  maintenance_window      = "sun:08:00-sun:08:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true

  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.skip_final_snapshot
  apply_immediately   = var.apply_immediately

  # Required whenever skip_final_snapshot = false, or the destroy errors out.
  # A fixed name would collide on the second teardown (DBSnapshotAlreadyExists)
  # if the previous snapshot were still there, so it carries the instance's
  # creation time: one create, one destroy, one unique name. ignore_changes
  # stops timestamp() from producing a diff on every plan. The snapshot this
  # leaves behind is a manual snapshot: Terraform won't delete it and it bills
  # until someone does (issue #26, terraform/README.md "Destroy").
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  # The default, stated: automated backups go with the instance. Only the
  # final snapshot above survives a destroy.
  delete_automated_backups = true

  tags = { Name = local.name }

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}
