#!/usr/bin/env bash
#
# smoke.sh <url> <sha>
#
# Three checks against the *public* Function URL - D3's "shift, then
# smoke-test the public URL" - each answering a specific question, and
# nothing more (the roadmap asks "why not more?", so the "not included"
# comments below are the answer, not an afterthought):
#
#   - not /api/ready: it duplicates /api/products's DB check with less
#     signal (CLAUDE.md: /api/ready pings the database and nothing else).
#   - not checkout: it creates real Stripe objects on every single deploy,
#     dev and prod both, for a check that isn't testing anything the other
#     three don't already cover end to end (the DB write path is exercised
#     by every real order, not by a smoke test).
#
# Budget: ~4s per request (clamped to whatever is left of the total), a
# couple of retries, but a hard 15s total. The
# first request after a shift is a cold start (p50 ~1.16s, max 1.54s seen in
# 6.9), so a single try with a short timeout would flake - and a flaky smoke
# test is a random rollback (deploy.sh's whole reason to call this script).
set -euo pipefail

URL="${1:?usage: smoke.sh <url> <sha>}"
SHA="${2:?usage: smoke.sh <url> <sha>}"
URL="${URL%/}" # tolerate a trailing slash from get-function-url-config

PER_REQUEST_TIMEOUT=4
TOTAL_BUDGET=15
MAX_ATTEMPTS=4

TMP_BODY="$(mktemp)"
TMP_ERR="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_ERR"' EXIT

# Bash's SECONDS counts elapsed wall-clock seconds since the shell started
# and this script never resets it, so it doubles as the whole script's
# stopwatch - no date-arithmetic needed, and it works the same on the
# GNU date (Linux runners) and BSD date (a human running this on a Mac).
get_with_retries() {
  local path="$1" attempt=0 status elapsed t0 timeout
  while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    if [ "$SECONDS" -ge "$TOTAL_BUDGET" ]; then
      echo "  ${path}: out of the ${TOTAL_BUDGET}s total budget (after attempt $((attempt - 1)))" >&2
      return 1
    fi
    # The budget is hard, not "checked between attempts": an attempt that
    # starts at 14s gets 1s, not the full 4s, so the whole script can never
    # run past TOTAL_BUDGET by up to a request's worth.
    timeout=$((TOTAL_BUDGET - SECONDS))
    if [ "$timeout" -gt "$PER_REQUEST_TIMEOUT" ]; then
      timeout=$PER_REQUEST_TIMEOUT
    fi
    t0=$SECONDS
    if status="$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -m "$timeout" "${URL}${path}" 2>"$TMP_ERR")"; then
      elapsed=$((SECONDS - t0))
      echo "  ${path} -> ${status} in ${elapsed}s (attempt ${attempt}/${MAX_ATTEMPTS})" >&2
      if [ "$status" = "200" ]; then
        return 0
      fi
    else
      elapsed=$((SECONDS - t0))
      echo "  ${path} -> curl error in ${elapsed}s (attempt ${attempt}/${MAX_ATTEMPTS}): $(cat "$TMP_ERR")" >&2
    fi
  done
  return 1
}

echo "==> Smoke testing ${URL} (expecting sha ${SHA}), total budget ${TOTAL_BUDGET}s"

# 1. Liveness. Never touches the database (CLAUDE.md) - this just proves the
#    adapter came up and the process isn't crash-looping.
if ! get_with_retries "/api/status"; then
  echo "::error::smoke: GET /api/status never returned 200 within budget" >&2
  exit 1
fi

# 2. The alias-moved check. A stale version can also answer /api/status 200,
#    so this is the only request that proves traffic reached THIS sha, not
#    some earlier one still warm on the same alias.
if ! get_with_retries "/api/version"; then
  echo "::error::smoke: GET /api/version never returned 200 within budget" >&2
  exit 1
fi
ACTUAL_SHA="$(jq -r '.sha // empty' "$TMP_BODY" 2>/dev/null || true)"
if [ "$ACTUAL_SHA" != "$SHA" ]; then
  echo "::error::smoke: /api/version returned sha=${ACTUAL_SHA:-<unparseable>}, expected ${SHA}" >&2
  exit 1
fi

# 3. The one DB-backed check. GET /api/products responds with a bare JSON
#    array (productController.js: res.status(200).json(products)) - fixtures
#    in backend/tests/fixtures/apiShapes.js pin that shape.
if ! get_with_retries "/api/products"; then
  echo "::error::smoke: GET /api/products never returned 200 within budget" >&2
  exit 1
fi
ITEM_COUNT="$(jq 'length' "$TMP_BODY" 2>/dev/null || echo 0)"
if ! [ "$ITEM_COUNT" -ge 1 ] 2>/dev/null; then
  echo "::error::smoke: /api/products returned ${ITEM_COUNT:-<unparseable>} items, expected >= 1" >&2
  exit 1
fi

echo "==> Smoke OK in ${SECONDS}s total: /api/status 200, /api/version ${ACTUAL_SHA}, /api/products ${ITEM_COUNT} item(s)"
