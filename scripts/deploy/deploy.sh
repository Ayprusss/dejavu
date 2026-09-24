#!/usr/bin/env bash
#
# deploy.sh <env> <sha>
#
# Shifts dejavu-<env>-api's `live` alias onto <sha>, smoke-tests the public
# URL (D3), and rolls back on its own if that fails (D2 - a ~60-line script
# instead of CodeDeploy, since at one user a canary shift has no traffic to
# learn from).
#
# Exit 0 - deployed and healthy.
# Exit 1 - smoke failed; rolled back to the previous version, and *that*
#          passed smoke. The job is red, but the alias is serving good code.
# Exit 2 - smoke failed AND the rollback's own smoke also failed. The alias
#          may be on either version at this point - this is a page, not a
#          release, and phase-7-steps.md 7.4 says so explicitly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

ENV="${1:?usage: deploy.sh <env> <sha>}"
SHA="${2:?usage: deploy.sh <env> <sha>}"

require_env AWS_REGION
require_env ECR_API_REPO

FUNCTION_NAME="dejavu-${ENV}-api"
IMAGE_URI="${ECR_API_REPO}:${SHA}"
REPO_NAME="$(ecr_repo_name "$ECR_API_REPO")"

# --- 1. Record the rollback target, and refuse to deploy without one -------
# (correction 8: ECR's lifecycle policy keeps only the last ~15 tagged
# images, so the version the alias currently points at may already have lost
# its image by the time we'd need to roll back to it).
log "Reading ${FUNCTION_NAME}'s live alias"
PREVIOUS_VERSION="$(aws lambda get-alias \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --name live \
  --output json | jq -r '.FunctionVersion')"

# Bootstrap/re-create case (7.2): Terraform's aws_lambda_alias creates `live`
# pointing at $LATEST (CreateAlias accepts it, and `ignore_changes =
# [function_version]` then leaves it there forever), so the very first
# pipeline deploy after any `terraform apply` that (re)creates the function
# sees this. $LATEST can never be a rollback target - it's about to become
# the code we're replacing - and if we ran update-function-code while the
# alias still pointed at $LATEST, the new image would take live traffic
# immediately, before publish/shift/smoke ever ran. Pin whatever $LATEST is
# running right now to a real version number first, exactly as if it had
# been a normal deploy's target all along.
if [ "$PREVIOUS_VERSION" = '$LATEST' ]; then
  log "live alias is on \$LATEST (bootstrap/re-create case, 7.2) - publishing it to a numbered version before deploying"
  PIN_RESULT="$(aws lambda publish-version \
    --region "$AWS_REGION" \
    --function-name "$FUNCTION_NAME" \
    --output json)"
  PREVIOUS_VERSION="$(echo "$PIN_RESULT" | jq -r '.Version')"

  aws lambda update-alias \
    --region "$AWS_REGION" \
    --function-name "$FUNCTION_NAME" \
    --name live \
    --function-version "$PREVIOUS_VERSION" \
    --output json >/dev/null

  log "Pinned live alias to newly published version ${PREVIOUS_VERSION}"
fi

log "Current live version is ${PREVIOUS_VERSION}"

PREVIOUS_FUNCTION_INFO="$(aws lambda get-function \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --qualifier "$PREVIOUS_VERSION" \
  --output json)"

# GetFunction's Code.ImageUri keeps the *tag* we pushed with (the git SHA -
# ci.yml's push-image job tags every image that way), and Code.ResolvedImageUri
# is the tag resolved to a digest at the time that version was published
# (docs.aws.amazon.com/lambda/latest/api/API_GetFunction.html). The digest,
# not the tag, is what we check against ECR: tags are immutable here, but the
# lifecycle policy can still expire and delete the underlying image.
PREVIOUS_IMAGE_URI="$(echo "$PREVIOUS_FUNCTION_INFO" | jq -r '.Code.ImageUri')"
PREVIOUS_RESOLVED_URI="$(echo "$PREVIOUS_FUNCTION_INFO" | jq -r '.Code.ResolvedImageUri')"
PREVIOUS_SHA="$(image_tag_from_image_uri "$PREVIOUS_IMAGE_URI")"
PREVIOUS_DIGEST="$(image_digest_from_resolved_uri "$PREVIOUS_RESOLVED_URI")"

log "Rollback target: version ${PREVIOUS_VERSION} = sha ${PREVIOUS_SHA} (${PREVIOUS_DIGEST})"

if ! aws ecr describe-images \
  --region "$AWS_REGION" \
  --repository-name "$REPO_NAME" \
  --image-ids "imageDigest=${PREVIOUS_DIGEST}" \
  --output json >/dev/null 2>&1; then
  fail "rollback target ${PREVIOUS_SHA} (${PREVIOUS_DIGEST}) is no longer in ECR - refusing to deploy with no rollback target (correction 8)."
fi

# --- 2. Ship the new code ---------------------------------------------------
log "Updating ${FUNCTION_NAME} to ${IMAGE_URI}"
UPDATE_RESULT="$(aws lambda update-function-code \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --image-uri "$IMAGE_URI" \
  --output json)"
CODE_SHA256="$(echo "$UPDATE_RESULT" | jq -r '.CodeSha256')"

log "Waiting for ${FUNCTION_NAME}'s code update to finish"
aws lambda wait function-updated-v2 \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME"

# --code-sha256 guards against a concurrent update-function-code (from a
# second, racing deploy) landing between our update and our publish: publish
# refuses unless $LATEST's hash still matches what we just uploaded
# (docs.aws.amazon.com/lambda/latest/api/API_PublishVersion.html).
log "Publishing a version"
PUBLISH_RESULT="$(aws lambda publish-version \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --code-sha256 "$CODE_SHA256" \
  --output json)"
NEW_VERSION="$(echo "$PUBLISH_RESULT" | jq -r '.Version')"
NEW_RESOLVED_URI="$(aws lambda get-function \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --qualifier "$NEW_VERSION" \
  --output json | jq -r '.Code.ResolvedImageUri')"
NEW_DIGEST="$(image_digest_from_resolved_uri "$NEW_RESOLVED_URI")"

# Per PublishVersion's own docs: "Lambda doesn't publish a version if the
# function's configuration and code haven't changed since the last version" -
# it returns the existing version instead of erroring. That happens whenever
# this SHA is already what's live (a re-run, or a no-op redeploy), and it is
# not a failure.
if [ "$NEW_VERSION" = "$PREVIOUS_VERSION" ]; then
  log "publish-version returned the already-published version ${NEW_VERSION} - nothing changed, this SHA is already live"
else
  log "Published version ${NEW_VERSION}"
fi

log "Shifting the live alias to version ${NEW_VERSION}"
aws lambda update-alias \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --name live \
  --function-version "$NEW_VERSION" \
  --output json >/dev/null

# --- 3. Smoke the public URL, shift-then-smoke per D3 -----------------------
FUNCTION_URL="$(aws lambda get-function-url-config \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --qualifier live \
  --output json | jq -r '.FunctionUrl')"

# Wall-clock seconds per smoke run, for the job summary (7.4 asks for smoke
# timings there). The per-request breakdown stays in smoke.sh's own log
# lines; the summary only needs "how long, and did it pass".
ROLLED_BACK=false
SMOKE_T0=$SECONDS
if "$SCRIPT_DIR/smoke.sh" "$FUNCTION_URL" "$SHA"; then
  SMOKE_TIMINGS="new version: pass in $((SECONDS - SMOKE_T0))s"
  EXIT_CODE=0
  OUTCOME="deployed and healthy"
else
  SMOKE_TIMINGS="new version: FAIL in $((SECONDS - SMOKE_T0))s"
  echo "::error::smoke failed against version ${NEW_VERSION} (sha ${SHA}) - rolling back to ${PREVIOUS_VERSION} (sha ${PREVIOUS_SHA})"
  aws lambda update-alias \
    --region "$AWS_REGION" \
    --function-name "$FUNCTION_NAME" \
    --name live \
    --function-version "$PREVIOUS_VERSION" \
    --output json >/dev/null
  ROLLED_BACK=true

  # A rollback that doesn't pass its own smoke test is a page, not a success
  # (7.4's plan text, verbatim) - re-smoke against the SHA the rollback
  # target actually runs, not the SHA we were trying to ship.
  SMOKE_T0=$SECONDS
  if "$SCRIPT_DIR/smoke.sh" "$FUNCTION_URL" "$PREVIOUS_SHA"; then
    SMOKE_TIMINGS="${SMOKE_TIMINGS}; rollback: pass in $((SECONDS - SMOKE_T0))s"
    EXIT_CODE=1
    OUTCOME="smoke failed, rolled back to ${PREVIOUS_VERSION} - rollback is healthy"
  else
    SMOKE_TIMINGS="${SMOKE_TIMINGS}; rollback: FAIL in $((SECONDS - SMOKE_T0))s"
    EXIT_CODE=2
    OUTCOME="smoke failed, rollback to ${PREVIOUS_VERSION} ALSO failed smoke - page a human"
  fi
fi

# --- 4. Prune old versions ---------------------------------------------------
# Best-effort hygiene, not correctness: skip it entirely when we're leaving
# an unresolved incident behind (exit 2) rather than touch anything more.
if [ "$EXIT_CODE" -ne 2 ]; then
  LIVE_VERSION="$(aws lambda get-alias \
    --region "$AWS_REGION" \
    --function-name "$FUNCTION_NAME" \
    --name live \
    --output json | jq -r '.FunctionVersion')"

  log "Pruning old versions of ${FUNCTION_NAME} (keeping the newest 10 and ${LIVE_VERSION})"
  # $LATEST can't be deleted by qualifier this way and isn't a published
  # version anyway; `sort -rn` orders numeric version strings newest-first.
  ALL_VERSIONS="$(aws lambda list-versions-by-function \
    --region "$AWS_REGION" \
    --function-name "$FUNCTION_NAME" \
    --output json | jq -r '.Versions[].Version | select(. != "$LATEST")' | sort -rn)"

  KEEP_COUNT=10
  INDEX=0
  while IFS= read -r version; do
    [ -z "$version" ] && continue
    INDEX=$((INDEX + 1))
    if [ "$INDEX" -le "$KEEP_COUNT" ] || [ "$version" = "$LIVE_VERSION" ]; then
      continue
    fi
    log "Pruning ${FUNCTION_NAME}:${version}"
    aws lambda delete-function \
      --region "$AWS_REGION" \
      --function-name "$FUNCTION_NAME" \
      --qualifier "$version" \
      --output json >/dev/null 2>&1 || echo "::warning::failed to prune version ${version} (continuing)"
  done <<<"$ALL_VERSIONS"
fi

# --- 5. Job summary -----------------------------------------------------------
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Deploy - ${ENV}"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| SHA | \`${SHA}\` |"
    echo "| Image digest | \`${NEW_DIGEST:-n/a}\` |"
    echo "| Version | \`${PREVIOUS_VERSION}\` -> \`${NEW_VERSION}\` |"
    echo "| Smoke | ${SMOKE_TIMINGS} |"
    echo "| Rolled back | ${ROLLED_BACK} |"
    echo "| Outcome | ${OUTCOME} |"
  } >>"$GITHUB_STEP_SUMMARY"
fi

log "Smoke: ${SMOKE_TIMINGS}"
log "Outcome: ${OUTCOME}"
exit "$EXIT_CODE"
