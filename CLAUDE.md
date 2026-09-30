# CLAUDE.md — Twelve

> Arc's decimal-safety layer: catch the 10¹² bug before deploy, flag it live after.

You are the primary engineer on Twelve. This file is the contract between you and the repo. Read it fully at the start of every session. It is deliberately dense; every line exists because getting it wrong costs a rebuild.

---

## 1. What Twelve is (one paragraph, memorize it)

On Arc, USDC is **one balance with two views**: the **native** view (18 decimals — `msg.value`, `address.balance`, `call{value:}`, `eth_getBalance`, gas) and the **ERC-20** view (6 decimals — `balanceOf/transfer/transferFrom/approve` on `0x3600000000000000000000000000000000000000`). Raw integers in the two views differ by exactly 10¹². Code ported from other EVM chains mixes them and misprices by a factor of a trillion: overpay (drain) or underpay (dust). Arc's own docs warn against mixing `msg.value` with `USDC.balanceOf()` in pool/LTV math. Twelve is four layers against that single class of bug:

1. **Analyzer** (`analyzer/`, Python, Slither) — decimal-unit dataflow analysis over SlithIR. Pre-deploy (CI) and post-deploy (verified mainnet contracts).
2. **Registry** (`contracts/src/TwelveRegistry.sol`) — on-chain attestations bound to `extcodehash`, queryable by any contract.
3. **Monitor** (`apps/monitor/`, TypeScript) — reads Arc's EIP-7708 native Transfer logs across mainnet, flags 10¹² signatures and drains in real time, auto-revokes attestations on proxy upgrades.
4. **Guard** (`contracts/src/guard/`) — Solidity `Usdc6`/`Usdc18` user-defined value types with operators, making unit mixing a **compile error**, plus a checked native payout helper.

The problem only exists because of Arc's ledger design. If a feature you are about to build would work identically on Base, stop — it is out of scope.

---

## 2. Document map — read the relevant doc BEFORE touching an area

| You are about to touch | Read first |
|---|---|
| Anything involving USDC amounts, logs, gas, chain params | `docs/ARC_LEDGER.md` |
| System boundaries, data flow, services, deploy topology | `docs/ARCHITECTURE.md` |
| `analyzer/` | `docs/ANALYZER.md` |
| `contracts/src/TwelveRegistry.sol`, attester, scan pipeline | `docs/REGISTRY.md` |
| `apps/monitor/` | `docs/MONITOR.md` |
| `contracts/src/guard/`, `TwelveGate`, demo contracts | `docs/GUARD.md` |
| `corpus/`, any test, any metric | `docs/CORPUS_AND_TESTING.md` |
| Changing a design choice | `docs/DECISIONS.md` (add an ADR; never silently diverge) |
| Deciding what to build next | `docs/BUILD_PLAN.md` |
| Demo contracts, web UX priorities | `DEMO_SCRIPT.md` |
| Submission copy | `docs/SUBMISSION.md` |

If a doc and the code disagree, the doc is the spec **unless** the doc contains a `VERIFY:` marker you have since resolved against a primary source — then update the doc in the same commit.

---

## 3. Non-negotiable invariants

Violating any of these is a bug even if tests pass.

**Units**
- I1. Never write a bare `1e12`, `10**12`, `/ 1e12`, `* 1e12`, `1e18`, or `1e6` in any codebase for USDC conversion. Use the single conversion module per language: `contracts/src/guard/Usdc.sol`, `packages/shared/src/units.ts`, `analyzer/twelve/units.py`. Grep enforces this in CI (`scripts/lint-units.sh`).
- I2. Every TypeScript amount is a branded type: `Usdc6` or `Usdc18` (`bigint` branded). Never `number` for on-chain amounts. Never `parseFloat`.
- I3. 18→6 conversion **floors** and returns the dust remainder explicitly: `toUsdc6(x: Usdc18): { amount: Usdc6; dust: Usdc18 }`. The ERC-20 view cannot move amounts below 10⁻⁶ USDC; silent truncation is a bug.

**Determinism & trust**
- I4. The analyzer is deterministic: same standard-JSON input + same tool version ⇒ byte-identical report core ⇒ identical `reportHash`. No timestamps, no random ordering, no dict-iteration order leaking into output, no absolute paths, no LLM in the analysis path.
- I5. Never attest a contract unless the locally compiled runtime bytecode **matches** on-chain code (after masking immutables and stripping CBOR metadata). A report about code that isn't deployed is worthless and destroys credibility.
- I6. `reportHash = keccak256(JCS(reportCore))` (RFC 8785). `reportCore` excludes `scannedAt`, host info, and timing.
- I7. `TwelveRegistry` is immutable: no owner, no proxy, no pause, no admin. Trust is expressed by consumers choosing an attester address.

**Arc facts**
- I8. Arc-specific behavior (the `0x3600…` interface, native-coin precompiles, EIP-7708 logs, blocklist) does **not** exist in anvil/local EVM. Anything asserting that behavior runs against **Arc testnet** (`chainId 5042002`). Local tests use mocks and are labeled as such.
- I9. Deterministic finality: no reorg-handling code paths. But the monitor asserts parent-hash continuity and **halts loudly** if violated.
- I10. On the ERC-20 interface, a single `transfer()` emits **two** logs (6-dec from `0x3600…`, 18-dec from the system emitter `0xffff…fffe`). Always pair them; never double count.

**Operational**
- I11. No private keys, API keys, or RPC URLs with credentials in git. `.env.example` lists every variable with a comment.
- I12. The attester key and the deployer key are different keys.

---

## 4. Repo layout

```
twelve/
├── CLAUDE.md                  # this file
├── DEMO_SCRIPT.md
├── docs/                      # specs (see §2)
├── analyzer/                  # Python 3.12, uv-managed, Slither-based
│   ├── pyproject.toml
│   ├── twelve/
│   │   ├── cli.py             # `twelve scan|verify|explain`
│   │   ├── units.py           # the ONLY place 10**12 appears in Python
│   │   ├── lattice.py         # Unit domain, join, transfer functions
│   │   ├── sources_sinks.py   # msg.value, balance, 0x3600 calls, call{value}
│   │   ├── bindings.py        # resolve which vars hold 0x3600 (config/immutable/storage)
│   │   ├── dataflow.py        # intra + interprocedural fixpoint over SlithIR SSA
│   │   ├── rules/             # one module per rule id (TW-xxx)
│   │   ├── report.py          # report schema, JCS canonicalization, hashing
│   │   └── fetch/             # Blockscout source fetch, standard-JSON rebuild, bytecode match
│   └── tests/
├── contracts/                 # Foundry
│   ├── src/
│   │   ├── TwelveRegistry.sol
│   │   ├── TwelveGate.sol     # example consumer: refuses native USDC into non-CLEAN targets
│   │   ├── guard/Usdc.sol     # Usdc6/Usdc18 UDVTs + operators + conversions
│   │   ├── guard/TwelvePayout.sol
│   │   └── demo/              # LeakyRefund.sol, FixedRefund.sol (see DEMO_SCRIPT.md)
│   ├── test/                  # local (mocked) tests
│   ├── test-arc/              # tests that MUST run on Arc testnet (I8)
│   └── script/                # Deploy*.s.sol
├── corpus/                    # planted-bug pairs: cNN_<name>/{bug.sol,safe.sol,expect.json}
├── apps/
│   ├── api/                   # Fastify: scan jobs, reports, status, alerts, subscriptions
│   ├── monitor/               # log ingestion, pairing, baselines, detectors, revoker
│   └── web/                   # Next.js: paste address → report → attestation → alerts
├── packages/shared/           # chain config, branded units, report schema (zod), ABIs
├── scripts/                   # lint-units.sh, corpus-metrics, mainnet-sweep
└── infra/                     # Dockerfile (python+solc+node), fly.toml, compose for local pg
```

Package managers: `pnpm` (workspaces) for TS, `uv` for Python, `forge` for Solidity.

---

## 5. Commands

```bash
# setup
pnpm i && (cd analyzer && uv sync) && (cd contracts && forge install)
docker compose -f infra/compose.yml up -d          # local postgres

# analyzer
cd analyzer && uv run pytest -q
uv run twelve scan ../corpus/c01_ltv_compare/bug.sol --json
uv run twelve scan --address 0x... --chain arc      # fetch + match + scan
uv run twelve verify --address 0x...                # recompute reportHash, compare to registry
uv run python -m twelve.metrics ../corpus           # precision/recall table; must not regress

# contracts
cd contracts && forge test                          # local, mocked
forge test --match-path 'test-arc/*' --fork-url $ARC_TESTNET_RPC   # real Arc semantics
forge script script/DeployRegistry.s.sol --rpc-url $ARC_RPC --broadcast --verify \
  --verifier blockscout --verifier-url $BLOCKSCOUT_VERIFY_URL

# services
pnpm --filter api dev
pnpm --filter monitor dev -- --from-block <n>
pnpm --filter web dev

# gates
scripts/lint-units.sh && pnpm -r typecheck && pnpm -r test
```

Resolved in Phase 0 (ARC_LEDGER §4): `forge test --fork-url $ARC_TESTNET_RPC_URL` executes `0x3600` **reads** (`balanceOf`) correctly but **not writes**: `transfer` calls the native-coin precompile at `0x1800…`, which is a placeholder (`0x01`) in a fork and reverts. Read-only assertions may use a fork. Anything that moves USDC must be a broadcast-and-assert script against testnet (proposed ADR-017).

---

## 6. Environment

See `.env.example`. Required:

| Var | Purpose |
|---|---|
| `ARC_RPC_URL` / `ARC_WS_URL` | mainnet (5042). Public endpoint is listed as permissioned — use a provider (QuickNode lists a WS endpoint). |
| `ARC_TESTNET_RPC_URL` | 5042002 |
| `BLOCKSCOUT_API_KEY` | Pro API, `https://api.blockscout.com/5042/api/v2/...` for verified source |
| `DATABASE_URL` | Postgres |
| `ATTESTER_PRIVATE_KEY` | hot key, small USDC balance, attest/revoke only |
| `DEPLOYER_PRIVATE_KEY` | used only by forge scripts; never loaded by services |
| `REGISTRY_ADDRESS`, `GATE_ADDRESS` | from deployment |
| `ALERT_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN` (optional) | alert delivery |

---

## 7. How to work in this repo

**Posture.** Treat every run as if it will succeed: consult the best available source *before* acting (Arc docs, the Slither source for the pinned version, the live Blockscout response) instead of launching an attempt you expect to throw away. When something fails, record *why* in the relevant doc and change the approach — do not retry blindly. This is an effort posture, not an architecture: every system still gets full error handling, retries with backoff, and explicit failure paths.

**Verify Arc facts against primary sources, not memory.** Arc is weeks old; your priors are wrong about it by default. Primary sources: `docs.arc.io` (Stablecoin native model, EVM differences, USDC system events, RPC endpoints, contract addresses), `github.com/circlefin/arc-node` issues. When you rely on an unconfirmed fact, mark it `VERIFY:` in the doc and in a code comment.

**Analyzer changes are metric-gated.** Any change under `analyzer/twelve/` must be followed by `twelve.metrics` on the full corpus. Recall on HIGH-severity planted bugs must stay 100%. HIGH false positives on safe twins must stay 0. Paste the metrics table delta into the commit message.

**Precision beats coverage.** A rule that fires on safe code is worse than no rule. When unsure, emit at lower confidence or not at all; never widen a HIGH rule to catch an edge case.

**Report root causes only.** Once a value is in conflict, it becomes `Unknown` downstream (cascade suppression, see `docs/ANALYZER.md §6`). One bug ⇒ one finding.

**Small, reviewable commits.** One concern per commit. Conventional prefixes: `analyzer:`, `contracts:`, `monitor:`, `api:`, `web:`, `docs:`, `corpus:`.

**When you add a design decision, add an ADR** to `docs/DECISIONS.md` with context, options, decision, consequences.

**Ask before:** deploying to mainnet, spending more than trivial mainnet USDC, publishing a finding about a third-party contract (responsible disclosure first — see `docs/CORPUS_AND_TESTING.md §7`), changing the report schema version, or changing registry storage layout pre-deploy.

---

## 8. Coding standards

**Python (analyzer)**: 3.12, full type hints, `mypy --strict` clean, `ruff`. Frozen dataclasses for IR-derived facts. No global mutable state except explicit caches keyed by content hash. Sort every collection before it reaches the report. Pin `slither-analyzer` exactly; SlithIR class names/attributes change between versions — check the installed source before using an attribute.

**Solidity**: `pragma solidity 0.8.30;` exact (≥0.8.19 required for UDVT operators). `evm_version = "osaka"` (Phase 0: solc 0.8.30 and 0.8.37 with osaka both deploy on Arc testnet; see ARC_LEDGER §4). Custom errors, no revert strings. NatSpec on every external function. Checks-effects-interactions; `nonReentrant` not needed in the registry (no external calls) but required in `TwelveGate` and demo contracts that send value.

**TypeScript**: strict, `viem` for all chain I/O, `zod` at every boundary (HTTP, DB rows, analyzer JSON). Branded amounts (I2). No `any`. Errors are typed results at module boundaries; exceptions only for programmer errors.

**SQL**: migrations in `apps/api/migrations` (plain SQL, numbered). Amounts stored as `NUMERIC(78,0)` with the view encoded in the column name (`amount_18`, `amount_6`). Never `DOUBLE`.

---

## 9. Arc gotchas (the ten that bite)

1. `msg.value`, `address.balance`, `eth_getBalance`, `gasPrice*gasUsed` → 18 decimals. `USDC.balanceOf/transfer` → 6 decimals. Same balance.
2. There is no WETH. The native asset *is* the ERC-20 via `0x3600…`.
3. One ERC-20 `transfer()` ⇒ two `Transfer` logs (6-dec from `0x3600…`, 18-dec from `0xfffffffffffffffffffffffffffffffffffffffe`). Match on emitter address.
4. Native sends, contract endowments, and self-destruct moves emit **only** the 18-dec system log. That is how you know the native interface was used.
5. Topic0 for both is the standard ERC-20 `Transfer` topic `0xddf252ad…b3ef`. The emitter address is the discriminator.
6. The ERC-20 view cannot move dust below 10⁻⁶ USDC.
7. Mainnet chain ID `5042`, testnet `5042002`. Old third-party registries list wrong IDs — trust `eth_chainId`.
8. Mainnet RPC and explorer are listed as permissioned; use a provider and the Blockscout Pro API.
9. Arc supports EIP-7702: an EOA can have code (`0xef0100 ‖ delegate`). Treat delegated EOAs as `UNSUPPORTED` in v1.
10. USDC blocklist enforcement is protocol-level; a native send to/from a blocklisted address reverts. Surface such reverts as their own error, not a generic failure.

---

## 10. Definition of done (per feature)

- Spec section in the relevant doc is accurate after the change.
- Tests: unit + (where Arc semantics matter) `test-arc/`.
- Analyzer: corpus metrics non-regressing, table in commit message.
- No `VERIFY:` introduced without an owner note.
- `scripts/lint-units.sh`, typecheck, tests all green.
- For anything user-visible: works on the deployed web app against mainnet, not only locally.

---

## 11. Out of scope for v1 (do not build)

- Non-USDC decimal mismatches (EURC/USYC cross-currency mixing) — noted as a future rule family only.
- Vyper, Yul-heavy contracts, raw assembly analysis beyond flagging `UNSUPPORTED`.
- Bytecode-only (unverified) static analysis — unverified contracts are covered by the monitor, not the analyzer.
- Any LLM-generated finding or explanation in the report core.
- Multi-chain support. Twelve is Arc-only by construction.
