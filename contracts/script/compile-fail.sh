#!/usr/bin/env bash
# docs/GUARD.md §1: mixing the two USDC views must be a compile error. Asserts that solc REJECTS
# fixtures/compile-fail/Mix.sol (Usdc6 + Usdc18) with the user-defined-operator type error, and that the guard itself
# still compiles. Exit 0 = the guarantee holds.
set -uo pipefail
cd "$(dirname "$0")/.."

out=$(forge build fixtures/compile-fail/Mix.sol 2>&1)
status=$?
if [[ $status -eq 0 ]]; then
  echo "compile-fail: Mix.sol COMPILED — Usdc6 + Usdc18 must be a type error" >&2
  exit 1
fi
if ! grep -q "Error (5653)" <<<"$out" || ! grep -q "which is Usdc6" <<<"$out"; then
  echo "compile-fail: Mix.sol failed for the wrong reason:" >&2
  echo "$out" >&2
  exit 1
fi
echo "compile-fail: OK — $(grep -o 'Error (5653):.*' <<<"$out" | head -1)"
