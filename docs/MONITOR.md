# MONITOR.md — Live detection from Arc's native Transfer logs

The analyzer only covers verified code someone chose to scan. The monitor covers **everything on mainnet**, including unverified contracts, by reading the one data source that exists only on Arc: EIP-7708 system Transfer logs for every USDC movement (ARC_LEDGER §2).

Design goal: **few, strong alerts.** A monitor that cries wolf is a demo liability and a credibility loss. Every detector is judged against each contract's **own history**, not global thresholds (ADR-010).

---

## 1. Ingestion

Streams (each has its own checkpoint row):

| Stream | Filter | Purpose |
|---|---|---|
| `system` | `address = 0xffff…fffe`, topic0 = Transfer | every USDC movement, 18-dec |
| `erc20` | `address = 0x3600…`, topic0 = Transfer | ERC-20-interface twins, 6-dec |
| `registry` | `address = REGISTRY_ADDRESS` | Attested / Revoked (keeps DB in sync with chain) |
| `upgrades` | topic0 = `Upgraded(address)`, `address ∈ attestedProxies` | auto-revoke |

Implementation (Phase 4): the four streams are fetched with **one** `eth_getLogs` per window (address list
`[0xff…fe, 0x3600, registry, …watched proxies]`, topic0 ∈ {Transfer, Attested, Revoked, Upgraded, BeaconUpgraded}) under a
single checkpoint per chain; every log is classified by **emitter and topic together**, so a watched proxy that is
itself a token can never be read as a USDC movement (`src/decode.ts`). Windows adapt to provider caps (Infura: 10,000
blocks and 20,000 results, with a "retry with the range" hint; dRPC free: 101 blocks). Whether ingestion began at
genesis (`complete_history`) is stored with the checkpoint, never re-derived on restart.

Mechanics:
- **Backfill**: `eth_getLogs` in fixed windows (`WINDOW` = provider max, discovered in Phase 0; start 2,000 blocks), from genesis — mainnet is young, full history is cheap and gives complete baselines. Parallelism ≤ 4 windows, results applied **in block order**.
- **Head**: WS `newHeads` subscription; on each head fetch logs for `[checkpoint+1, head]`. WS disconnect → fall back to polling every 1 s until reconnected. *Phase 4: no WS endpoint is configured (`ARC_WS_URL` unset), so the monitor polls every 250 ms; headers and logs for a window are fetched in one parallel round trip. Measured on testnet: D1 alert 0.05–1.23 s after the block timestamp; D4 revoke tx +3–4 s after the upgrade block (`docs/evidence/phase4-testnet-exits.md`).*
- **Idempotency**: upsert on `(block, log_index)`. Replay any range safely.
- **Continuity (I9)**: store `block_hash` with checkpoint; for each new block verify `parentHash == stored hash`. Mismatch ⇒ halt stream, page ops. No automatic recovery. *Implemented at every window boundary (head-following windows are 1–2 blocks, so effectively every block); a CONTINUITY OPS alert is written and the process exits non-zero.*
- **Lag SLO**: head lag < 3 s p95. Alert detection latency target: < 2 s after block.

## 2. Pairing → movements

Per tx, sort both streams by `logIndex`. For each system log `S(f,t,v18)`:
1. Find the first unconsumed ERC-20 log `E(f,t,v6)` in the same tx with `v18 == toUsdc18(v6)` → `iface = 'erc20'`, consume `E`.
2. Else if `f == 0x0` → `mint`; `t == 0x0` → `burn`.
3. Else → `iface = 'native'`.
Leftover unconsumed `E` ⇒ ops anomaly alert (ARCHITECTURE §6) — **except** zero-value and self (`from == to`) ERC-20 transfers, which have no system twin by protocol behavior (ARC_LEDGER §2.2) and are no-ops.

Conversions go through `packages/shared/src/units.ts` only (I1). The pairing test suite includes: two identical transfers in one tx, transferFrom by a third party (the `from` is the owner, not the caller), zero-value transfers, mint/burn.

## 3. Profiles (per address)

Maintained incrementally for **every** address that moves USDC; contract-ness (`eth_getCode`, cached in `accounts`; 7702-delegated EOAs count as contracts) is resolved lazily, only for addresses that produce a candidate alert (ADR-020):

- `n_out[iface]` — count of outflows
- `hist[iface][b]` — log10 magnitude histogram of outflow `amount_18` (64 buckets, bucket = ⌊log10(amount_18)⌋)
- `median_out[iface]` — derived from histogram (bucket midpoint; exactness not needed)
- `balance_18` — running balance from all movements (seeded with `eth_getBalance` at first sight, then maintained; periodically reconciled every N blocks, drift → ops alert)
- `max_out_frac` — max over history of `outflow / pre_tx_balance`

Profiles are rebuildable: `monitor rebuild-profiles --from 0` replays `movements`.

## 4. Detectors

Each detector is a pure function `(tx movements, profiles snapshot) → Alert[]`. Pure ⇒ unit-testable with fixtures and replayable over history for FP measurement.

### D1 CROSS_VIEW_RAW_EQUALITY — the fingerprint (HIGH)
Within one tx, contract `C`:
- receives native inflow `x` (raw 18-dec integer) **and** sends an ERC-20 outflow whose raw 6-dec value equals `x` — overpay attempt that succeeded (C had enough balance) ⇒ HIGH; or
- receives an ERC-20 inflow with raw 6-dec `y` **and** sends a native outflow with raw 18-dec value equal to `y` — underpay (recipient got `y × 10⁻¹²` of intended) ⇒ HIGH.
Raw equality across views in one tx is almost never legitimate: it means one variable fed both interfaces unscaled. Guard: require `x ≥ 10⁴` raw to avoid coincidental tiny-value matches.

### D2 DUST_OUTFLOW (MEDIUM)
Native outflow from `C` with `amount_18 ≤ median_out(C) × 10⁻⁹` and `n_out(C) ≥ 20`. **Phase 4 refinements:** ignore outflows < 10⁴ raw (rounding dust), and require the 10¹² signature — `amount_18 × 10¹²` within one decade of `median_out(C)` (ADR-021). The 10⁻⁹ (not 10⁻¹²) margin tolerates legit variance while still requiring a ≥ 9-order-of-magnitude collapse. Suppress if `C`'s histogram already has ≥ 5% mass within 3 orders of this amount (it routinely sends tiny amounts).

### D3 ABNORMAL_SWEEP (MEDIUM)
Outflows from `C` in one tx ≥ 90% of `C`'s pre-tx `balance_18`, where `max_out_frac(C) < 0.10` historically and `n_out(C) ≥ 20`, and pre-tx balance ≥ 100 USDC. Catches the overpay-drain shape without needing to know intent. Explicitly *not* 10¹²-specific — alert text says "possible drain", evidence includes whether D1 also fired.

### D4 ATTESTED_PROXY_UPGRADED (ops + auto-action)
`Upgraded(newImpl)` from a proxy with a live Twelve attestation ⇒ call attester `revoke(proxy, "UPGRADED")`, enqueue a rescan, emit INFO alert. Target: revoke tx included within 5 s of the upgrade block.
The rescan must not reuse a cached report for the proxy: its codehash is unchanged by an upgrade. The API reuses a proxy report only if the proxy still points at the recorded implementation with the same codehash (Phase 4 bug: the first D4 run re-attested the old implementation).

### D5 ATTESTED_TARGET_FINDING_ACTIVITY (INFO)
A contract whose attestation verdict is FINDINGS receives inflows ⇒ INFO to subscribers ("funds are flowing into a contract with open HIGH findings"). Rate-limited to once per contract per 24 h.

Alert record:
```json
{ "detector": "D1", "severity": "HIGH", "address": "0x…", "tx": "0x…", "block": 123,
  "evidence": { "inflow": {"iface": "erc20", "raw": "5000000", "usdc": "5.000000"},
                "outflow": {"iface": "native", "raw": "5000000", "usdc": "0.000000000005"},
                "ratio": "1e-12", "profile": {"n_out": 34, "median_usdc": "3.1"} },
  "dedupeKey": "D1:0x…:0xtx" }
```

## 5. False-positive discipline
- **Replay gate**: before enabling a detector or changing a threshold, replay full mainnet history and record `alerts/day` and a manual triage of the top 20. Record results in this doc (§9). Targets: D1 ≈ 0 FP; D2+D3 combined ≤ a handful per day.
- No detector ships that can't state, in one sentence, why a legitimate contract would not trigger it.

## 6. Delivery
- Persist → SSE stream `/v1/alerts/stream` (web ticker) → webhooks for subscribers (`X-Twelve-Signature: hex(hmac_sha256(secret, body))`, retries 5× with backoff, dead-letter table) → optional Telegram.
- Dedupe by `dedupeKey`; per-address cooldown for MEDIUM/INFO.

## 7. Proxy watch set
`attestedProxies` = targets with non-zero `implementation` and not revoked, refreshed from the `registry` stream. The `upgrades` stream filter is rebuilt when the set changes (≤ 1 block delay). Also check EIP-1967 beacon proxies: watch `BeaconUpgraded(address)` on the proxy and `Upgraded` on the beacon.

## 8. Module layout
```
apps/monitor/src/
  ingest/{backfill.ts, head.ts, checkpoint.ts, continuity.ts}
  pair.ts                 # §2, pure
  profiles.ts             # §3
  detectors/{d1.ts,d2.ts,d3.ts,d4.ts,d5.ts}   # pure
  deliver/{sse.ts, webhook.ts, telegram.ts}
  revoker.ts              # calls api attester
  replay.ts               # CLI: replay [from,to] → alert stats (no delivery)
```

## 9. Replay results (Phase 4)

**Full mainnet history**, `apps/monitor/src/replay.ts --chain 5042 --from 0 --to 23,783,527` (Infura), completed
2026-10-02: **67,687,598 Transfer logs → 43,040,670 movements, 1,249,355 profiled addresses.** Activity is concentrated
after block ~12.0M (the "active period", ~68 days at ~0.5 s blocks); one burst at 21.05M–21.3M ran 100–200 logs/block.
Detector rules evolved during the run (ADR-021, D2 routine quieting, production cooldown in the tally); the D2 row is the
recorded evidence re-filtered under the **final** rules, keeping at most 20 alerts per contract for the routine rule
(evidence lacks the full outflow histogram), so it is an **upper bound**.

| Detector | Blocks replayed | Alerts (final rules) | Triaged TP | Triaged FP | Notes |
|---|---|---|---|---|---|
| D1 | 0 – 23.78M (all) | 49 tx-level alerts, 4 contracts (~0.7/active day) | 49 (4 contracts) | **0** | All the cross-view raw-equality fingerprint: a swap executor settling a Uniswap v4 swap natively with the 6-dec amount; two contracts of one operator forwarding sale proceeds natively unscaled on every trade (45 alerts); a Diamond router whose caller attached `msg.value` = the 6-dec amount (2 txs, dust impact). Third-party: details withheld pending disclosure (CORPUS_AND_TESTING §7). |
| D2 | 0 – 23.78M | ≤ 50 (≤ 0.73/active day), 35 contracts | 1 (fixed "5 USDC" fee paid natively, 3 txs) | 14 (Uniswap v4 PoolManager, UniversalRouter, PositionManager, ArcSettler, RelayRouterV3, an aggregator proxy: settlement dust) | 35 from unverified contracts / EIP-7702 smart accounts not individually classified. Pre-refinement classes removed: < 10^4-raw rounding dust (floor), aggregator round-trip dust (ADR-021 signature), UniversalRouter dust-swap spam (routine quieting). |
| D3 | 0 – 23.78M | 55, 55 distinct contracts (~0.8/active day) | 0 drains | 55 lifecycle sweeps (sampled: Uniswap V2 pair final LP exit, launchpad token graduations, LP pools) | One per contract; within target, kept as specified ("possible drain", MEDIUM). |
| PAIRING | 0 – 23.78M | 0 | – | – | After the ARC_LEDGER §2.2 no-op classes (zero-value and self ERC-20 transfers). |

**Gate:** D1 ≈ 0 FP — met (0 FP over full history). D2 + D3 ≤ a handful per day — met (≤ 1.54 per active day, upper bound).
Testnet exit runs (D1 latency, D4 revoke) and mainnet D1 latency: `docs/evidence/phase4-testnet-exits.md`.
