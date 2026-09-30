# CORPUS_AND_TESTING.md

Credibility is a number. The corpus produces it; the mainnet sweep proves it on real code.

## 1. Corpus layout

```
corpus/
  c01_ltv_compare/
    bug.sol          # contains exactly the planted defect(s)
    safe.sol         # minimal diff that fixes it (the "safe twin")
    expect.json      # expected findings for bug.sol; safe.sol must yield none ≥ LOW
    twelve.toml      # bindings if needed (pre-deploy mode)
  …
```

`expect.json`:
```json
{ "findings": [ { "rule": "TW-002", "severity": "HIGH", "function": "borrow(uint256)", "line": 27 } ],
  "verdict": "FINDINGS", "safeVerdict": "CLEAN" }
```
Matching: rule + function + line (±0). Extra findings on `bug.sol` count as FP unless listed in `expect.json.allowedExtra` with a justification.

## 2. Required cases (v1)

| # | Name | Pattern | Rule |
|---|---|---|---|
| c01 | ltv_compare | `require(collateral18 * ltv >= USDC.balanceOf(...))` | TW-002 |
| c02 | native_in_erc20_out | credit `msg.value`, pay via `USDC.transfer` | TW-005 / TW-004 |
| c03 | erc20_in_native_refund | `transferFrom(a6)` then `call{value:a6}` (LeakyRefund) | TW-003 |
| c04 | price6_msgvalue | `require(msg.value >= price6)` with `price6` storage set from ERC-20 amounts | TW-002 |
| c05 | storage_merge | two functions write `balances[u]` in different views | TW-005 |
| c06 | literal_threshold | `require(msg.value >= 1e6)` | TW-006 |
| c07 | self_balance_to_erc20 | `USDC.transfer(owner, address(this).balance)` | TW-004 |
| c08 | interprocedural | helper returns `balanceOf`, caller adds `msg.value` | TW-001 |
| c09 | immutable_binding | USDC set in constructor → immutable | TW-004 (binding via immutable) |
| c10 | storage_binding | USDC set via `setToken()` | TW-004 (binding via storage, deployed mode only) |
| c11 | proxy_impl | EIP-1967 proxy → buggy implementation | TW-003 on impl |
| c12 | fee_on_msgvalue | `fee = msg.value*bps/1e4; USDC.transfer(tre, fee)` | TW-004 (bps stays (0,0), §5.3) |
| c13 | gas_refund | `gasleft()*tx.gasprice` refunded via ERC-20 | TW-004 |
| c14 | dust_truncation | `msg.value / 1e12` sent via ERC-20, remainder ignored | TW-007 |
| c15 | udvt_safe | fully typed with `Usdc.sol` | none |
| c16 | backward_param_dominated | param reaches `transferFrom` first, then native sink | TW-003 |
| c17 | backward_param_not_dominated | sinks on different branches | none (documents conservatism) |
| c18 | mulDiv | OZ `Math.mulDiv(msg.value, x, 1e12)` correct conversion | none |
| c19 | unresolved_token | generic `IERC20 token` vs `msg.value` | TW-900 INFO only |
| c20 | modifier_check | `require` in a modifier comparing views | TW-002 |
| c21 | wrong_direction | `USDC.transfer(to, msg.value * 1e12)` (exp 30) | TW-008 |

Hard negatives (safe-only cases, must be CLEAN): `h01` OZ ERC4626 vault over unresolved asset; `h02` Chainlink 8-dec oracle math to `(1,6)`; `h03` ETH-style escrow with only native flows; `h04` correct `a6 * 1e12 + msg.value`; `h05` bps fee math on native only; `h06` Uniswap-v2-style math on ERC-20 only; `h07` WAD (`/1e18`) and ppm (`/1e6`) fee math on both views (ADR-019).

Conventions (Phase 1): expected findings are marked in `bug.sol` with `// @expect TW-xxx SEVERITY function(sig)` on the finding's line; `python -m twelve.metrics corpus --write-expect` regenerates `expect.json` from the markers. Cases whose expectation is "none" (c15, c17, c18) have only `bug.sol` with an empty `findings` list. c09–c11 bind USDC only on chain (immutable constructor arg, storage setter, EIP-1967 proxy); their `expect.json` carries a `deployed` block with Arc testnet addresses (deployed + verified by `contracts/script/DeployCorpusDeployed.s.sol`). Source-mode metrics list them as skipped; `python -m twelve.metrics corpus --deployed` scans the addresses and writes `METRICS.deployed.md`.

Add a case **every time** a bug in the analyzer is found (regression first, fix second).

## 3. Metrics (`uv run python -m twelve.metrics corpus/`)
Per rule and overall:
- **Recall** = matched expected / total expected (HIGH must be 100%)
- **Precision** = matched / all emitted on bug files
- **Safe-twin FP** = findings ≥ LOW on safe files + hard negatives (HIGH must be 0)
Output markdown table → committed to `corpus/METRICS.md` and rendered on `/corpus`. CI fails on regression vs `corpus/METRICS.baseline.json`.

## 4. Analyzer unit tests
- `test_lattice.py`: join/⊗/⊘ algebra, property-based (Hypothesis): associativity/commutativity of join, `⊘` inverse of `⊗`, Unknown absorption.
- `test_units.py`: power-of-ten scale table (§5.3), `ether` suffix handling.
- `test_report.py`: JCS golden files; same input twice ⇒ identical bytes; shuffled dict order ⇒ identical hash.
- `test_match.py`: bytecode masking fixtures (immutables, CBOR, linked libs).
- `test_bindings.py`: immutable decode from `immutableReferences`; storage slot decode incl. packed slots.

## 5. Contracts tests
Local (`contracts/test`, mocked `0x3600…` via a MockUSDC with 6 decimals + `vm.deal` for native — **labeled mocked**): registry full suite (REGISTRY §7), guard fuzz, gate behavior.
Arc testnet (`contracts/test-arc`): real `0x3600…` semantics — LeakyRefund refund arrives as dust; FixedRefund exact; OverpayVault guarded revert; registry end-to-end with a real attestation. See `VERIFY` on fork vs broadcast in CLAUDE.md §5.

## 6. Mainnet sweep (the credibility multiplier)
`scripts/mainnet-sweep.ts`:
1. Enumerate verified contracts on Arc mainnet via Blockscout Pro API (paginate).
2. Scan each (dedupe by codehash). Record verdict distribution, rule counts, scan failures by reason.
3. Manually triage every HIGH/MEDIUM: label TP / FP / needs-disclosure in `sweep/triage.csv`.
4. Publish aggregate stats only (counts, precision on triaged set) on `/sweep`. **Never** publish a third-party address with an open TP until disclosure is resolved.
Rerun periodically; the page shows the sweep date and tool version.

## 7. Responsible disclosure
For a TP in a third-party contract:
1. Build a Foundry reproduction (on testnet, never touching the target's funds).
2. Contact the deployer (verified-source metadata, project site, security.txt, X/GitHub). Also Arc security contact if the owner is unreachable.
3. Wait for fix or a reasonable window; only then reference it publicly, with permission if possible.
4. Never attest `FINDINGS` publicly for an undisclosed TP during the window — keep the scan private (`private: true` in DB, excluded from registry writes).
Log each disclosure in `sweep/disclosures.md` (no addresses until public).

## 8. CI (GitHub Actions)
- `lint-units` → `ruff`/`mypy` → `pytest` → corpus metrics gate → `forge build/test` → compile-fail test → `pnpm typecheck/test`.
- Nightly: `test-arc` against testnet (needs funded testnet key in secrets).
- Twelve scans itself: `twelve scan contracts/src --fail-on MEDIUM` (dogfooding; the demo contracts are excluded by path with a comment explaining why).
