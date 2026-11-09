#!/usr/bin/env bash
# Fails if `tsc --noEmit` reports any error in new recommendation code or its tests.
# (Repo-wide there are pre-existing errors in src/controllers/*; they are tracked separately.)
set -uo pipefail
out="$(npx tsc --noEmit 2>&1)"
bad="$(printf '%s\n' "$out" | grep -E '^(src/recsys|__tests__|scripts)/.*error TS' || true)"
total="$(printf '%s\n' "$out" | grep -c 'error TS' || true)"
echo "repo-wide tsc errors (pre-existing, informational): ${total}"
if [ -n "$bad" ]; then
  echo "Type errors in new code:"
  printf '%s\n' "$bad"
  exit 1
fi
echo "No type errors in src/recsys, __tests__ or scripts."
