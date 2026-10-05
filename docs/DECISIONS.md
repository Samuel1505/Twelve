# DECISIONS.md — Architecture Decision Records

Format: Context → Options → Decision → Consequences. Append new ADRs; never rewrite accepted ones (supersede instead).

---

### ADR-001 — Slither/SlithIR as the analysis substrate
**Context.** Need interprocedural dataflow with SSA, storage modeling, inheritance resolution, and source mapping, built solo.
**Options.** (a) Slither (Python, SlithIR SSA, mature data-dependency, crytic-compile). (b) Aderyn (Rust, AST-level detectors — fits the builder's Rust, but no SSA IR/dataflow comparable to SlithIR). (c) Custom analysis on solc AST/Yul.
**Decision.** Slither, version pinned exactly.
**Consequences.** Python enters the repo, confined to `analyzer/`. SlithIR APIs shift across versions → read installed source before using attributes; upgrade Slither only with a full corpus run.

### ADR-002 — Analyzer as a pure CLI behind a JSON boundary
**Context.** Services are TypeScript; analysis is Python; reports must be reproducible by third parties.
**Decision.** `twelve` CLI: stdin/args in, canonical JSON out, no network/DB in the analysis step (fetching lives in `twelve/fetch/` and is a separate phase that emits the standard-JSON the analysis consumes).
**Consequences.** Anyone can rerun the exact analysis (`twelve verify`). TS never imports Python. Report schema is mirrored in zod and version-checked.

### ADR-003 — Own minimal registry instead of EAS
**Context.** EAS gives generic attestations; deployment status on Arc unknown, and generic schemas can't do codehash freshness in a single view call.
**Decision.** Purpose-built `TwelveRegistry` with EAS-like attester namespacing and code-bound freshness (`status()` compares `extcodehash`).
**Consequences.** One small audited-by-tests contract; a later EAS mirror is possible (emit to EAS from the attester) without changing consumers.

### ADR-004 — Immutable, permissionless, attester-namespaced registry
**Decision.** No owner/admin/upgrade. Anyone attests under `msg.sender`. Consumers pick attesters.
**Consequences.** No governance surface; trust is explicit. Bugs require v2 deployment and consumer migration — acceptable at this scale.

### ADR-005 — Bind to codehash; proxies rely on monitor revocation
**Context.** Contracts can't read other contracts' storage, so implementation swaps are invisible on-chain.
**Decision.** Store proxy `codehash` + recorded implementation + its `codehash`; monitor auto-revokes on `Upgraded`.
**Consequences.** Proxy freshness depends on attester liveness; stated in UI and docs rather than hidden.

### ADR-006 — RFC 8785 JCS canonical reports, hash excludes metadata
**Decision.** `reportHash = keccak256(JCS(reportCore))`; timestamps/host/timing live in unhashed `meta`.
**Consequences.** Deterministic, language-independent hashing; TS and Python must produce identical bytes (cross-language golden test).

### ADR-007 — No reorg logic; continuity assertion instead
**Context.** Arc has deterministic BFT finality.
**Decision.** No rollback paths. Assert parent-hash continuity; halt loudly on violation.
**Consequences.** Simpler ingestion; a provider bug surfaces as a halt, not silent corruption.

### ADR-008 — Arc-semantics tests run on Arc testnet
**Context.** `0x3600…` interface, EIP-7708 logs, blocklist are precompile-backed and only exist against Arc RPC.
**Decision.** Local tests use clearly labeled mocks; anything asserting real ledger behavior runs on testnet (`test-arc/`).
**Consequences.** Slower nightly suite, but tests prove the real thing.

### ADR-009 — Recommend UDVT typing as the primary remediation
**Decision.** `Usdc6`/`Usdc18` UDVTs with operators; every finding's `fix` points to them. Runtime `TwelvePayout` is the fallback for legacy code.
**Consequences.** Remediation is a compile-time guarantee rather than a reviewer's promise.

### ADR-010 — Per-contract baselines, not global thresholds, in the monitor
**Decision.** D2/D3 compare against each contract's own outflow history with minimum-sample gates; D1 uses a structural fingerprint (cross-view raw equality) that needs no baseline.
**Consequences.** Cold contracts produce no D2/D3 alerts until ≥ 20 outflows; accepted to protect precision.

### ADR-011 — Blockscout Pro API as the verified-source provider
**Context.** Arc's official explorer is Blockscout; mainnet explorer listed as permissioned.
**Decision.** Pro API (`api.blockscout.com/5042/...`) with key; Sourcify as a fallback if Arc is supported there (`VERIFY`).
**Update (Phase 3).** The Pro API also accepts *verification* (etherscan-style `verifysourcecode` form POST + `checkverifystatus`) with the same key, on both networks, without the public explorer's rate limit. `scripts/verify-pro.sh` wraps it; it is the only working mainnet path (public explorer 403).

### ADR-012 — Single Postgres, pg-boss queue
**Decision.** One database for jobs, reports, logs, profiles, alerts.
**Consequences.** Simple ops; `logs_raw` partitioned by block range if it grows.

### ADR-013 — No LLM in the analysis path
**Context.** Tempting for explanations, fatal for determinism and credibility.
**Decision.** Findings, messages, and fixes are rule-templated. Any future LLM explainer lives outside `reportCore`, clearly labeled.

### ADR-014 — Cascade suppression
**Decision.** Collisions poison downstream values to `Unknown`.
**Consequences.** One root cause, one finding; may under-report a second independent bug on the same value path — acceptable, and the corpus documents it.

### ADR-015 — Language split: Python (analyzer), TypeScript (services/web), Solidity (contracts)
**Context.** Builder is fluent in TS/Rust/Solidity; Python is forced by Slither.
**Decision.** Keep Python surface minimal; monitor in TS (viem's chain/log/signing ergonomics, shared units/types with web) rather than Rust.
**Consequences.** One fewer toolchain in the image; monitor throughput is far above Arc's block rate at this stage.

### ADR-016 — Bytecode match compiles independently of crytic-compile (ACCEPTED 2026-09-30)
**Context.** `ANALYZER.md §8` step 3 assumes Slither is fed "the same standard-JSON … so the IR matches the compiled artifact". Phase 0 read crytic-compile 0.4.2 and ran it (`analyzer/SLITHIR_NOTES.md §11`): `SolcStandardJson` **mutates the input dict in place**, `add_optimization` **replaces `settings.optimizer` with `{enabled, runs}`** (dropping `optimizer.details`, and `runs` when 0), sources given only as inline `content` fail with `Unknown file`, and `outputSelection` must include `evm.*` and `ast`. Verified contracts compiled with custom `optimizer.details` would therefore produce different bytecode through crytic than on chain.
**Options.** (a) Keep one compile through crytic and accept false `MATCH_FAILED` on `details` builds. (b) Two compiles: our own `solc --standard-json` on the pristine input for `standardJsonHash` + bytecode match (I5), and crytic on a deep copy (sources materialized to a temp dir, `solc_working_dir` set) for IR only. (c) Patch/monkeypatch crytic-compile.
**Proposal.** (b). SlithIR is built from the AST, which the optimizer does not affect, so the IR is still correct for the verified source. The match uses the untouched input. `standardJsonHash` is computed before any library sees the dict.
**Consequences.** Two solc runs per scan (cheap relative to the fetch). `ANALYZER.md §8` step 3 needs rewording once accepted. Report source paths must use `Filename.used`, never `relative`/`absolute` (I4).

### ADR-017 — `test-arc/` write-path tests broadcast to testnet; fork only for reads (PROPOSED, Phase 0)
**Context.** ADR-008 puts Arc-semantics tests on testnet but left open whether `forge test --fork-url` is enough. Phase 0 (ARC_LEDGER §4): under a fork, `0x3600.balanceOf` is correct, but `0x3600.transfer` delegates to the native-coin precompile at `0x1800…`, which is a 1-byte placeholder locally → StackUnderflow → revert. EIP-7708 system logs for such moves are equally unobservable in a fork.
**Options.** (a) Fork everything, mock `0x1800` with `vm.etch`: tests our mock, not Arc (violates I8's intent). (b) Fork for read-only assertions; broadcast-and-assert scripts (`forge script --broadcast` + receipt/log checks) for anything moving USDC or asserting logs.
**Proposal.** (b). `test-arc/` holds read-only fork tests; `script/arc/*.s.sol` plus a TS assertion runner handle the write paths (LeakyRefund dust, FixedRefund exact, OverpayVault, TwelveGate).
**Consequences.** Write-path tests spend testnet USDC and take seconds, not ms; they run nightly and pre-release, not per commit.

### ADR-018 — Proxy detection includes the legacy ZeppelinOS implementation slot (ACCEPTED 2026-09-30)
**Context.** ARCHITECTURE §3 RESOLVING classifies proxies by EIP-1967 impl + beacon slots only. Arc's own `0x3600…` is a ZOS `AdminUpgradeabilityProxy` (impl at `keccak("org.zeppelinos.proxy.implementation")` = `0x7050c9e0…f8c3`, EIP-1967 slot empty). FiatToken-derived and other older-OpenZeppelin contracts ported to Arc will use the same layout. Undetected, their proxy code gets scanned (a trivial delegatecall shell → CLEAN) and attested while the real logic sits in the implementation.
**Options.** (a) EIP-1967 only; the ZOS case falls through to "contract". (b) Also read the ZOS slot and treat a non-zero value as `proxy(zos)`; attest proxy + implementation codehash as for EIP-1967 (ADR-005). The monitor watches `Upgraded` (same topic0).
**Proposal.** (b). Additionally, any contract whose runtime is a pure `DELEGATECALL` forwarder with no recognized slot → `UNSUPPORTED(unknown-proxy)`, never CLEAN.
**Consequences.** One more `eth_getStorageAt` per scan; closes a false-CLEAN path. Requires a `constants.ts` entry and a registry-side note that `0x3600` itself is upgradeable by Circle.

### ADR-019 — TW-008 (EXP_DRIFT) fires only outside [0, 18] (ACCEPTED, Phase 1)
**Context.** §5.3 treats `1e6`/`1e12`/`1e18` as scales. Fixed-point fee math divides by the same literals with a dimensionless rate: `msg.value * FEE_WAD / 1e18` lands at `(1,0)`, `a6 * FEE_PPM / 1e6` at `(1,0)`; `msg.value * ppm / 1e6` at `(1,12)`. With TW-008 as specified ("exp ∉ {6,18}"), these correct patterns — among the most common in DeFi — would be findings on safe code (h07).
**Options.** (a) Keep the rule; accept LOW FPs (they count against safe-twin FP ≥ LOW). (b) Model WAD/ppm literals as dimensionless (breaks the `a18 / 1e12` conversion the whole analyzer depends on). (c) Fire only for exponents no fixed-point pattern produces: outside `[0, 18]`, reachable only by applying the view conversion in the wrong direction (`a18 * 1e12` → 30, `a6 / 1e12` → −6).
**Decision.** (c), per CLAUDE.md "precision beats coverage". Storage merges of a view with a non-view exponent are likewise silent (no TW-005/TW-008).
**Consequences.** Missing-divisor bugs that stay inside `[0,18]` are not reported; the corpus documents the boundary (c21 fires, h07 is clean).

### ADR-020 — Monitor profiles every address; contract-ness resolved lazily for alert candidates (ACCEPTED, Phase 4)
**Context.** MONITOR §3 maintains profiles "where `from` is a contract (eth_getCode cached)". Mainnet replay showed ~10k distinct addresses per 20k blocks near head (millions over history) while Infura sustains ~35–55 `getCode`/s: resolving every address up front made a 20k-block replay take > 10 minutes and full history infeasible.
**Options.** (a) Resolve every address (hours per day of chain). (b) Profile only senders (still most addresses; breaks balances for contracts first seen as receivers). (c) Keep lightweight sparse profiles for every address; run detectors on every address as a *candidate*; resolve `getCode` (cached in `accounts`) only for addresses that produced a candidate alert, and drop non-contracts.
**Decision.** (c). A contract's profile is identical either way, so detector semantics for contracts are unchanged; EOAs never alert. EOA balances over-state (gas is not logged, ARC_LEDGER §2.1), so they never trip the underflow signal.
**Consequences.** Cost scales with candidates, not addresses (20k blocks: 200 s, 0 resolutions). Profiles table holds all addresses (migration 003 drops `is_contract`/`delegated`; `accounts` owns them). Balance-dependent checks (D3, BALANCE) require `completeHistory` (ingestion from genesis).

### ADR-021 — D2 requires the 10^12 signature, not just a large collapse (ACCEPTED, Phase 4)
**Context.** D2 fired on any native outflow ≥ 9 orders below a contract's median. Mainnet replay (blocks 21.04M–21.10M,
a ~3M-log burst) showed two classes: an aggregator sending rounding "plus dust" in round-trip settlements (24 alerts;
raw 8×10^8–10^10 against ~3–30 USDC payouts) and a smart account paying a fixed fee of exactly 5,000,000 raw natively
(= "5 USDC" in 6-dec units, typical payouts ~3 USDC) — the actual bug shape (third-party, under disclosure).
**Options.** (a) Raise the collapse threshold (still fires on arbitrary dust). (b) Require the 10^12 signature: the dust
amount × 10^12 must fall within one decade of the contract's median payout — i.e. a typical payment expressed in the
wrong view. (c) Drop D2 (loses cross-transaction underpays that D1 cannot see).
**Decision.** (b), plus the 10^4-raw floor of Phase 4. **Consequences.** Underpays of payments far outside a contract's
usual size (> 10× or < 0.1× its median) are not reported by D2; D1 still covers the same-tx case. Tests encode both
mainnet shapes (`apps/monitor/test/detectors.test.ts`).

### ADR-022 — The public alert feed names only disclosed addresses (ACCEPTED, Phase 5)
**Context.** The live ticker (DEMO_SCRIPT, `/alerts`) streams every alert. The full-history replay found real
third-party bugs under disclosure (MONITOR §9); head-following will find more. CORPUS_AND_TESTING §6–7 forbid
publishing a third-party address with an open true positive. Showing a tx hash or exact block names it just as well.
**Options.** (a) Filter in the web only (the API is public, so the data still leaks). (b) Show only our own demo alerts
(hides that the monitor works on real traffic). (c) Redact in the API: full rows for an allowlist, others published
with detector/severity/kind/ratio and an hour-rounded time; admin token sees everything.
**Decision.** (c). `DISCLOSED_ADDRESSES` lists our deployments; an address is added when its disclosure is resolved.
**Consequences.** The web shows withheld alerts as "third-party contract, details withheld pending disclosure", which
is honest and proves live coverage. `/v1/status/:address` still returns that address's alerts: whoever asks already
knows it, and the analyzer report for a verified contract is public anyway.

### ADR-023 — Interim hosting: web on Vercel, services on the owner's Mac behind a Cloudflare quick tunnel (ACCEPTED, Phase 5)
**Context.** ARCHITECTURE §5 targets Fly.io + managed Postgres. No payment card is available, and the monitor writes
~2.2M mainnet logs (~1.4 GB) per day, beyond free managed-Postgres tiers.
**Options.** (a) Fly/Railway (needs a card). (b) A free container host with an in-container Postgres and log retention
(changes MONITOR's "logs_raw is truth"; resets on restart). (c) Vercel Hobby for the web; api + monitor + Postgres on the
owner's Mac, published by `cloudflared tunnel --url` (no account, no card).
**Decision.** (c), via `scripts/go-live.sh` (start/status/stop). The API binds 127.0.0.1 with `TRUST_PROXY=1` so
rate limits use the visitor's IP from the tunnel; the monitor process never receives the attester key (I12).
**Consequences.** The site is up only while the Mac is awake and online (the script holds a `caffeinate` assertion).
A quick tunnel's URL changes when cloudflared restarts; the script then updates `NEXT_PUBLIC_API_URL` on Vercel and
redeploys. Public scans spend the attester's USDC (~0.0025 each, rate-limited per IP). `infra/` (Fly) remains the
path once hosting is funded.
