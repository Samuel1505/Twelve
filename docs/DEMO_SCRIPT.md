# DEMO_SCRIPT.md — Twelve

Two formats from one script: a **3:00 recorded video** (the submission asset) and a **live walkthrough** (office hours / follow-ups). Everything shown runs on **Arc mainnet** — no testnet, no mocks, no slides with fake screens.

**Differentiation statement (must be true on screen, false for any generic project):**
> A buyer pays 0.1 USDC to a live Arc mainnet contract and gets back 0.0000000000001 USDC; Twelve flags the exact source line before deploy, catches the transaction on-chain within seconds, and makes the same code fail to compile.

**The primary wow beat** (live refund arrives as dust + alert fires) lands by **0:50** — within the first 30% of runtime.

---

## 0. Pre-flight (do all of this before recording)

| Check | How |
|---|---|
| Demo wallet A (buyer) funded | ≥ 0.5 USDC on mainnet (0.1 per take, locked in LeakyRefund for good; plus gas) |
| LeakyRefund deployed, verified, **sold out** | `capacity` reached so `buy()` takes the refund path |
| FixedRefund deployed, verified, sold out | same state |
| OverpayVault deployed with ≤ 1 USDC | for guarded-revert beat |
| All three scanned and attested | web shows FINDINGS / CLEAN / FINDINGS |
| Monitor head lag < 2 s | `tail .live/monitor.log` → last `"msg":"window"` shows `"lag":"0"` (or 1) |
| Alert ticker visible on `/` | SSE connected |
| Pre-approved USDC allowance from wallet A to both shops | avoids an approve tx on camera |
| Explorer tabs pre-opened (explorer.arc.io) | registry, LeakyRefund, wallet A |
| Terminal with `twelve verify` ready | large font |
| `contracts/fixtures/compile-fail/Mix.sol` ready (`contracts/script/compile-fail.sh`) | for compile-error beat |
| Fallback clips recorded | see §6 |

Screen: 1920×1080, browser zoom 125%, dark theme, notifications off. One browser window + one terminal, arranged left/right for the split-screen beats.

---

## 1. Script (3:00)

### Beat 1 — Hook (0:00–0:15)
**Screen:** Black, then one line types out: `1 USDC = 1000000 = 1000000000000000000`. Cut to Arc's own docs line warning not to mix `msg.value` with `USDC.balanceOf()`.
**Narration:** "On Arc, one USDC is a million — or a quintillion — depending on which door you use. Same balance, two decimal views. Mix them up and you're off by a factor of a trillion. Arc's docs warn about it. Nothing enforced it."

### Beat 2 — The bug, live on mainnet (0:15–0:50) ★ primary wow
**Screen:** LeakyRefund's verified source on the explorer, highlight `call{value: paid6}`. Then the web app `/`, alert ticker visible. Wallet A calls `buy(100000)` (0.1 USDC: raw `100000` in the ERC-20 view).
**Narration:** "This is a real ticket shop on Arc mainnet. It takes payment through the ERC-20 interface and refunds through the native one — exactly how you'd write it on Ethereum. The show's sold out, so I should get my 0.1 USDC back."
**Screen:** Explorer tx: incoming refund `0.0000000000001 USDC` (raw `100000` in the native view). **Within ~1 s**, the ticker shows `HIGH · D1 CROSS-VIEW RAW EQUALITY · LeakyRefund`. Click the alert: evidence panel — inflow `100000` erc20 = 0.1 USDC, outflow `100000` native = 0.0000000000001 USDC, ratio 10⁻¹².
**Narration:** "I got back five trillionths of a dollar. And Twelve caught it from the chain itself — Arc logs every native USDC movement, so the monitor sees the same number going in through one door and out through the other, unscaled. That fingerprint doesn't need the source code."
**Timing rule:** if the alert hasn't appeared by 3 s, cut to fallback clip F1; never wait on camera.

### Beat 3 — Before deploy: the analyzer (0:50–1:25)
**Screen:** Paste LeakyRefund's address → progress chips (Resolving → Fetching → Matching → Analyzing → Attesting) → verdict **FINDINGS**. Finding card: `TW-003 NATIVE_SINK_6 · HIGH · INFERRED`, source line highlighted, unit trace chips: `paid6 [1,6] ← transferFrom amount` → `call{value}` expects `[1,18]`.
**Narration:** "Before anyone deployed it, the analyzer would have said this. It tracks the decimal unit of every USDC value through the contract and stops at the line where 6 meets 18. It compiled the verified source and confirmed the bytecode matches what's actually on-chain — the report is about the deployed code, not a copy."
**Screen:** Paste FixedRefund → **CLEAN**.

### Beat 4 — On-chain attestation + gate (1:25–1:55)
**Screen:** Attestation panel: registry tx link, codehash, reportHash. Explorer shows `Attested` event. Then wallet A calls `TwelveGate.forward(LeakyRefund, …)` → reverts `TargetNotClean(FINDINGS)`. Same forwarded call to FixedRefund → passes the gate (status CLEAN). The gate forwards native value only, and FixedRefund is paid through the ERC-20 view, so the demo forwards a plain call (e.g. `sold()`), not a purchase (GUARD §3).
**Narration:** "Every result is attested on Arc, bound to the contract's codehash — change the code and it goes stale on its own. Any router or wallet can check it in one call. This gate refuses to send native USDC to the leaky shop, and lets it through to the fixed one."

### Beat 5 — Verify it yourself (1:55–2:10)
**Screen:** Terminal: `curl $API/v1/reports/<hash> > r.json && uv run twelve verify --report r.json` → `MATCH recomputed 0x… claimed 0x…`. The report pins the analyzer commit: verify from that checkout (the CLI prints the `git checkout` when it differs).
**Narration:** "You don't have to trust us. Rerun the analyzer on the same verified source and you get the same hash that's on-chain."

### Beat 6 — The fix is a type (2:10–2:30)
**Screen:** Editor: `Usdc6 paid; … sendNative(to, paid)` → compiler error `TypeError: … Usdc6 … Usdc18`. Then `Usdc.toNative(paid)` → compiles. Quick cut: OverpayVault `withdrawGuarded` reverts `UnitMismatch(…)`.
**Narration:** "The recommended fix makes the bug unrepresentable: two types, and mixing them is a compile error. For legacy code, a checked payout reverts the moment the units disagree."

### Beat 7 — Proof it's real (2:30–2:50)
**Screen:** `/corpus` table (recall 100% on HIGH, 0 false HIGHs on safe twins), `/sweep` (N verified mainnet contracts scanned, verdict distribution). **Only real numbers.**
**Narration:** "It's measured: every planted high-severity bug caught, zero false alarms on the fixed twins — and it's already swept every verified contract on Arc mainnet."
> Until Phase 7's sweep has run, replace the last clause with what `/sweep` shows (the 15-contract sample and the full-history monitor replay). Never narrate a number the page does not show (§3).

### Beat 8 — Close (2:50–3:00)
**Screen:** Architecture one-liner: `analyzer → registry → monitor → types`. URL.
**Narration:** "Twelve: the decimal-safety layer for Arc. It only exists because Arc does."

---

## 2. Visual framing rules
- Every amount on screen shows **both** raw integer and USDC with the view label: `100000 (6-dec) = 0.1 USDC`. The raw numbers *are* the story.
- Use the same color for the 6-dec view (blue) and 18-dec view (amber) across web, alerts, and trace chips. Collision points in red.
- Never show a loading spinner longer than 2 s on camera; cut.
- Keep the cursor still while narrating; move only to point.

## 3. Things not to say
- "Hack", "exploit", or naming any third-party contract with an undisclosed issue.
- Any metric not produced by the current tool version.
- "Audit" — Twelve is a targeted analyzer for one bug class, and saying so is a strength.

## 4. Live walkthrough variant (5–8 min)
Same beats, plus: open the report JSON and point at `bytecodeMatch` and `bindings` (how the analyzer found `0x3600…` inside an immutable); show `MONITOR.md` detector D1 logic in one sentence; show a proxy attestation and explain the monitor-revocation trust assumption plainly. End with the roadmap: CI GitHub Action, EURC/USYC cross-currency rules, k-of-n attesters.

## 5. Recording checklist
- Record Beat 2 first, several takes (it depends on chain timing); keep the best.
- Record voiceover separately, clean room, then sync.
- Export 1080p, captions burned in (reviewers often watch muted).
- Final length 2:45–3:05.

## 6. Fallbacks
| ID | Failure | Fallback |
|---|---|---|
| F1 | Alert late / ticker disconnected | Pre-recorded clip of the same tx + alert from a rehearsal run (same contract, real tx hash shown) |
| F2 | RPC provider down | Secondary provider env swap (< 30 s); if still down, record later |
| F3 | Scan exceeds 10 s | Show cached report (content-addressed; same codehash) and say "cached from earlier scan" |
| F4 | Gate tx pending | Arc finality is sub-second; if pending > 3 s, cut and retake |
