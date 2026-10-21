#!/usr/bin/env bash
#
# CI guard for the expand/contract rule (phase-7-steps.md 7.6, written up in
# backend/MIGRATIONS.md). Migrations run before code and the previous
# release keeps running against the new schema for as long as a rollback
# might last, so a migration that release can't tolerate needs a human to
# say so on purpose, with a `-- contract: <why this is safe now>` line,
# rather than slip through unnoticed.
#
# Two checks, against a base commit passed as $1:
#   1. Any migration file ADDED by this change whose "-- Up Migration"
#      section contains a destructive statement (DROP COLUMN, DROP TABLE,
#      RENAME, ALTER COLUMN ... TYPE, SET NOT NULL) must carry a
#      `-- contract:` line somewhere in the file.
#   2. No migration file already on the base commit may be MODIFIED or
#      DELETED - CLAUDE.md already says never to edit an applied migration,
#      add a new one instead. Both diffs run with --no-renames, so a rename
#      shows up as a delete of the old name plus an add of the new one and
#      is caught here too (without it git reports R, which neither
#      --diff-filter=MD nor =A matches, and a renamed file slips through).
#
# This is a speed bump, not a proof: it catches the accident, not the
# deliberate choice, and it only looks at .sql text, never runs it.
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: check-migration-safety.sh <base-commit>" >&2
  exit 2
fi

base_sha="$1"
migrations_dir="migrations"

if ! git rev-parse --quiet --verify "${base_sha}^{commit}" >/dev/null; then
  echo "::error::base commit ${base_sha} not found - checkout needs fetch-depth: 0"
  exit 1
fi

status=0

# --- Rule 2: no existing migration may be modified or deleted -------------
# Quoted so the shell does not glob-expand this into whatever .sql files
# happen to exist in the working tree right now - a deleted file wouldn't be
# one of them, and would silently drop out of the check.
mapfile -t changed_existing < <(
  git diff --name-only --relative --no-renames --diff-filter=MD "${base_sha}...HEAD" -- "${migrations_dir}/*.sql"
)

if [[ ${#changed_existing[@]} -gt 0 ]]; then
  echo "::error::Existing migration file(s) modified or deleted - never edit an applied migration, add a new one (backend/MIGRATIONS.md):"
  printf '  %s\n' "${changed_existing[@]}"
  status=1
fi

# --- Rule 1: added migrations with a destructive Up statement need a contract line
mapfile -t added < <(
  git diff --name-only --relative --no-renames --diff-filter=A "${base_sha}...HEAD" -- "${migrations_dir}/*.sql"
)

# `[^;]*` rather than `.*` for ALTER COLUMN ... TYPE: the Up section is
# flattened to one line below, so `.*` would pair an innocent
# `ALTER COLUMN "x" SET DEFAULT ...` with a `TYPE` in a later statement.
destructive_pattern='drop[[:space:]]+column|drop[[:space:]]+table|rename|alter[[:space:]]+column[^;]*[[:space:]]type([^[:alnum:]_]|$)|set[[:space:]]+not[[:space:]]+null'

for file in "${added[@]}"; do
  [[ -z "${file}" ]] && continue

  # Bound to the "-- Up Migration" .. "-- Down Migration" section (matched
  # case-insensitively, since that's all this file format needs), then strip
  # `--` line comments and `/* */` block comments before searching, so a
  # comment that merely mentions one of these keywords (e.g. explaining why
  # the migration does NOT do it) can't trigger a false positive. Newlines
  # are flattened to spaces so a statement split across lines, like
  # `ALTER COLUMN "x"\n  TYPE text`, still matches as one phrase.
  #
  # Order matters: line comments go first (so a `/*` inside one can't open a
  # block), then the text is flattened, then block comments are removed with
  # a regex that ends each one at its own `*/`. A line-range delete
  # (`sed '/\/\*/,/\*\//d'`) looks like it does the same but doesn't: on a
  # one-line `/* ... */` the range never closes and swallows the rest of the
  # section, statements included - an unclosed comment now leaves the text
  # in place instead, which errs towards failing, not passing.
  # scripts/test-check-migration-safety.sh covers both cases.
  up_section=$(
    awk 'BEGIN{f=0} { t=tolower($0);
      if (t ~ /^--[ \t]*up migration/) { f=1; next }
      if (t ~ /^--[ \t]*down migration/) { f=0 }
      if (f) print }' "${file}" \
      | sed -e 's/--.*$//' \
      | tr '\n' ' ' \
      | sed -E -e 's:/\*([^*]|\*+[^*/])*\*+/: :g'
  )

  if grep -qiE "${destructive_pattern}" <<<"${up_section}"; then
    if ! grep -qiE '^--[[:space:]]*contract:' "${file}"; then
      echo "::error file=${file}::Destructive statement in the Up migration with no '-- contract: <reason>' line (see backend/MIGRATIONS.md)"
      status=1
    fi
  fi
done

if [[ "${status}" -eq 0 ]]; then
  echo "OK: migration-safety checks passed"
fi

exit "${status}"
