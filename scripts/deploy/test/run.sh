#!/usr/bin/env bash
#
# scripts/deploy/test/run.sh
#
# Fake-aws/fake-curl harness for scripts/deploy/*.sh (7.4). No network calls,
# no AWS credentials, no live systems touched: PATH is pointed at
# test/fake-bin so `aws` and `curl` resolve to the fakes there, and each case
# gets its own throwaway state directory. Run it with:
#
#   ./scripts/deploy/test/run.sh
#
# Exit 0 - every case passed. Non-zero - see the FAIL lines.
set -uo pipefail # deliberately not -e: one failing case must not stop the rest

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$HERE")"
export PATH="$HERE/fake-bin:$PATH"

export AWS_REGION="us-east-1"
export ECR_API_REPO="111111111111.dkr.ecr.us-east-1.amazonaws.com/dejavu-api"
export ECR_MIGRATOR_REPO="111111111111.dkr.ecr.us-east-1.amazonaws.com/dejavu-migrator"

PASS=0
FAIL=0
STATE_DIR=""

# --- state setup helpers -----------------------------------------------------
# Function keys here match exactly what deploy.sh/migrate.sh/promote-check.sh
# build from <env> and the hardcoded prod/dev names: "dejavu-dev-api" and
# "dejavu-dev-migrator" - not "api"/"migrator".

new_state_dir() {
  STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dejavu-deploy-test.XXXXXX")"
  export FAKE_AWS_STATE_DIR="$STATE_DIR"
  export GITHUB_STEP_SUMMARY="$STATE_DIR/summary.md"
}

# fn_init <function-name> <repo-basename> <url>
fn_init() {
  local dir="$STATE_DIR/functions/$1"
  mkdir -p "$dir/versions"
  printf '%s' "$2" >"$dir/repo"
  printf '%s' "$3" >"$dir/url"
  echo 1 >"$dir/next_version"
}

# fn_set_version <function-name> <version> <sha>
fn_set_version() {
  local dir="$STATE_DIR/functions/$1"
  printf '{"sha":"%s","digest":"sha256:digest-%s","codesha256":"codesha-%s"}' "$3" "$3" "$3" \
    >"$dir/versions/$2.json"
}

# fn_set_latest <function-name> <sha>
fn_set_latest() {
  local dir="$STATE_DIR/functions/$1"
  printf '{"sha":"%s","digest":"sha256:digest-%s","codesha256":"codesha-%s"}' "$2" "$2" "$2" \
    >"$dir/latest.json"
}

# fn_set_alias <function-name> <version>
fn_set_alias() {
  printf '%s' "$2" >"$STATE_DIR/functions/$1/alias_live"
}

# fn_set_next_version <function-name> <n>
fn_set_next_version() {
  echo "$2" >"$STATE_DIR/functions/$1/next_version"
}

# fn_mark_products_broken <function-name> <version>
fn_mark_products_broken() {
  mkdir -p "$STATE_DIR/functions/$1/versions"
  touch "$STATE_DIR/functions/$1/versions/$2.products-broken"
}

# fn_mark_products_transient <function-name> <version> <n>
# The next <n> /api/products calls against <version> 500, then it recovers -
# the RDS rotation blip (issue #22).
fn_mark_products_transient() {
  mkdir -p "$STATE_DIR/functions/$1/versions"
  echo "$3" >"$STATE_DIR/functions/$1/versions/$2.products-transient"
}

# assert_transient_consumed <function-name> <version> <name>
# Guards against a vacuous pass: the blip must actually have been served.
assert_transient_consumed() {
  local actual
  actual="$(cat "$STATE_DIR/functions/$1/versions/$2.products-transient" 2>/dev/null || echo "<missing>")"
  if [ "$actual" = "0" ]; then
    pass "$3"
  else
    fail_case "$3 (expected the transient failure to be served, counter=$actual)"
  fi
}

# ecr_add <repo-basename> <sha>
ecr_add() {
  mkdir -p "$STATE_DIR/ecr/$1/tags" "$STATE_DIR/ecr/$1/digests"
  printf 'sha256:digest-%s' "$2" >"$STATE_DIR/ecr/$1/tags/$2"
  touch "$STATE_DIR/ecr/$1/digests/sha256:digest-$2"
}

set_scenario() {
  printf '%s' "$1" >"$STATE_DIR/scenario"
}

# --- assertions ---------------------------------------------------------------

pass() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}

fail_case() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1"
  if [ -n "${2:-}" ]; then
    echo "$2" | sed 's/^/    /'
  fi
}

# run_case <name> <expected-exit> <script> [args...]
# Runs the script with the current $STATE_DIR, asserts its exit code, and
# leaves $LAST_OUTPUT / $LAST_EXIT for the caller to make further assertions.
run_case() {
  local name="$1" expected="$2"
  shift 2
  LAST_OUTPUT="$("$@" 2>&1)"
  LAST_EXIT=$?
  if [ "$LAST_EXIT" -eq "$expected" ]; then
    pass "$name (exit $LAST_EXIT)"
  else
    fail_case "$name (expected exit $expected, got $LAST_EXIT)" "$LAST_OUTPUT"
  fi
}

assert_alias() {
  local fn="$1" expected="$2" name="$3"
  local actual
  actual="$(cat "$STATE_DIR/functions/$fn/alias_live" 2>/dev/null || echo "<missing>")"
  if [ "$actual" = "$expected" ]; then
    pass "$name (alias=$actual)"
  else
    fail_case "$name (expected alias=$expected, got $actual)"
  fi
}

assert_version_sha() {
  local fn="$1" version="$2" expected_sha="$3" name="$4"
  local actual
  actual="$(jq -r '.sha' "$STATE_DIR/functions/$fn/versions/$version.json" 2>/dev/null || echo "<missing>")"
  if [ "$actual" = "$expected_sha" ]; then
    pass "$name (version $version sha=$actual)"
  else
    fail_case "$name (expected version $version sha=$expected_sha, got $actual)"
  fi
}

assert_file_absent() {
  local path="$1" name="$2"
  if [ ! -e "$path" ]; then
    pass "$name"
  else
    fail_case "$name (unexpectedly present: $path)"
  fi
}

# assert_contains <haystack> <needle> <name>
assert_contains() {
  case "$1" in
    *"$2"*) pass "$3" ;;
    *) fail_case "$3 (expected to find: $2)" "$1" ;;
  esac
}

# assert_not_contains <haystack> <needle> <name>
assert_not_contains() {
  case "$1" in
    *"$2"*) fail_case "$3 (unexpectedly found: $2)" "$1" ;;
    *) pass "$3" ;;
  esac
}

summary() { cat "$GITHUB_STEP_SUMMARY" 2>/dev/null || echo "<no summary written>"; }
calls() { cat "$STATE_DIR/calls.log" 2>/dev/null || echo "<no aws calls>"; }

# first_call_line <pattern> - line number of the first aws call matching it
first_call_line() {
  grep -n -m1 -- "$1" "$STATE_DIR/calls.log" 2>/dev/null | cut -d: -f1
}

# fn_set_versions <function-name> <n> - published versions 1..n, each on its
# own sha ("v1".."vn"), with $LATEST on vn's code.
fn_set_versions() {
  local i
  for i in $(seq 1 "$2"); do
    fn_set_version "$1" "$i" "v$i"
  done
  fn_set_latest "$1" "v$2"
  fn_set_next_version "$1" "$(($2 + 1))"
}

# assert_versions_present <function-name> <name> <version>...
assert_versions_present() {
  local fn="$1" name="$2" v missing=""
  shift 2
  for v in "$@"; do
    [ -f "$STATE_DIR/functions/$fn/versions/$v.json" ] || missing="$missing $v"
  done
  if [ -z "$missing" ]; then
    pass "$name"
  else
    fail_case "$name (missing:$missing)"
  fi
}

# assert_versions_absent <function-name> <name> <version>...
assert_versions_absent() {
  local fn="$1" name="$2" v present=""
  shift 2
  for v in "$@"; do
    [ -f "$STATE_DIR/functions/$fn/versions/$v.json" ] && present="$present $v"
  done
  if [ -z "$present" ]; then
    pass "$name"
  else
    fail_case "$name (still present:$present)"
  fi
}

API="dejavu-dev-api"
MIGRATOR="dejavu-dev-migrator"

# ==============================================================================
# Case 1: happy path
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_latest "$API" old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api old-sha
ecr_add dejavu-api new-sha

run_case "deploy: happy path" 0 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 2 "deploy: happy path shifts alias to the new version"
# 7.4: env, SHA, image digest, old -> new version, smoke timings, rolled back.
SUMMARY="$(summary)"
assert_contains "$SUMMARY" "### Deploy - dev" "deploy summary: names the env"
assert_contains "$SUMMARY" "| SHA | \`new-sha\` |" "deploy summary: names the SHA"
assert_contains "$SUMMARY" "sha256:digest-new-sha" "deploy summary: carries the image digest"
assert_contains "$SUMMARY" "| Version | \`1\` -> \`2\` |" "deploy summary: old -> new version"
assert_contains "$SUMMARY" "| Smoke | new version: pass in " "deploy summary: smoke timing"
assert_contains "$SUMMARY" "| Rolled back | false |" "deploy summary: not rolled back"

# ==============================================================================
# Case 2: smoke failure -> rollback -> exit 1
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_latest "$API" old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api old-sha
ecr_add dejavu-api new-sha
fn_mark_products_broken "$API" 2 # the version about to be published as "2"

run_case "deploy: smoke failure rolls back" 1 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 1 "deploy: rollback lands back on the previous version"
SUMMARY="$(summary)"
assert_contains "$SUMMARY" "| Smoke | new version: FAIL in " "deploy summary (rollback): new version's smoke timing"
assert_contains "$SUMMARY" "; rollback: pass in " "deploy summary (rollback): rollback's re-smoke timing"
assert_contains "$SUMMARY" "| Rolled back | true |" "deploy summary (rollback): says it rolled back"

# ==============================================================================
# Case 3: rollback smoke also fails -> exit 2
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_latest "$API" old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api old-sha
ecr_add dejavu-api new-sha
fn_mark_products_broken "$API" 2 # the new version
fn_mark_products_broken "$API" 1 # AND the rollback target

run_case "deploy: rollback smoke also fails" 2 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 1 "deploy: alias still moved to the rollback target even though its smoke also failed"
SUMMARY="$(summary)"
assert_contains "$SUMMARY" "; rollback: FAIL in " "deploy summary (exit 2): rollback's re-smoke failed"
assert_contains "$SUMMARY" "page a human" "deploy summary (exit 2): says it's a page, not a success"

# ==============================================================================
# Case 4: migrator FunctionError -> non-zero, payload printed
# ==============================================================================
new_state_dir
fn_init "$MIGRATOR" dejavu-migrator ""
set_scenario "migrator-function-error"

run_case "migrate: FunctionError fails the job" 1 "$DEPLOY_DIR/migrate.sh" dev bad-sha
case "$LAST_OUTPUT" in
  *"FunctionError=Unhandled"* | *"division by zero"*)
    pass "migrate: FunctionError case prints the payload/error for the log"
    ;;
  *)
    fail_case "migrate: FunctionError case should print the payload/error" "$LAST_OUTPUT"
    ;;
esac
assert_contains "$LAST_OUTPUT" "one transaction per migration" \
  "migrate: FunctionError case says where the schema was left"

# ==============================================================================
# migrate.sh happy path: flags, order, and the payload in the log
# ==============================================================================
new_state_dir
fn_init "$MIGRATOR" dejavu-migrator ""

run_case "migrate: happy path" 0 "$DEPLOY_DIR/migrate.sh" dev good-sha
assert_contains "$LAST_OUTPUT" '{"migrations":["001_init.sql"]}' \
  "migrate: success still prints the raw payload"
assert_contains "$LAST_OUTPUT" "Applied: 001_init.sql" "migrate: names the applied migrations"
CALLS="$(calls)"
assert_contains "$CALLS" "update-function-code --region us-east-1 --function-name dejavu-dev-migrator --image-uri ${ECR_MIGRATOR_REPO}:good-sha" \
  "migrate: points the migrator at dejavu-migrator:<sha>"
# Correction 6. Both would be invisible to every other assertion here.
assert_contains "$CALLS" "AWS_MAX_ATTEMPTS=1 aws lambda invoke" "migrate: invoke runs with AWS_MAX_ATTEMPTS=1"
assert_contains "$CALLS" "--cli-read-timeout 310" "migrate: invoke passes --cli-read-timeout 310"
assert_contains "$CALLS" '--payload {"action":"up"}' 'migrate: invoke sends {"action":"up"}'
UPDATE_LINE="$(first_call_line "lambda update-function-code")"
WAIT_LINE="$(first_call_line "lambda wait function-updated-v2")"
INVOKE_LINE="$(first_call_line "lambda invoke")"
if [ -n "$UPDATE_LINE" ] && [ -n "$WAIT_LINE" ] && [ -n "$INVOKE_LINE" ] &&
  [ "$UPDATE_LINE" -lt "$WAIT_LINE" ] && [ "$WAIT_LINE" -lt "$INVOKE_LINE" ]; then
  pass "migrate: update -> wait function-updated-v2 -> invoke, in that order"
else
  fail_case "migrate: expected update -> wait -> invoke order" "$CALLS"
fi

new_state_dir
fn_init "$MIGRATOR" dejavu-migrator ""
set_scenario "migrator-none-pending"
run_case "migrate: nothing pending is success" 0 "$DEPLOY_DIR/migrate.sh" dev good-sha
assert_contains "$LAST_OUTPUT" "No migrations to run" "migrate: says so when nothing was pending"

# ==============================================================================
# Case 5: missing rollback image -> refuse to deploy
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
# Deliberately no `ecr_add dejavu-api old-sha` - the rollback target's image
# has "expired" out of ECR (correction 8).
ecr_add dejavu-api new-sha

run_case "deploy: refuses with no rollback image" 1 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 1 "deploy: alias untouched when the deploy is refused"
assert_file_absent "$STATE_DIR/functions/$API/latest.json" \
  "deploy: never even called update-function-code when refusing"

# ==============================================================================
# Case 6: publish-version returns the existing version (no-op redeploy)
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 same-sha
fn_set_latest "$API" same-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api same-sha

run_case "deploy: redeploying the live SHA is a no-op, not an error" 0 \
  "$DEPLOY_DIR/deploy.sh" dev same-sha
assert_alias "$API" 1 "deploy: already-live redeploy leaves the alias where it was"
assert_file_absent "$STATE_DIR/functions/$API/versions/2.json" \
  "deploy: already-live redeploy does not allocate a new version"

# ==============================================================================
# Case 7: live alias on $LATEST (bootstrap/re-create, 7.2) - pin before deploy
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_latest "$API" boot-sha
fn_set_alias "$API" '$LATEST'
fn_set_next_version "$API" 1
ecr_add dejavu-api boot-sha
ecr_add dejavu-api new-sha

run_case "deploy: \$LATEST alias is pinned before the real deploy" 0 \
  "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_version_sha "$API" 1 boot-sha \
  "deploy: \$LATEST got snapshotted as version 1 (the rollback target)"
assert_alias "$API" 2 "deploy: ends up shifted to the newly published version 2"

# ==============================================================================
# Bonus coverage: smoke.sh directly, and promote-check.sh
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 good-sha
fn_set_alias "$API" 1

run_case "smoke: passes against a healthy version" 0 \
  "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha

fn_mark_products_broken "$API" 1
run_case "smoke: fails when /api/products 500s" 1 \
  "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha

# ==============================================================================
# Issue #22: the weekly RDS secret rotation costs one 28P01 per warm
# environment (6.10 run 2), which /api/products - smoke's only DB-backed check
# - surfaces as a single 500. smoke.sh's retries must absorb exactly that, or
# a rotation turns a good deploy into a rollback. Remove the retries
# (MAX_ATTEMPTS=1) and these cases go red.
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 good-sha
fn_set_alias "$API" 1
fn_mark_products_transient "$API" 1 1

run_case "smoke: survives exactly one transient /api/products 500 (rotation blip)" 0 \
  "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha
assert_transient_consumed "$API" 1 "smoke: the rotation blip was actually served, then retried"
case "$LAST_OUTPUT" in
  *"/api/products -> 500"*"/api/products -> 200"*)
    pass "smoke: log shows the 500 then the 200 on retry"
    ;;
  *)
    fail_case "smoke: log should show /api/products 500 then 200" "$LAST_OUTPUT"
    ;;
esac

# The same blip during a real deploy's smoke must not roll back...
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_latest "$API" old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api old-sha
ecr_add dejavu-api new-sha
fn_mark_products_transient "$API" 2 1

run_case "deploy: a rotation blip on the new version does not roll back" 0 \
  "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 2 "deploy: rotation blip - alias stays on the new version"
assert_transient_consumed "$API" 2 "deploy: rotation blip was served to the new version's smoke"

# ...and during the rollback's re-smoke (the previous version's environments
# are the warm ones, so the likelier place for a stale cached password) it
# must not escalate a healthy rollback (exit 1) into a page (exit 2) - the
# 7.10 drill's own path.
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 old-sha
fn_set_latest "$API" old-sha
fn_set_alias "$API" 1
fn_set_next_version "$API" 2
ecr_add dejavu-api old-sha
ecr_add dejavu-api new-sha
fn_mark_products_broken "$API" 2
fn_mark_products_transient "$API" 1 1

run_case "deploy: a rotation blip on the rollback's re-smoke is still exit 1, not 2" 1 \
  "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 1 "deploy: rotation blip on rollback - alias back on the previous version"
assert_transient_consumed "$API" 1 "deploy: rotation blip was served to the rollback's re-smoke"

new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 match-sha
fn_set_alias "$API" 1
fn_init "$MIGRATOR" dejavu-migrator ""
fn_set_latest "$MIGRATOR" match-sha
ecr_add dejavu-api match-sha
ecr_add dejavu-migrator match-sha

run_case "promote-check: matching digests pass" 0 \
  "$DEPLOY_DIR/promote-check.sh" match-sha

# A different SHA whose images exist in ECR but which dev never deployed -
# dev's live/\$LATEST digests are still "match-sha"'s, so this must refuse.
ecr_add dejavu-api different-sha
ecr_add dejavu-migrator different-sha
run_case "promote-check: mismatched sha refuses to promote" 1 \
  "$DEPLOY_DIR/promote-check.sh" different-sha

# ==============================================================================
# Prune: keep the newest 10 published versions plus whatever `live` is on
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_versions "$API" 12
fn_set_alias "$API" 12
ecr_add dejavu-api v12
ecr_add dejavu-api new-sha

run_case "prune: a healthy deploy with 12 old versions" 0 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 13 "prune: alias on the new version 13"
assert_versions_absent "$API" "prune: versions older than the newest 10 are deleted" 1 2 3
assert_versions_present "$API" "prune: the newest 10 are kept" 4 5 6 7 8 9 10 11 12 13

# The alias target is kept even when it's older than the newest 10: here
# `live` was already on version 1 (an earlier rollback), the deploy of
# version 13 fails smoke, and the rollback lands back on 1.
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_versions "$API" 12
fn_set_alias "$API" 1
ecr_add dejavu-api v1
ecr_add dejavu-api new-sha
fn_mark_products_broken "$API" 13

run_case "prune: after a rollback onto an old version" 1 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_alias "$API" 1 "prune: alias rolled back onto version 1"
assert_versions_present "$API" "prune: never deletes the alias target, however old" 1
assert_versions_absent "$API" "prune: still deletes the rest beyond the newest 10" 2 3
assert_versions_present "$API" "prune: the newest 10 are kept after a rollback" 4 5 6 7 8 9 10 11 12 13

# Exit 2 is an unresolved incident: prune must not touch anything.
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_versions "$API" 12
fn_set_alias "$API" 12
ecr_add dejavu-api v12
ecr_add dejavu-api new-sha
fn_mark_products_broken "$API" 13
fn_mark_products_broken "$API" 12

run_case "prune: skipped when the rollback's smoke also fails" 2 "$DEPLOY_DIR/deploy.sh" dev new-sha
assert_not_contains "$(calls)" "delete-function" "prune: no delete-function calls on exit 2"
assert_versions_present "$API" "prune: every version survives an exit 2" 1 2 3 4 5 6 7 8 9 10 11 12 13

# ==============================================================================
# smoke.sh's 15s budget is hard: no request's timeout outlasts what's left.
# bash imports SECONDS from the environment, so `env SECONDS=N` starts the
# script's stopwatch N seconds in, without the test having to sleep.
# ==============================================================================
new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 good-sha
fn_set_alias "$API" 1

run_case "smoke budget: fresh run" 0 "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha
TIMEOUTS="$(sort -u "$STATE_DIR/curl-timeouts.log" 2>/dev/null | tr '\n' ' ')"
if [ "$TIMEOUTS" = "4 " ]; then
  pass "smoke budget: a fresh run uses the full 4s per request"
else
  fail_case "smoke budget: expected every -m to be 4, got: ${TIMEOUTS:-<none>}"
fi

new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 good-sha
fn_set_alias "$API" 1

run_case "smoke budget: 12s already spent" 0 \
  env SECONDS=12 "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha
MAX_TIMEOUT="$(sort -n "$STATE_DIR/curl-timeouts.log" 2>/dev/null | tail -n1)"
if [ -n "$MAX_TIMEOUT" ] && [ "$MAX_TIMEOUT" -le 3 ]; then
  pass "smoke budget: with 3s left, no request gets more than 3s (max -m $MAX_TIMEOUT)"
else
  fail_case "smoke budget: with 3s left, expected every -m <= 3, got max ${MAX_TIMEOUT:-<none>}"
fi

new_state_dir
fn_init "$API" dejavu-api "https://api-dev.example.com"
fn_set_version "$API" 1 good-sha
fn_set_alias "$API" 1

run_case "smoke budget: already out of budget fails" 1 \
  env SECONDS=15 "$DEPLOY_DIR/smoke.sh" "https://api-dev.example.com" good-sha
assert_file_absent "$STATE_DIR/curl-timeouts.log" "smoke budget: out of budget makes no request at all"

# ==============================================================================
echo
echo "======================================================================"
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
