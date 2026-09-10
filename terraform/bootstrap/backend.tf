# Deliberately empty to begin with.
#
# This config creates the bucket named below, so on the first apply there is
# nowhere remote to put its state. Run it once with local state, then uncomment
# this block, fill in the bucket name from `terraform output state_bucket`, and
# run `terraform init -migrate-state`.
#
# terraform {
#   backend "s3" {
#     bucket       = "dejavu-tfstate-<account-id>"
#     key          = "dejavu/bootstrap/terraform.tfstate"
#     region       = "us-east-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
