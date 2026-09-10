/**
 * Application secrets, in SSM Parameter Store.
 *
 * Phase 5 puts all four in Parameter Store Standard SecureString, which is
 * free. The plan originally split them - Secrets Manager for database
 * credentials, Parameter Store for the rest - and that split is still the
 * intent, but its entire justification is Secrets Manager native RDS
 * integration and managed rotation, and neither exists until there is an RDS
 * instance in Phase 6. Paying $0.40/month now to hold a credential for a
 * database that does not exist buys a line item and nothing else.
 *
 * Phase 6 moves exactly one secret - the RDS master credential - into Secrets
 * Manager, because it is the only one with a rotation story that gets used.
 *
 * ## Values are not managed here
 *
 * Every parameter is created with a placeholder and `ignore_changes = [value]`.
 * The real value is written out of band (see terraform/README.md), so a secret
 * never appears in a .tf file, a tfvars file, a CI log, or a pull request.
 *
 * The honest caveat: `terraform refresh` reads SecureString values back, so
 * after the first refresh the real values *are* in the state file. That is why
 * the state bucket is encrypted, versioned, TLS-only and blocked from public
 * access, and why only the two CI roles can read it. The clean fix is the
 * provider write-only `value_wo` argument, which never persists to state; it is
 * the upgrade path here once we are pinned to a provider version that has it.
 */

locals {
  prefix = "/dejavu/${var.environment}"

  placeholder = "REPLACE_ME - set with aws ssm put-parameter --overwrite"
}

resource "aws_ssm_parameter" "app" {
  for_each = var.parameters

  name        = "${local.prefix}/${each.key}"
  description = each.value
  type        = "SecureString"
  tier        = "Standard"

  # Never the real value. See the note above.
  value = local.placeholder

  tags = merge(var.tags, {
    Environment = var.environment
  })

  lifecycle {
    # Terraform declares which parameters must exist and who may read them.
    # It does not own what is in them.
    ignore_changes = [value]
  }
}
