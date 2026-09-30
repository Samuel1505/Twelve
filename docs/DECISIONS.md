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
