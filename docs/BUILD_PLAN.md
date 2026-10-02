# BUILD_PLAN.md — Order of work and exit criteria

Order is fixed by risk: prove the analyzer is precise before anything depends on it; ship registry before monitor; guard last. Each phase ends only when its exit criteria hold **on the real network** where applicable.

---

## Phase 0 — Ground truth (spikes, no product code)
Goal: replace every `VERIFY:` that blocks later phases with a recorded fact.
- Run the checklist in `ARC_LEDGER.md §7`; record results inline.
- Provider choice for mainnet RPC + WS; record `eth_getLogs` window limits.
- Blockscout Pro API key; capture one real `smart-contracts/<addr>` response as a fixture in `analyzer/tests/fixtures/`.
- solc / Foundry `evm_version` for Arc; deploy hello-world on testnet and mainnet.
- Mainnet USDC for deployer + attester: bridge a small amount via CCTP (Arc is CCTP domain 26) or request via Circle contact; document the exact path used.
- Pin Slither; read the installed `slithir/operations` and `slithir/variables` source; write a 1-page API note in `analyzer/SLITHIR_NOTES.md` (class names, attributes for call value, SSA access, source mapping).
**Exit:** no blocking `VERIFY:` left in ARC_LEDGER; fixtures committed.

## Phase 1 — Analyzer core on the corpus (pre-deploy mode)
- `lattice.py`, `units.py` (scale table), `sources_sinks.py`, SSA intraprocedural dataflow.
- Rules TW-001..004, report schema + JCS hashing, CLI `scan <path>`.
- Corpus c01–c08, c12–c15, h01–h06 with safe twins.
- Interprocedural summaries + storage-cell fixpoint → TW-005; cascade suppression; TW-006/007/008/900.
- Remaining corpus cases.
**Exit:** HIGH recall 100%, HIGH safe-twin FP 0, `METRICS.md` committed, same input ⇒ identical hash across 10 runs and 2 machines.

## Phase 2 — Deployed-contract mode
- `fetch/`: Blockscout fetch → standard-JSON rebuild → exact compile → bytecode match (immutables, CBOR, libraries).
- Bindings from immutables + storage reads.
- Proxy detection (EIP-1967 impl + beacon); scan implementation.
- `twelve scan --address`, `twelve verify`.
**Exit:** 10 real verified Arc mainnet contracts scanned with `MATCH=exact|masked`; c09–c11 pass in deployed mode on testnet deployments.

## Phase 3 — Registry + attester + API
- `TwelveRegistry` + full test suite + storage layout test; deploy testnet → `test-arc` → mainnet; verify on Blockscout.
- `apps/api`: scan state machine, pg-boss, content-addressed reports, status endpoint, SSE progress.
- Attester: single-writer nonce, simulate-then-write, balance watchdog.
- `TwelveGate` deploy.
**Exit:** paste a mainnet address in `curl` → attestation on mainnet → `TwelveGate.forward` reverts for FINDINGS target and succeeds for CLEAN target, all on mainnet. **Met 2026-10-01** — `docs/evidence/phase3-mainnet-e2e.md`.

## Phase 4 — Monitor
- Backfill from genesis, head following, continuity check, pairing with anomaly alerts.
- Profiles, D1–D5, replay CLI, FP triage table in MONITOR §9.
- Proxy-upgrade auto-revoke (test on testnet with a real upgrade).
**Exit:** replay of full history within FP targets; D1 fires on the demo LeakyRefund tx within 2 s of the block on mainnet; D4 revokes within 5 s on testnet. **Met 2026-10-02:** D1 mainnet ✅ (≤ 0.94 s), D4 testnet ✅ (+3–4 s), full-history replay ✅ within FP targets (D1 0 FP; D2+D3 ≤ 1.54/day, MONITOR §9).

## Phase 5 — Web
- `/`, `/c/[address]` (findings with highlighted source lines and unit trace rendered as a chain of chips `msg.value [18] → credits[user] [18] → USDC.transfer expects [6]`), attestation panel with explorer links and a copyable `twelve verify` command, `/alerts` live ticker, `/integrate`, `/corpus`, `/sweep`.
- Quality bar: loads fast, no broken states, every error state from the pipeline has a human sentence, mobile-readable.
**Exit:** a stranger can open the link, paste an address, and understand the result without the demo narration.

## Phase 6 — Guard + demo contracts
- `Usdc.sol` + tests + compile-fail fixture; `TwelvePayout`; `LeakyRefund`, `FixedRefund`, `OverpayVault`.
- Deploy demo contracts to mainnet (trivial funding), scan them, attest them.
**Exit:** every beat in `DEMO_SCRIPT.md` runs live on mainnet end to end.

## Phase 7 — Mainnet sweep + disclosure
- Sweep all verified contracts; triage; `/sweep` page with aggregates.
- Handle any TP via CORPUS_AND_TESTING §7.
**Exit:** published sweep stats with triaged precision.

## Phase 8 — Submission
- README (problem → layers → how to verify a report yourself → metrics → deployed addresses).
- `docs/SUBMISSION.md` finalized; record demo video per `DEMO_SCRIPT.md`.
**Exit:** submission fields complete (live link, public repo, description incl. Arc usage, builder profile).

---

## Deployed
| Contract | Network | Address | Tx | Verified |
|---|---|---|---|---|
| TwelveRegistry | testnet 5042002 | `0x6670030e9df18e3a454ea77d69d00fd8d17728a1` | `0x487c850fea36e72bb6a4e0a5977c3c3a0c18fdd7628822fabbb2269c3f2ede33` | yes |
| TwelveRegistry | mainnet 5042 | `0x6670030e9df18e3a454ea77d69d00fd8d17728a1` | `0x7633c978b3f9cd5f268c0614e681009cc03eabd6c05fee8ae692a3b1d3807801` | yes (Pro API) |
| TwelveGate | testnet 5042002 | `0x7a63d663861f84cd0f6f66de29945620c1cc95b7` | `0x33ecf98c6730e067df458942f638ba3e4121f9f7b3af1e77bd5a07f68e526b41` | yes |
| TwelveGate | mainnet 5042 | `0x7a63d663861f84cd0f6f66de29945620c1cc95b7` | `0x58d4030ebca61138373e7a608b1f0f09d2a7548150776fc046591ba5d35c6d19` | yes (Pro API) |
| Gate target, FINDINGS (corpus c10 bug) | mainnet 5042 | `0x5a76d4ab409ca2114808edd38cb9a8343a34b7fb` | `0xf45cff6ca919bce7378bd1a80c413bd30238c70847afb0a7216da3f01eefb24d` | yes (Pro API) |
| Gate target, CLEAN (corpus c10 safe) | mainnet 5042 | `0x42957b36f5623912ded1a0a16bba3dad22e571c9` | `0xf1e76ecb565fc077f279ce2c1dcfb1e42a4bfd0aa7dff81f65f857d5956348f1` | yes (Pro API) |
| LeakyRefund | mainnet 5042 | `0xa6c15edc8ceffb558a54ead5bd9d833a589276bc` | (D1Demo deploy) | yes (Pro API) |
| LeakyRefund | testnet 5042002 | `0x3dbe97cf796e313be59b61e836488203cb5cbe07` | (D1Demo deploy) | no |
| FixedRefund | mainnet 5042 | `0x62e325c4aab5f3808dcaafb71d932f4e97455368` | `0x57488d5e6f0a8d57b41e2a2ae94c726534e617045de997d69823d0f52aca82b3` (attested CLEAN `0x26211614…c510`) | yes (Pro API) |
| OverpayVault | mainnet 5042 | `0xc2dc300e524cb9ee18887e7c2333d24403df076a` | `0x3cef66e811915cf0568acf26d3b3dd0a0b9ab185a731bd6b60900cc8a106eb4f` (attested FINDINGS `0x317a148e…b1a3a7`; 0.01 USDC deposit, unrecoverable by design) | yes (Pro API) |
| Attester EOA | testnet + mainnet | `0xe98540d28F45830E01D237251Bfc4777E69c9A46` | — | — |
