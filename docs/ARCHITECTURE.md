# ARCHITECTURE.md

## 1. System context

```
                     ┌──────────────────────────── Arc mainnet (5042) ───────────────────────────┐
                     │  target contracts   TwelveRegistry   TwelveGate   demo/LeakyRefund,Fixed  │
                     │  0x3600… (6-dec ERC-20 view)   0xffff…fffe (18-dec EIP-7708 system logs)  │
                     └──────▲──────────────────▲──────────────────▲──────────────────▲───────────┘
                            │eth_getCode/Storage│attest/revoke tx   │eth_getLogs + WS   │
 Blockscout Pro API ──src──►│                   │                   │                   │
                     ┌──────┴────────┐   ┌──────┴──────┐     ┌──────┴────────┐          │
 web (Next.js) ─────►│   api (TS)    │──►│  attester   │◄────│ monitor (TS)  │──────────┘
   paste address     │ scan jobs,    │   │ (in api     │     │ ingest, pair, │
   report, alerts    │ reports,      │   │  process)   │     │ baselines,    │
                     │ status, subs  │   └─────────────┘     │ detectors,    │
                     └──┬─────────┬──┘                       │ proxy watcher │
                        │spawn    │                          └──────┬────────┘
                        ▼         ▼                                 │
                 analyzer CLI   Postgres ◄──────────────────────────┘
                 (Python,       (jobs, reports, attestations, logs,
                  Slither,       movements, profiles, alerts, subs)
                  solc)
```

Four trust-relevant boundaries:
1. **Analyzer ⇄ everything**: a pure CLI. Input = solc standard-JSON + binding hints + target metadata. Output = canonical JSON report on stdout. No network, no DB. This makes reports reproducible by anyone (`twelve verify`).
2. **Chain ⇄ services**: the registry is the only on-chain state Twelve owns. Everything else is derived and re-derivable.
3. **Attester key**: only process that signs. Lives in `api`. Rate-limited, allowlisted functions (`attest`, `revoke`).
4. **Web**: read-only against the API plus wallet-free. No user keys ever touch Twelve.

## 2. Components

### 2.1 analyzer/ (Python)
Responsibilities: compile, (optionally) match bytecode, resolve bindings, run unit dataflow, emit report. Spec: `docs/ANALYZER.md`.
Why a CLI and not a library called from TS: language boundary is also the reproducibility boundary; the exact command in the report's `tool.invocation` field is what a third party reruns.

### 2.2 apps/api (TypeScript, Fastify)
- `POST /v1/scans {chainId, address}` → enqueues job (pg-boss on Postgres). Returns `{scanId}`.
- `GET /v1/scans/:id` → job state machine (§3) + report when done.
- `GET /v1/reports/:reportHash` → canonical report JSON (content-addressed, immutable, cacheable forever).
- `GET /v1/status/:address` → merged view: on-chain registry status (read via viem at request time) + latest report + open alerts.
- `GET /v1/alerts?address=&severity=&cursor=` → monitor output.
- `POST /v1/subscriptions {address, webhookUrl}` → HMAC-signed alert delivery.
- `GET /v1/sweep` → aggregate mainnet sweep stats (see CORPUS_AND_TESTING §6).
Rate limits: per-IP token bucket on scans; a scan for an address whose `codehash` + tool version already has a report returns the cached report (content-addressed dedupe).

### 2.3 attester (module inside api)
- Holds `ATTESTER_PRIVATE_KEY`. Exposes internal `attest(target, reportCore)` and `revoke(target, reason)`.
- Single-writer nonce manager (one in-flight tx at a time, queue behind it). With ~0.5 s finality this is not a throughput problem.
- Retries with backoff on RPC errors; on `replacement underpriced` bumps tip; on blocklist revert marks attester unusable and pages.
- Balance watchdog: refuses to attest below a floor and raises an ops alert.

### 2.4 apps/monitor (TypeScript)
Log ingestion from `0xffff…fffe`, `0x3600…`, `TwelveRegistry`, and `Upgraded` from attested proxies; pairing; per-contract profiles; detectors; proxy-upgrade auto-revoke via the attester (internal HTTP or shared queue). Spec: `docs/MONITOR.md`.

### 2.5 apps/web (Next.js)
Routes: `/` (paste address, recent scans, live alert ticker), `/c/[address]` (verdict, findings with unit trace, attestation panel, "verify it yourself"), `/alerts`, `/integrate` (registry + guard usage), `/corpus` (published precision/recall), `/sweep`. Design bar: this is the grant's "link we can open" — it must read as a product, not a hackathon page. Server components fetch from api; no chain writes.

### 2.6 contracts/
`TwelveRegistry` (spec: REGISTRY.md), `TwelveGate` + guard library + demo contracts (spec: GUARD.md).

### 2.7 packages/shared
Chain definitions (viem `defineChain` for 5042/5042002 incl. WS), constants (`USDC_ERC20`, `SYSTEM_EMITTER`, topics, EIP-1967 slots), branded unit types and conversions (the only TS place 10¹² appears), zod report schema mirrored from Python (`schemaVersion` checked at parse), registry ABI (generated from forge artifacts).

## 3. Scan pipeline (state machine)

```
QUEUED
 → RESOLVING      eth_getCode, codehash; classify: EOA | 7702-delegated | contract | EIP-1967 proxy | beacon proxy
 → FETCHING       Blockscout verified source (for proxy: proxy + implementation)
 → REBUILDING     reconstruct solc standard-JSON input from verified metadata
 → COMPILING      exact solc version (svm/solc-select), same settings
 → MATCHING       compiled runtime vs on-chain runtime (mask immutables, strip CBOR, link libs)
 → BINDING        resolve which state vars / immutables / constants equal 0x3600…
 → ANALYZING      analyzer CLI → report core
 → HASHING        JCS → keccak → reportHash; persist report (content-addressed)
 → ATTESTING      registry.attest(...) ; wait receipt
 → DONE
Terminal errors: NOT_A_CONTRACT | UNSUPPORTED(reason) | NOT_VERIFIED | MATCH_FAILED | COMPILE_FAILED | ANALYZER_ERROR | ATTEST_FAILED(retryable)
```

Rules:
- `NOT_VERIFIED` and `MATCH_FAILED` are **never attested**. The web shows "covered by live monitor only".
- `UNSUPPORTED` (Vyper, 7702, heavy assembly on value paths) is attested as verdict `INCOMPLETE` only if compile+match succeeded; otherwise not attested.
- Every stage writes `(scanId, stage, startedAt, endedAt, error?)` to `scan_events` for the UI progress bar and debugging.

## 4. Data model (Postgres)

```sql
scans(id uuid pk, chain_id int, address bytea, codehash bytea, state text, error jsonb,
      report_hash bytea null, attest_tx bytea null, created_at, updated_at)
scan_events(scan_id, stage, started_at, ended_at, error jsonb)
reports(report_hash bytea pk, schema_version int, tool_version text, core jsonb, meta jsonb)
attestations(chain_id, target bytea, attester bytea, codehash bytea, report_hash bytea,
             verdict smallint, revoked bool, tx bytea, block bigint, pk(chain_id,target,attester))
logs_raw(block bigint, tx bytea, log_index int, emitter bytea, topic0 bytea, "from" bytea, "to" bytea,
         value NUMERIC(78,0), pk(block, log_index))
movements(block, tx, idx, "from", "to", amount_18 NUMERIC(78,0), iface text CHECK (iface in ('erc20','native','mint','burn')))
profiles(address pk, is_contract bool, n_out int, out_hist int[64], median_out_18 NUMERIC(78,0),
         max_out_frac NUMERIC, balance_18 NUMERIC(78,0), updated_block bigint)
alerts(id, detector text, severity text, address, tx, block, evidence jsonb, dedupe_key text unique, created_at)
checkpoints(stream text pk, block bigint, block_hash bytea)
subscriptions(id, address, webhook_url, secret, created_at)
```

All amounts `NUMERIC(78,0)` in a column whose name states the view. Derivation direction: `logs_raw` is truth; `movements`, `profiles` are rebuildable by replay (`monitor rebuild --from 0`).

## 5. Deployment topology

- One Docker image (`infra/Dockerfile`): Node 22 + Python 3.12 + uv + svm-managed solc binaries prefetched for common versions. Two process types: `api` (+attester) and `monitor`. Fly.io (or Railway) with managed Postgres.
- `web` on Vercel, `NEXT_PUBLIC_API_URL` → api.
- Secrets via platform secret store. Attester key only in `api` process env.
- Observability: structured JSON logs (pino / structlog), `/healthz` (DB, RPC head lag, attester balance, monitor lag), ops alerts to a separate Telegram channel.

## 6. Failure modes & responses

| Failure | Detection | Response |
|---|---|---|
| RPC provider down | head lag > 30 s | fail over to secondary provider; monitor resumes from checkpoint (idempotent upserts) |
| Parent-hash discontinuity | continuity check | **halt ingestion**, page; finality violation or provider bug — do not guess |
| Blockscout rate limit | 429 | exponential backoff with jitter; scan stays in FETCHING |
| solc version missing | COMPILING error | svm install on demand, cache; if unavailable → COMPILE_FAILED with version in error |
| Bytecode mismatch | MATCHING | MATCH_FAILED with diff summary (first differing offset, lengths, metadata presence) |
| Attester low balance | watchdog | stop attesting, queue, page |
| Analyzer crash | nonzero exit | ANALYZER_ERROR with stderr tail; never partial reports |
| ERC-20 log without system twin | pairing | ops alert with tx hash; movement recorded as `anomaly` |
