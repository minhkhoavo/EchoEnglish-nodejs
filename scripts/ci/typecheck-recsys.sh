#!/usr/bin/env bash
# Fails if `tsc --noEmit` reports any error in new recommendation code, its tests or ops scripts.
# (Repo-wide there are pre-existing errors in src/controllers/*; they are tracked separately.)
# Three passes: root tsconfig (src/), __tests__/tsconfig.json (tests), scripts/ci/tsconfig.scripts.json (ops scripts).
set -uo pipefail
out_src="$(npx tsc --noEmit 2>&1)"
out_tests="$(npx tsc --noEmit -p __tests__/tsconfig.json 2>&1)"
out_scripts="$(npx tsc --noEmit -p scripts/ci/tsconfig.scripts.json 2>&1)"
pattern='^(src/recsys|__tests__|scripts)/.*error TS'
bad="$(printf '%s\n%s\n%s\n' "$out_src" "$out_tests" "$out_scripts" | grep -E "$pattern" | sort -u || true)"
total="$(printf '%s\n' "$out_src" | grep -c 'error TS' || true)"
echo "repo-wide tsc errors (pre-existing, informational): ${total}"
if [ -n "$bad" ]; then
  echo "Type errors in new code:"
  printf '%s\n' "$bad"
  exit 1
fi
echo "No type errors in src/recsys, __tests__ or scripts."
