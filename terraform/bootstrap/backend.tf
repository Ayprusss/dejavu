/**
 * Partial backend configuration.
 *
 * This config creates the state bucket, so on the very first apply there is
 * nowhere remote to put its state: it runs once with local state, and is then
 * migrated into the bucket it created.
 *
 * The bucket name embeds the AWS account id, and this repository is public, so
 * it is supplied at init time rather than committed:
 *
 *   terraform init -backend-config="bucket=dejavu-tfstate-<account-id>"
 *
 * Add -migrate-state on the first run after the initial local apply.
 */
terraform {
  backend "s3" {
    key          = "dejavu/bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
