#!/usr/bin/env bash
#
# promote-check.sh <sha>
#
# D4: "promote by SHA, verify by digest." Resolves dejavu-api:<sha> and
# dejavu-migrator:<sha> to their ECR image digests and fails unless dev's
# `live` alias (api) and $LATEST (migrator, which has no alias - 7.2) are
# running those exact digests. Prod must never run anything dev didn't.
#
# deploy.yml is expected to skip this call entirely for 7.10's drill
# (`drill: true`), rather than have this script grow a bypass flag of its
# own - the check itself must stay honest.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

SHA="${1:?usage: promote-check.sh <sha>}"

require_env AWS_REGION
require_env ECR_API_REPO
require_env ECR_MIGRATOR_REPO

API_REPO_NAME="$(ecr_repo_name "$ECR_API_REPO")"
MIGRATOR_REPO_NAME="$(ecr_repo_name "$ECR_MIGRATOR_REPO")"

# DescribeImages accepts either imageTag or imageDigest in imageIds
# (docs.aws.amazon.com/AmazonECR/latest/APIReference/API_DescribeImages.html);
# tagging by SHA (ci.yml's push-image job) plus immutable tags on these repos
# (6.5) means the tag->digest lookup is unambiguous.
resolve_tag_digest() {
  local repo="$1" tag="$2"
  aws ecr describe-images \
    --region "$AWS_REGION" \
    --repository-name "$repo" \
    --image-ids "imageTag=${tag}" \
    --output json | jq -r '.imageDetails[0].imageDigest'
}

log "Resolving ${SHA} in ECR"
SHA_API_DIGEST="$(resolve_tag_digest "$API_REPO_NAME" "$SHA")"
SHA_MIGRATOR_DIGEST="$(resolve_tag_digest "$MIGRATOR_REPO_NAME" "$SHA")"

log "Reading what dev is actually running"
DEV_API_RESOLVED="$(aws lambda get-function \
  --region "$AWS_REGION" \
  --function-name dejavu-dev-api \
  --qualifier live \
  --output json | jq -r '.Code.ResolvedImageUri')"
DEV_API_DIGEST="$(image_digest_from_resolved_uri "$DEV_API_RESOLVED")"

# The migrator has no alias (7.2: it's invoked at $LATEST straight after its
# own update-function-code, and never takes public traffic), so "what dev
# ran" for it means $LATEST rather than a qualifier.
DEV_MIGRATOR_RESOLVED="$(aws lambda get-function \
  --region "$AWS_REGION" \
  --function-name dejavu-dev-migrator \
  --output json | jq -r '.Code.ResolvedImageUri')"
DEV_MIGRATOR_DIGEST="$(image_digest_from_resolved_uri "$DEV_MIGRATOR_RESOLVED")"

FAILED=false

if [ "$SHA_API_DIGEST" != "$DEV_API_DIGEST" ]; then
  echo "::error::api ${SHA} (${SHA_API_DIGEST}) != dev live (${DEV_API_DIGEST})" >&2
  FAILED=true
fi

if [ "$SHA_MIGRATOR_DIGEST" != "$DEV_MIGRATOR_DIGEST" ]; then
  echo "::error::migrator ${SHA} (${SHA_MIGRATOR_DIGEST}) != dev \$LATEST (${DEV_MIGRATOR_DIGEST})" >&2
  FAILED=true
fi

if [ "$FAILED" = true ]; then
  fail "promote-check: prod would run code dev never ran (D4) - refusing to promote ${SHA}."
fi

log "promote-check OK: ${SHA} matches dev's digests for both api and migrator"
