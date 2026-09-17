#!/usr/bin/env bash
#
# migrate.sh <env> <sha>
#
# Updates the migrator Lambda to the image tagged <sha> and invokes it with
# {"action":"up"} before deploy.sh ever touches the api function's alias -
# 7.6's expand/contract rule only holds if the schema is always ahead of the
# code that's about to take traffic. Exit 0 = migrations applied (or none
# pending); non-zero = deploy.sh must not run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

ENV="${1:?usage: migrate.sh <env> <sha>}"
SHA="${2:?usage: migrate.sh <env> <sha>}"

require_env AWS_REGION
require_env ECR_MIGRATOR_REPO

FUNCTION_NAME="dejavu-${ENV}-migrator"
IMAGE_URI="${ECR_MIGRATOR_REPO}:${SHA}"

log "Updating ${FUNCTION_NAME} to ${IMAGE_URI}"
aws lambda update-function-code \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --image-uri "$IMAGE_URI" \
  --output json >/dev/null

# function-updated-v2, not the older function-updated waiter: both poll
# LastUpdateStatus via GetFunction, but only v2 is documented against that
# field (docs.aws.amazon.com/cli/latest/reference/lambda/wait/function-updated-v2.html) -
# see corrections list item 6's neighbourhood in phase-7-steps.md.
log "Waiting for ${FUNCTION_NAME}'s code update to finish"
aws lambda wait function-updated-v2 \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME"

PAYLOAD_FILE="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE"' EXIT

log "Invoking ${FUNCTION_NAME} with {\"action\":\"up\"}"

# Correction 6: the CLI's own read timeout (60s) is shorter than the
# migrator's function timeout (300s), and its default retry-on-timeout would
# invoke the handler a second time while the first run was still in flight.
# node-pg-migrate's advisory lock (PG_MIGRATE_LOCK_ID in its runner) means the
# second call just waits and then fails instead of corrupting anything, but
# it still turns a slow-but-successful migration into a red job for no
# reason. --cli-read-timeout 310 outlasts the function timeout;
# AWS_MAX_ATTEMPTS=1 disables the CLI's SDK-level retry entirely.
INVOKE_RESULT="$(AWS_MAX_ATTEMPTS=1 aws lambda invoke \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --cli-read-timeout 310 \
  --payload '{"action":"up"}' \
  --cli-binary-format raw-in-base64-out \
  --output json \
  "$PAYLOAD_FILE")"

echo "$INVOKE_RESULT"
echo "---- migrator response payload (${PAYLOAD_FILE}) ----"
cat "$PAYLOAD_FILE"
echo
echo "------------------------------------------------------"

# Correction 5: `aws lambda invoke` exits 0 and returns HTTP 200 even when the
# handler threw - Invoke's own docs say so explicitly ("The status code...
# doesn't reflect function errors"). The only signal is the `FunctionError`
# key in this response JSON (surfaced from the X-Amz-Function-Error header -
# docs.aws.amazon.com/lambda/latest/api/API_Invoke.html), with the stack
# trace in the payload file printed above. `// empty` makes a missing key
# resolve to "" instead of jq printing the literal string "null".
FUNCTION_ERROR="$(echo "$INVOKE_RESULT" | jq -r '.FunctionError // empty')"

if [ -n "$FUNCTION_ERROR" ]; then
  fail "migrator invocation failed (FunctionError=${FUNCTION_ERROR}) - see payload above. deploy.sh must not run."
fi

log "Migration succeeded"
