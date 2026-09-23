#!/usr/bin/env bash
#
# Regression cases for check-migration-safety.sh, so the guard's mutation
# test (phase-7-steps.md 7.6) is repeatable instead of a one-off on a scratch
# branch. Builds a throwaway git repo in a temp dir with one "applied"
# migration, then for each case makes one commit on top of it, runs the
# guard against the base commit, and compares pass/fail. Never touches the
# real repository. Run from anywhere: bash scripts/test-check-migration-safety.sh
set -euo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
cd "${work}"

git init -q
git config user.email guard-test@example.invalid
git config user.name guard-test
git config commit.gpgsign false
git config core.autocrlf false

mkdir migrations
cat > migrations/0001_base.sql <<'SQL'
-- Up Migration
CREATE TABLE "Order" ("id" serial PRIMARY KEY, "status" text);

-- Down Migration
DROP TABLE "Order";
SQL
git add -A
git commit -qm base
base="$(git rev-parse HEAD)"

failures=0

# check <expected: pass|fail> <name> - commit whatever the case changed, run
# the guard, then reset to the base for the next case.
check() {
  local want=$1 name=$2 got
  git add -A
  git commit -qm "${name}" --allow-empty
  # Via bash, as CI runs it: the script isn't committed executable.
  if bash "${guard}" "${base}" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [[ "${got}" == "${want}" ]]; then
    echo "ok    ${name} (${got})"
  else
    echo "FAIL  ${name}: expected ${want}, got ${got}"
    failures=$((failures + 1))
  fi
  git reset -q --hard "${base}"
  git clean -qfd
}

# add: the case's new migration, from stdin.
add() { cat > migrations/0002_case.sql; }

check pass "no migration changes"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order" ADD COLUMN "fulfillmentStatus" text;
CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order" ("fulfillmentStatus");

-- Down Migration
ALTER TABLE "Order" DROP COLUMN "fulfillmentStatus";
SQL
check pass "expand-only migration (destructive statement only in Down)"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order" DROP COLUMN "status";

-- Down Migration
ALTER TABLE "Order" ADD COLUMN "status" text;
SQL
check fail "DROP COLUMN without a contract line"

add <<'SQL'
-- contract: status has not been read since the fulfillmentStatus deploy
-- Up Migration
ALTER TABLE "Order" DROP COLUMN "status";

-- Down Migration
ALTER TABLE "Order" ADD COLUMN "status" text;
SQL
check pass "DROP COLUMN with a contract line"

add <<'SQL'
-- Up Migration
drop table "Order";

-- Down Migration
SQL
check fail "lowercase drop table"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order" RENAME COLUMN "status" TO "fulfillmentStatus";

-- Down Migration
SQL
check fail "RENAME COLUMN"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order"
  ALTER COLUMN "status"
  TYPE varchar(20);

-- Down Migration
SQL
check fail "ALTER COLUMN ... TYPE split across lines"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order" ALTER COLUMN "status" SET NOT NULL;

-- Down Migration
SQL
check fail "SET NOT NULL"

add <<'SQL'
-- Up Migration
-- Deliberately does not DROP COLUMN "status"; that's a later deploy.
/* Nor does it RENAME anything,
   or SET NOT NULL. */
ALTER TABLE "Order" ADD COLUMN "note" text;

-- Down Migration
SQL
check pass "keywords only inside comments"

add <<'SQL'
-- Up Migration
/* status is superseded by fulfillmentStatus */
ALTER TABLE "Order" DROP COLUMN "status";

-- Down Migration
SQL
check fail "one-line block comment before a DROP COLUMN"

add <<'SQL'
-- Up Migration
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'pending';
CREATE TYPE "fulfillment" AS ENUM ('pending', 'shipped');

-- Down Migration
SQL
check pass "ALTER COLUMN SET DEFAULT, then an unrelated CREATE TYPE"

echo '-- a harmless-looking edit' >> migrations/0001_base.sql
check fail "modifying an existing migration"

{ echo '-- contract: surely fine'; cat migrations/0001_base.sql; } > m.tmp
mv m.tmp migrations/0001_base.sql
check fail "modifying an existing migration, even with a contract line"

git rm -q migrations/0001_base.sql
check fail "deleting an existing migration"

git mv migrations/0001_base.sql migrations/0001_renamed.sql
check fail "renaming an existing migration"

if [[ "${failures}" -gt 0 ]]; then
  echo "${failures} case(s) failed"
  exit 1
fi
echo "OK: all migration-safety cases behaved as expected"
