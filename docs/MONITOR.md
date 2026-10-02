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

## 9. Replay results (fill in during Phase 4)

Mainnet replay `apps/monitor/src/replay.ts --chain 5042 --from 0` (Infura). **Partial: blocks 0 – 12,898,848 of 23,783,527
(54.2%)** — 862,018 Transfer logs, 450,282 movements, 19,505 profiled addresses. Nearly all activity sits in the last
~45% of history (7–23 logs/block); under this key's sustained-throughput limits (HTTP 429 on any call after minutes of
load) the remainder is ~10–15 h of wall clock, beyond this session's background limit. Resume: same command (state file).
Blocks/day assumes ~0.5 s blocks (172,800/day); the dense part replayed so far is ~0.9M blocks ≈ 5.2 days.

| Detector | Blocks replayed | Alerts | Triaged TP | Triaged FP | Notes |
|---|---|---|---|---|---|
| D1 | 0 – 12.90M | 0 | – | – | — |
| D2 | 0 – 12.90M | 12 (pre-fix) → 0 | 0 | 12 | All native outflows of 40–9,900 raw from Uniswap v4 `PoolManager` (`0x8366a39C…0951`) and two routers in the same txs: settlement/rounding dust. Fix: ignore outflows < 10^4 raw (a 10^12 underpay of any ≥ 0.01 USDC payment is ≥ 10^4 raw; same floor as D1). |
| D3 | 0 – 12.90M | 3 (≈ 0.6/day) | 0 drains | 3 lifecycle sweeps | `UniswapV2Pair` `0xC7c16535…1a86` (final LP withdrawal), `DyorPumpToken` `0x4C9D1c8F…0000` (bonding-curve graduation), "ArcPumpSwap LPs" `0x469F8a1B…adDd`. Within the "handful per day" target; kept as specified ("possible drain", MEDIUM). |
| PAIRING | 0 – 12.90M | 0 after ARC_LEDGER §2.2 no-op classes | – | – | 769 pre-fix in a 20k-block head sample were all zero-value / self ERC-20 transfers. |

Testnet exit runs (D1 latency, D4 revoke): `docs/evidence/phase4-testnet-exits.md`.
