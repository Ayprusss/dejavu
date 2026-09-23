# Migrations

Plain `.sql` files, split into `-- Up Migration` / `-- Down Migration`
sections, run by `node-pg-migrate` against `DATABASE_URL`. Local, CI and RDS
all run this same set. **Never edit an applied migration — add a new one.**
CI enforces this (`migration-safety`, below): a PR that modifies, deletes or renames
an existing `migrations/*.sql` file fails.

## The rule: expand/contract

Migrations run before code deploys, and deploys can roll back (7.5, 7.10).
For the length of a deploy, and for as long as a rollback might last, **the
previous release runs against the new schema** — rolling back the code does
not roll back the schema. A migration that the previous release can't
tolerate breaks that release the moment it lands, with no way back except a
second migration.

**Allowed in one deploy** (the previous release keeps working unmodified):

- add a nullable column, or one with a default
- add a table
- add an index (`CONCURRENTLY` once a table is big enough for it to matter —
  it isn't yet here, and `CONCURRENTLY` can't run inside a transaction)
- widen a constraint (e.g. a `CHECK` that accepts more than it used to)

**Not allowed in one deploy** (the previous release breaks, or a rollback
would):

- drop or rename a column or table
- add `NOT NULL` without a default
- narrow a column's type
- tighten a `CHECK` that existing rows, or the old code's writes, might
  violate

## Worked example: renaming a column

`Order.status` → `Order.fulfillmentStatus` looks like a one-line migration
and isn't — it takes **three separate deploys**:

1. **Add.** Add the new `fulfillmentStatus` column. Code in this deploy
   writes both columns and reads only the old one.
2. **Backfill.** Backfill `fulfillmentStatus` from `status` for existing
   rows. Code in this deploy still writes both, but now reads the new
   column.
3. **Drop — in a later deploy, never the same one as step 2.** Stop writing
   `status`. Only once that has shipped and can't be rolled back into, drop
   the `status` column in a migration of its own.

The reason the drop waits for its own deploy: rollback from deploy _N_ lands
on deploy _N−1_, and that's only safe if the drop never ships alongside the
code that stopped using the dropped column. If they shipped together, rolling
back the code would land on code that reads a column the schema no longer
has.

## CI guard: `migration-safety`

The `migrations` job runs
[`backend/scripts/check-migration-safety.sh`](scripts/check-migration-safety.sh)
against the PR's base commit (or, on a push to `main`, the commit before the
push). It is a speed bump, not a proof — it reads the `.sql` text and never
runs it, so it catches the accident, not the deliberate choice:

- Any migration file this PR **adds** whose `-- Up Migration` section
  contains `DROP COLUMN`, `DROP TABLE`, `RENAME`, `ALTER COLUMN ... TYPE`, or
  `SET NOT NULL` must carry a `-- contract: <why this is safe now>` line
  somewhere in the file, or the job fails. Add the line once you've checked
  it against the rule above — usually because the column or table being
  dropped/renamed was never read by the release currently in prod.
- Any PR that **modifies, deletes or renames** a migration file that already existed
  on the base commit fails, full stop. There's no contract line that makes
  editing an applied migration safe; open a new one instead.

Matching is case-insensitive and ignores `--`/`/* */` comments, so a comment
that explains why a migration _doesn't_ do one of these things won't trip the
guard, and a commented-out example won't either.

The guard has its own regression cases,
[`backend/scripts/test-check-migration-safety.sh`](scripts/test-check-migration-safety.sh),
which the `migrations` job runs first. It builds a throwaway git repo in a
temp dir, so it's safe to run locally too: `bash scripts/test-check-migration-safety.sh`
from `backend/`. Add a case there whenever you change the guard.

## Stronger, optional: a backward-compat job

The real claim behind expand/contract — "the previous release's code still
works against the new schema" — is currently a rule, not a test. A
`backward-compat` job would migrate a fresh database with the PR's
migrations, then run `main`'s integration suite against it, so the claim
gets checked mechanically instead of relying on review to catch a violation.

Investigated for 7.6: the worry was that `main`'s
`tests/integration/globalSetup.mjs` calls `node-pg-migrate up`, and would see
migrations already applied that it has no local file for (the PR's newest
one). It doesn't refuse. `node-pg-migrate`'s `checkOrder` only compares the
two migration lists up to the shorter list's length
(`node_modules/node-pg-migrate/dist/bundle/index.js`, `checkOrder` and the
`up()` call site around line 3578), and `getRunMigrations` orders already-run
migrations by `run_on, id` — application order, which matches filename order
for a normal `up`. Because new migrations always sort after the ones `main`
already knows about, the extra one falls past the compared prefix rather
than inside it, so `checkOrder` passes and `up()` logs "No migrations to
run!" and returns cleanly. The suite then runs against the PR's schema as-is
— which is exactly the condition a `backward-compat` job would want, no
`checkOrder: false` needed. Not built in 7.6; left for whoever picks up the
optional job.
