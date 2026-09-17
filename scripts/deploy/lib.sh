# Shared helpers for scripts/deploy/*.sh. Sourced, never executed directly -
# every caller already has `set -euo pipefail` from its own shebang, so this
# file doesn't repeat it (shellcheck shell=bash below is only so shellcheck
# lints it standalone as part of `scripts/deploy/*.sh` in 7.4's lint step).
# shellcheck shell=bash

log() { echo "==> $*"; }
fail() {
  echo "::error::$*" >&2
  exit 1
}

require_env() {
  # Indirect expansion (${!name}) - bash only, which is fine: the shebang on
  # every caller is #!/usr/bin/env bash, not /bin/sh.
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name must be set"
  fi
}

# aws lambda/ecr calls in this directory always pass --region and
# --output json explicitly, rather than relying on the caller's configured
# CLI defaults (profile, output format) - a human running these scripts by
# hand (the README's manual-rollback path) may have either set differently.

# ECR's describe-images/repository-name parameter wants the bare repository
# name ("dejavu-api"), not the full pull-through URL ECR_API_REPO/
# ECR_MIGRATOR_REPO carry ("<acct>.dkr.ecr.<region>.amazonaws.com/dejavu-api").
ecr_repo_name() {
  echo "${1##*/}"
}

# Splits "<registry>/<repo>@sha256:<hex>" (Code.ResolvedImageUri, per
# GetFunction's response shape - docs.aws.amazon.com/lambda/latest/api/API_GetFunction.html)
# into the bit ECR's DescribeImages imageDigest filter wants.
image_digest_from_resolved_uri() {
  echo "${1##*@}"
}

# Splits "<registry>/<repo>:<tag>" (Code.ImageUri) into just the tag - the git
# SHA, since every push tags the image that way (ci.yml's push-image job).
image_tag_from_image_uri() {
  echo "${1##*:}"
}
