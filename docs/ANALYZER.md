# ANALYZER.md — Decimal-unit dataflow over SlithIR

The analyzer is Twelve's credibility. Everything else is plumbing around it. It must be **precise** (no false HIGHs), **deterministic** (I4), and **explainable** (every finding carries the full unit trace from source to collision).

---

## 1. Model: every value carries a unit

A USDC quantity is not just a number; it is a number in a **view**. We model this as dimensional analysis:

```
Unit = (dim: int, exp: int)   # plus special lattice elements
```

- `dim` — power of the USDC-amount dimension. `1` = an amount; `0` = dimensionless (counts, bps, ratios, scale factors); `2` = amount², `-1` = per-amount, etc.
- `exp` — decimal exponent of the raw integer's representation.
  - native amount: `(1, 18)`; ERC-20 amount: `(1, 6)`
  - the literal `10**12`: `(0, 12)` — a dimensionless **scale**
  - a plain literal like `2`, `10_000` (bps), gas counts: `(0, 0)`

This single representation makes conversion arithmetic fall out naturally:

| Expression | Result |
|---|---|
| `a6 * 1e12` | `(1,6) ⊗ (0,12) = (1,18)` ✓ correct conversion |
| `a18 / 1e12` | `(1,18) ⊘ (0,12) = (1,6)` ✓ |
| `a18 * bps / 1e4` | `(1,18)⊗(0,0)⊘(0,4) = (1,14)` — see §5.3 "exp drift" |
| `a18 + a6` | **collision** Δexp = 12 → finding |
| `a6 * price8 / 1e8` | dims add: price feeds are `(0,8)` by convention unless bound; result `(1,6)` |

`⊗`: `(d1+d2, e1+e2)`. `⊘`: `(d1-d2, e1-e2)`. `+ - == < <= > >= != min max` and **assignment-merge** require equal units when both operands have `dim ≠ 0`.

### 1.1 Lattice

```
            Unknown (⊤)          # "we don't know" — never produces a finding
          /   |    |    \
   (1,18) (1,6) (0,0) (0,k) ...  # concrete units
          \   |    |    /
             Bottom (⊥)          # "not yet computed"
```

- `join(⊥, u) = u`; `join(u, u) = u`; `join(u, v≠u) = Unknown` **and** a merge event is recorded (may become rule TW-005).
- `Unknown` absorbs: `Unknown ⊗ x = Unknown`. This is **cascade suppression** (§6): after the root collision, downstream values don't generate secondary findings.
- Each lattice value carries a **provenance** (list of `TraceStep`) — kept as the shortest trace by (length, then source order) so output is deterministic.

### 1.2 Provenance / confidence
Each concrete unit carries `confidence ∈ {DEFINITE, INFERRED, HEURISTIC}`:
- DEFINITE — derived only from language sources (`msg.value`, `.balance`) or a **resolved** `0x3600…` binding.
- INFERRED — passed through a storage join, an interprocedural summary, or a return value of an internal call.
- HEURISTIC — derived from literal magnitude (§4.3) or `ether` unit literals.

Finding confidence = min of operand confidences. Severity table in §5.

---

## 2. Sources (where units are born)

| SlithIR shape | Unit | Conf. |
|---|---|---|
| `SolidityVariableComposed('msg.value')` | (1,18) | DEFINITE |
| `SolidityFunction('balance(address)')` / `address(x).balance` / `this.balance` | (1,18) | DEFINITE |
| `tx.gasprice`, `block.basefee` | (1,18) per gas — model as (1,18); gas counts are (0,0) | DEFINITE |
| `HighLevelCall` on a value bound to `0x3600…`: `balanceOf`, `allowance`, `totalSupply` return | (1,6) | DEFINITE |
| Same, `decimals()` return | constant value `6` → makes `10**decimals()` evaluate to `(0,6)` | DEFINITE |
| Literal with `ether` / `gwei` / `wei` suffix | (1,18)/(1,9)/(1,0) — on Arc these *are* native USDC units | HEURISTIC |
| Literal `10**k` / `1ek` in multiplicative position | (0,k) | DEFINITE |
| Literal `10**k` in additive/comparison position against an amount | see §4.3 | HEURISTIC |
| Any other literal | (0,0) | DEFINITE |
| Function parameters of public/external functions | `⊥` then set from **annotations** (§3.3) or left `Unknown` | — |
| Return of external call to unbound contract | `Unknown` | — |

## 3. Bindings — which variables are the USDC ERC-20?

Rules only fire on `0x3600…` calls whose receiver is **resolved**. A receiver can be:

### 3.1 Constant / immutable literal in source
`IERC20 constant USDC = IERC20(0x3600…)` or `immutable` assigned a literal in the constructor → resolved statically. DEFINITE.

### 3.2 Deployed target: read the chain
For post-deploy scans:
- **Immutables**: compile from verified standard-JSON → `evm.deployedBytecode.immutableReferences` gives `{astId: [{start, length}]}`. Read those byte ranges from on-chain runtime code; decode 32-byte word → address. Map `astId` to the Slither variable. DEFINITE.
- **Storage vars** of address/interface type: use Slither's storage layout (slot, offset) for each state var; `eth_getStorageAt` at the scanned block; decode. DEFINITE for that block (report records `bindingBlock`). Note: a mutable binding can change later — report marks it `mutable: true`; the monitor does not re-scan automatically in v1.
- **Constructor args** (from Blockscout) used only as a cross-check.

### 3.3 Pre-deploy (CI) mode
No chain state. Resolution via, in priority order:
1. `twelve.toml`: `[bindings] "src/Vault.sol:Vault.usdc" = "USDC_ERC20"`
2. NatSpec: `/// @custom:twelve usdc` on the variable.
3. Name heuristic: interface-typed state var named `usdc|USDC|_usdc` → resolved at **HEURISTIC** confidence.
Parameter annotations for entry points: `/// @custom:twelve-unit amount usdc6` (or `usdc18`) on a function sets the param's unit to DEFINITE.

### 3.4 Unresolved token variables
An `IERC20 token` we can't resolve: its amounts get unit `Token(varId)`, a distinct dimension. Colliding `Token(x)` with `(1,18)` produces **TW-900 INFO** ("if `token` is USDC on Arc, this is a 10¹² bug") — never higher.

---

## 4. Transfer functions over SlithIR

Operate on **SSA** IR (`function.slithir_ssa_operations`) so each variable version has one definition. `VERIFY:` exact attribute names in the pinned Slither version — read the installed `slither/slithir/operations/*.py` before coding; do not code from memory.

| IR op | Rule |
|---|---|
| `Assignment lv = rv` | `U(lv) = U(rv)` |
| `Binary(ADDITION|SUBTRACTION)` | check-equal (collision → finding site), result = common unit |
| `Binary(MULTIPLICATION)` | `⊗` |
| `Binary(DIVISION)` | `⊘` |
| `Binary(MODULO)` | unit of left |
| `Binary(POWER)` with const base 10 and const/resolvable exponent k | `(0,k)` |
| `Binary(LESS|GREATER|...|EQUAL|NOT_EQUAL)` | check-equal, result `(0,0)` |
| `TypeConversion` (uint casts) | preserve unit; **address casts** of `0x3600…` literal create a binding |
| `Phi` | join over incoming versions (recording merge events) |
| `Index/Member` on mappings/structs | read the **state cell** (§4.2) |
| `InternalCall` | apply callee summary (§4.1) |
| `HighLevelCall` on bound USDC | source/sink per §2 and §5 |
| `LowLevelCall` with `call_value` | sink `(1,18)` for the value |
| `Transfer` / `Send` | sink `(1,18)` |
| `Return` | contributes to function summary |
| `Unpack` / tuples | per-element |
| library calls to known math libs (`Math.mulDiv(a,b,c)`) | model as `a⊗b⊘c`; add others to `sources_sinks.py` table |
| inline assembly touching a tracked value | value → `Unknown`, function flagged `UNSUPPORTED_ASM` in report meta |

### 4.1 Interprocedural
- Summaries are **context-sensitive on argument units**: key `(function, tuple(argUnits))` → `(returnUnits, stateEffects, findings)`. Memoized. Depth cap 8; beyond → `Unknown`.
- Findings inside a callee are attributed to the callee's source span but carry the caller chain in the trace.
- Modifiers are inlined by Slither; treat as part of the function.
- Recursion: fixpoint over the SCC with a bounded iteration count (≤ 10); non-convergence → `Unknown`.

### 4.2 State (storage) cells
Each state variable (and for mappings/arrays: the **value slot type**, one cell per variable, not per key) has a global cell. Whole-contract fixpoint:

```
repeat:
  for f in sorted(all functions incl. inherited, by canonical name):
     analyze f with current cells; collect writes
  cells' = join(cells, writes)
until cells' == cells  (cap 20 iterations → remaining changed cells := Unknown)
```

A cell that receives two different concrete units is exactly the "credit native, debit ERC-20" pattern → **TW-005**, reported at the **second-in-source-order write site**, with both writers in the trace.

### 4.3 Literal magnitude heuristic
`require(msg.value >= 1e6)` — `1e6` alone is ambiguous: scale or "1 USDC in 6-dec"? In an **additive/comparison** position against an amount of exp `e`, a power-of-ten literal `10^k` is treated as an amount `(1,k)`:
- if `|e - k| == 12` → **TW-006** (HEURISTIC): "threshold magnitude matches the other view".
- otherwise → no finding (it's a plausible threshold).
Literals that aren't powers of ten are never interpreted as amounts.

---

## 5. Rules

| ID | Name | Fires when | Default severity |
|---|---|---|---|
| TW-001 | MIXED_ARITH | `+`/`-` between `(1,18)` and `(1,6)` | HIGH |
| TW-002 | MIXED_COMPARE | comparison / `min`/`max` between the views | HIGH |
| TW-003 | NATIVE_SINK_6 | value with `(1,6)` reaches `call{value}`/`transfer`/`send` | HIGH (underpay) |
| TW-004 | ERC20_SINK_18 | value with `(1,18)` reaches `USDC.transfer/transferFrom/approve` amount | HIGH (overpay) |
| TW-005 | STORAGE_UNIT_MERGE | a state cell written with both views | HIGH if both writers DEFINITE, else MEDIUM |
| TW-006 | LITERAL_OTHER_VIEW | §4.3 | MEDIUM |
| TW-007 | DUST_TRUNCATION | `(1,18) ⊘ (0,12)` result sent via ERC-20 while remainder is not accounted | INFO |
| TW-008 | EXP_DRIFT | an amount with `dim=1` and `exp ∉ {6,18}` reaches a sink or a comparison with a view | LOW (often fee math with a missing divisor) |
| TW-900 | UNRESOLVED_TOKEN_MIX | §3.4 | INFO |

Severity is then capped by confidence: HEURISTIC ⇒ max MEDIUM; INFERRED ⇒ unchanged except TW-005 as noted.

### 5.1 What does **not** fire (hard negatives, all in the corpus)
- `a6 * 1e12 + msg.value` — correct.
- Token-agnostic vaults with unresolved token and no native flow.
- 8-decimal oracle math producing a correctly scaled `(1,6)`.
- `gasleft() * tx.gasprice` compared with `msg.value` — both `(1,18)`.
- UDVT-typed code using `contracts/src/guard/Usdc.sol` — the types are trusted sources: `Usdc6.unwrap` → `(1,6)` DEFINITE, `Usdc18.unwrap` → `(1,18)` DEFINITE.

### 5.2 Every finding must carry
```json
{
  "id": "keccak(rule|contract|fnSig|normalizedSpan)",
  "rule": "TW-004", "severity": "HIGH", "confidence": "DEFINITE",
  "contract": "LeakyRefund", "function": "payAndRefund(uint256)",
  "location": {"file": "src/LeakyRefund.sol", "startLine": 41, "endLine": 41, "startCol": 9, "endCol": 58},
  "left":  {"unit": [1,18], "expr": "msg.value"},
  "right": {"unit": [1,6],  "expr": "USDC.balanceOf(address(this))"},
  "trace": [ {"step": "source", "expr": "msg.value", "unit": [1,18], "loc": "...:30"},
             {"step": "store",  "expr": "credits[msg.sender]", "loc": "...:31"},
             {"step": "load",   "expr": "credits[user]", "loc": "...:40"},
             {"step": "sink",   "expr": "USDC.transfer(user, amt)", "expects": [1,6], "loc": "...:41"} ],
  "message": "Native amount (18 decimals) flows into USDC ERC-20 transfer (6 decimals): pays 10^12× the intended amount.",
  "fix": "Convert with Usdc.toErc20(...) or store credits as Usdc6."
}
```
`message` and `fix` are **templated strings** keyed by rule + direction. No free text generation.

### 5.3 Exp drift nuance
`fee = msg.value * bps / 10_000` is `(1,18)⊗(0,0)⊘(0,4)`. `10_000` is **not** a power-of-ten scale semantically — it's a bps denominator. Rule: a power-of-ten literal is a **scale** only if `k ∈ {6, 12, 18}` or it's `10**decimals()`; otherwise `(0,0)`. This keeps `bps/1e4` math at `(1,18)`. Encode this table in `units.py`; it is load-bearing for precision.

---

## 6. Cascade suppression & dedupe

1. At a collision, record the finding, then set the result to `Unknown`.
2. Findings are keyed by `id` (stable hash); duplicates across contexts merge their traces (keep shortest).
3. If a state cell becomes `Unknown` because of TW-005, reads from it do not produce TW-001..004. One root cause ⇒ one finding.
4. Inherited functions are analyzed once per **most-derived** contract that is the scan target; findings in shared base contracts are attributed to the base's file/line.

---

## 7. Report format (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "tool": {"name": "twelve", "version": "0.1.0", "gitCommit": "…", "slither": "x.y.z", "rulesHash": "…"},
  "target": {"chainId": 5042, "address": "0x…", "codehash": "0x…", "kind": "contract|eip1967Proxy|beaconProxy",
             "implementation": {"address": "0x…", "codehash": "0x…"} },
  "input": {"standardJsonHash": "0x…", "compiler": "0.8.x+commit.…", "evmVersion": "…", "optimizer": {"enabled": true, "runs": 200},
            "bytecodeMatch": {"status": "exact|masked", "maskedRanges": [[…]]}, "bindingBlock": 123},
  "bindings": [{"var": "Vault.usdc", "value": "0x3600…", "method": "immutable|storage|constant|config|nameHeuristic", "mutable": false}],
  "findings": [ … sorted by (severity desc, file, startLine, rule, id) … ],
  "coverage": {"functionsAnalyzed": 42, "unsupported": [{"function": "…", "reason": "UNSUPPORTED_ASM"}]},
  "verdict": "CLEAN|FINDINGS|INCOMPLETE"
}
```
Verdict:
- `FINDINGS` if any HIGH or MEDIUM.
- `INCOMPLETE` if no HIGH/MEDIUM but any value-path function is unsupported, or USDC usage exists with unresolved bindings.
- `CLEAN` otherwise. LOW/INFO do not block CLEAN.

`reportCore` = the object above. `meta` (not hashed) = `{scannedAt, durationMs, host}`.
Canonicalization: RFC 8785 JCS (`rfc8785` package). All hex lowercase, `0x`-prefixed. Units serialized as `[dim, exp]`.

---

## 8. Fetch, rebuild, match (`twelve/fetch/`)

1. **Fetch** `GET https://api.blockscout.com/5042/api/v2/smart-contracts/{address}` (Pro key). `VERIFY:` field names in live response (Phase 0).
2. **Rebuild** solc standard-JSON: sources (main + additional), `settings.optimizer`, `evmVersion`, `remappings`, `libraries`, `viaIR`. Hash it: `standardJsonHash = keccak(JCS(input))`.
3. **Compile** with the exact compiler build (svm). Slither gets the same standard-JSON (`--solc-standard-json` equivalent / crytic-compile `solc_standard_json`) so the IR matches the compiled artifact.
4. **Match** runtime code:
   - zero `immutableReferences` ranges in both,
   - strip trailing CBOR metadata (last 2 bytes = length),
   - resolve `linkReferences` with on-chain library addresses,
   - compare. Exact → `exact`; equal after masking → `masked`; else `MATCH_FAILED` with first differing offset.
5. For proxies, repeat for the implementation; the report carries both codehashes.

## 9. CLI

```
twelve scan <path|--standard-json file> [--config twelve.toml] [--json]
twelve scan --address 0x… --chain arc [--block N]          # full fetch→match→bind→analyze
twelve verify --address 0x… [--attester 0x…]                # recompute; compare to on-chain reportHash
twelve explain <findingId> --report report.json             # human trace rendering
twelve rules                                                # list rules, severities, docs links
```
Exit codes: `0` CLEAN, `1` FINDINGS, `2` INCOMPLETE, `3` error. CI uses `--fail-on HIGH`.

## 10. Performance budget
Median scan (fetch → report) under 30 s for a < 2k-SLOC contract on the deployment box. Summary memoization and SSA make this realistic; if a contract blows the budget, time-box the fixpoint and return `INCOMPLETE` rather than hang.
