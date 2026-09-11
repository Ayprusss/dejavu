/**
 * Partial backend configuration.
 *
 * The bucket name embeds the AWS account id, and this repository is public, so
 * it is supplied at init time rather than committed:
 *
 *   terraform init -backend-config=backend.hcl
 *
 * backend.hcl is gitignored; copy backend.hcl.example and fill it in. CI passes
 * the same two values from repository variables.
 */
terraform {
  backend "s3" {
    key     = "dejavu/dev/terraform.tfstate"
    encrypt = true

    # Terraform 1.11 locks through an S3 object next to the state file. The
    # DynamoDB table the plan originally called for is deprecated and gone.
    use_lockfile = true
  }
}
