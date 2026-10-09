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
# second call can't run anything twice - the migrator doesn't set
# advisoryLockMode, so it's the default "fail" and the second call throws
# "Another migration is already running" at once - but that still turns a
# slow-but-successful migration into a red job for no reason.
# --cli-read-timeout 310 outlasts the function timeout;
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

# Where a failed run leaves the schema (7.4, verified against node-pg-migrate
# 9.0.0's runner): the migrator doesn't pass singleTransaction, so each
# migration runs in its own BEGIN/COMMIT, not one transaction for the run.
# Every migration before the failing one is committed and recorded in
# pgmigrations; the failing one is rolled back whole; none after it ran.
if [ -n "$FUNCTION_ERROR" ]; then
  echo "Schema state: migrations before the failing one in this run are committed (one transaction per migration); the failing one was rolled back and nothing after it ran. SELECT name FROM pgmigrations shows exactly what applied." >&2
  fail "migrator invocation failed (FunctionError=${FUNCTION_ERROR}) - see payload above. deploy.sh must not run."
fi

# The handler returns {"migrations":[<names applied>]} for "up" (src/
# migrator.js). node-pg-migrate's own "No migrations to run!" goes to the
# function's CloudWatch log, not this payload, so say it here too.
# Informational only - the run already succeeded, so an odd payload must not
# turn it red.
APPLIED="$(jq -r '(.migrations // []) | join(", ")' "$PAYLOAD_FILE" 2>/dev/null ||
  echo "<unparseable payload - see above>")"
if [ -z "$APPLIED" ]; then
  log "No migrations to run - schema already current"
else
  log "Applied: ${APPLIED}"
fi

log "Migration succeeded"
