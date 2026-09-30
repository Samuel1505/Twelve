#!/usr/bin/env bash
# Invariant I1: no bare USDC scale literals outside the single conversion module per language.
# Flags 1e6/1e12/1e18, 10**6/12/18 (incl. TS bigint 10n ** 12n), 1000000/1e12/1e18 spelled out or with _ separators.
# Allowed: the three conversion modules, corpus/ (planted bugs by design), docs/, tests/fixtures.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='(\b1e(6|12|18)n?\b|\b10n?[[:space:]]*\*\*[[:space:]]*(6|12|18)n?\b|\b10{6}(0{6}){0,2}n?\b|\b1_000_000(_000_000){0,2}n?\b|\b1_000_000_000_000(_000_000)?n?\b)'

ALLOW=(
  "contracts/src/guard/Usdc.sol"
  "packages/shared/src/units.ts"
  "analyzer/twelve/units.py"
)

args=(-rnIE "$PATTERN"
  --include='*.sol' --include='*.ts' --include='*.tsx' --include='*.py' --include='*.js' --include='*.mjs'
  --exclude-dir=node_modules --exclude-dir=lib --exclude-dir=out --exclude-dir=cache
  --exclude-dir=.venv --exclude-dir=.next --exclude-dir=dist --exclude-dir=fixtures
  --exclude-dir=corpus --exclude-dir=docs)

hits=$(grep "${args[@]}" . 2>/dev/null || true)
for f in "${ALLOW[@]}"; do
  hits=$(printf '%s\n' "$hits" | grep -v "^\./$f:" || true)
done
hits=$(printf '%s\n' "$hits" | sed '/^$/d')

if [[ -n "$hits" ]]; then
  echo "lint-units: bare USDC scale literal found (I1). Use the conversion module for your language:" >&2
  printf '%s\n' "$hits" >&2
  exit 1
fi
echo "lint-units: OK"
