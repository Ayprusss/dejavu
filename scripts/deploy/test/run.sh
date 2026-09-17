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
echo
echo "======================================================================"
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
