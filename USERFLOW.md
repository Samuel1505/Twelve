# Using Twelve end to end

Twelve catches one bug on Arc: code that mixes USDC's two views. The same balance reads `1000000` through the ERC-20
interface (6 decimals) and `1000000000000000000` natively (18 decimals). Mixing them misprices by 10¹².

**Live site:** https://twelve-arc.vercel.app
**Network:** Arc mainnet (chain 5042)

Follow the steps in order the first time. After that, jump to whichever one you need.

---

## 0. Start the backend (owner only)

The website runs on Vercel. The API, the monitor and the database run on your Mac, and a Cloudflare tunnel makes them
reachable from the internet. If the Mac is asleep or offline, pages still load but show "Can't reach Twelve".

```bash
cd ~/Desktop/dev/Twelve
scripts/go-live.sh          # starts Postgres, API, monitor and tunnel; redeploys the site if the tunnel URL changed
scripts/go-live.sh status   # what's running and the public URLs
scripts/go-live.sh stop     # stop API, monitor and tunnel
```

Check that it's healthy:

```bash
curl -s "$(cat .live/tunnel-url)/healthz"
# {"db":true,"chains":{"5042":{"head":"…"}, …}}
```

After a reboot, just run `scripts/go-live.sh` again. If the tunnel URL changed, the site redeploys itself, which takes
about two minutes.

---

## 1. Open the landing page

Go to https://twelve-arc.vercel.app.

1. **The hero panel** shows one balance as two raw integers. Click **0.1**, **5** or **1,000** to see the ERC-20
   number (blue) and the native number (amber). The red line shows what actually arrives if the ERC-20 number is
   sent natively: for 0.1 USDC, only `0.0000000000001 USDC`.
2. **Live on mainnet** lists the latest alerts from the monitor. A green dot with "streaming" means it's connected.
3. **Four layers against one bug** shows a real output from each layer: analyzer, registry, monitor and the type fix.
4. **Measured, with sources** lists the project's numbers, each with the file it comes from.

---

## 2. Scan a contract

1. In the box on the home page, paste a **verified** Arc mainnet contract address. It's pre-filled with the demo
   contract LeakyRefund. Press **Scan**.
2. You land on `/c/<address>`. If Twelve has no report for it yet, the scan starts on its own and you'll see the
   stages tick by:
   *Reading code → Fetching source → Rebuilding → Compiling → Matching bytecode → Finding USDC → Tracing units → Hashing report → Attesting on Arc*.
   A scan usually takes 5–20 seconds.
3. If an address already has a report, it shows immediately. Press **Scan again** to rescan it.

Addresses to try:

| Contract | Address | What you'll see |
|---|---|---|
| LeakyRefund (the bug) | `0xA6c15eDC8ceffb558A54ead5bd9d833A589276bC` | **FINDINGS**: TW-003, a native refund of a 6-decimal amount |
| FixedRefund (typed fix) | `0x62e325C4aaB5f3808DCAaFb71d932f4E97455368` | **CLEAN** |
| OverpayVault (drain shape) | `0xc2Dc300E524Cb9Ee18887E7c2333D24403dF076A` | **FINDINGS**: TW-004, an 18-decimal amount sent through the ERC-20 |
| A wallet, e.g. the attester | `0xe98540d28F45830E01D237251Bfc4777E69c9A46` | "No contract here" |

---

## 3. Read the report

On `/c/<address>`, from top to bottom:

1. **Verdict.** "Mixes USDC's two views" (red), "Keeps USDC's two views apart" (green) or "Partly analyzed" (amber),
   with a count of findings by severity.
2. **Each finding** shows:
   - the rule (for example `TW-003`), its severity and its confidence;
   - the verified source around the bug, with the exact expression underlined in red;
   - the **unit trace**: where the value's unit was learned (blue `6 dec · erc20`) and where it collides (amber
     `18 dec · native`);
   - **How to fix**.
3. **Check it yourself** gives a copyable command that recomputes the report (see step 7).
4. **On-chain attestation** (right column) shows:
   - the registry status (CLEAN / FINDINGS / INCOMPLETE / STALE / REVOKED / NONE);
   - whether the on-chain report hash *matches this report*;
   - the codehash, the time it was attested, and the registry and attester addresses.
5. **What was analyzed** shows that the bytecode matched what's on-chain, plus the compiler, EVM version, optimizer,
   how USDC was found, and the function count.
6. **Live monitor** lists this address's alerts, with every amount shown as the raw integer, its view and USDC.

If a scan can't produce a report, the page says why in plain words. For example:
- "Source isn't verified": the live monitor still covers the contract.
- "Source doesn't match the deployed code": Twelve never reports on code it can't prove is live.
- "The explorer didn't answer": try again in a minute.

---

## 4. Watch live alerts

Open **Alerts** (`/alerts`).

1. Filter by **All / High / Medium / Info**.
2. New alerts appear at the top within seconds. "Streaming new alerts" means the live connection is up.
3. Press **Older alerts** to page back through history.
4. The right column explains each detector:
   - **D1:** the same integer goes in through one view and out through the other in one transaction.
   - **D2:** a dust payout.
   - **D3:** a contract suddenly empties itself.
   - **D4:** an attested proxy was upgraded.
   - **D5:** money is flowing into a contract with open findings.
5. Rows marked **third-party · withheld** are real alerts on someone else's contract. Its address, transaction and
   amounts are hidden until the owner has been told and had time to fix it.

---

## 5. Trigger the bug yourself (optional, costs 0.1 USDC)

This is the demo's main moment, done by hand. You pay LeakyRefund 0.1 USDC, it refunds you natively without
converting, and you get back `0.0000000000001 USDC`. The 0.1 USDC stays locked in the contract for good.

You need [Foundry](https://getfoundry.sh) (`cast`), an Arc mainnet RPC URL, and a wallet holding at least 0.15 USDC.

```bash
export RPC=<your Arc mainnet RPC URL>
export KEY=<your wallet's private key>       # never paste a key you care about into a shared terminal
SHOP=0xA6c15eDC8ceffb558A54ead5bd9d833A589276bC
USDC=0x3600000000000000000000000000000000000000

# 1. allow the shop to take 0.1 USDC (100000 in the ERC-20 view)
cast send $USDC "approve(address,uint256)" $SHOP 100000 --private-key $KEY --rpc-url $RPC

# 2. buy: the shop is sold out, so it refunds you natively, without converting
cast send $SHOP "buy(uint256)" 100000 --private-key $KEY --rpc-url $RPC
```

Then:
1. On the explorer, the transaction shows a native refund of `100000` raw = `0.0000000000001 USDC`.
2. Within about 2 seconds, the site's ticker and `/alerts` show **HIGH · Cross-view raw equality · 0xA6c1…76bC**:
   in `100000` erc20 = 0.1 USDC, out `100000` native = 0.0000000000001 USDC, ratio 10⁻¹².
3. A **Funds into a flagged contract** (INFO) alert also appears, because LeakyRefund is attested with findings.

---

## 6. See the gate refuse a flagged contract

`TwelveGate` forwards native USDC only to contracts the registry lists as CLEAN. These calls are free, read-only checks:

```bash
GATE=0x7a63d663861f84cd0F6F66DE29945620C1Cc95b7
DATA=$(cast calldata "sold()")

# LeakyRefund (FINDINGS): reverts TargetNotClean(target, 2)
cast call $GATE "forward(address,bytes)(bytes)" 0xA6c15eDC8ceffb558A54ead5bd9d833A589276bC $DATA --rpc-url $RPC

# FixedRefund (CLEAN): passes through
cast call $GATE "forward(address,bytes)(bytes)" 0x62e325C4aaB5f3808DCAaFb71d932f4E97455368 $DATA --rpc-url $RPC
```

The same verdict can be read directly from the registry:

```bash
cast call 0x6670030e9df18e3A454eA77d69D00Fd8d17728A1 "status(address,address)(uint8)" \
  0xe98540d28F45830E01D237251Bfc4777E69c9A46 <contract>  --rpc-url $RPC
# 0 NONE · 1 CLEAN · 2 FINDINGS · 3 INCOMPLETE · 4 STALE · 5 REVOKED
```

---

## 7. Verify a report yourself

You don't have to trust Twelve's server. The report is canonical JSON hashed with keccak256, and rerunning the
analyzer on the same verified source gives the same hash that's on-chain.

1. On the contract page, copy the commands from **Check it yourself**. They look like:
   ```bash
   API=<the API URL shown on the page>
   H=<the report hash>
   curl -so report.json "$API/v1/reports/$H"
   uv run twelve verify --report report.json
   ```
2. Run them from a checkout of the Twelve repo (`analyzer/` needs `uv`), with `BLOCKSCOUT_API_KEY` and `ARC_RPC_URL`
   set.
3. Expected output: `MATCH recomputed 0x… claimed 0x…`.
   If it prints `MISMATCH` with a `git checkout …` line, the report was made by a different analyzer commit. Run the
   printed command and verify again.
4. Compare the hash with the one in **On-chain attestation** on the page: it should say *matches this report*.

---

## 8. Use Twelve from your own project

Open **Integrate** (`/integrate`) for copyable code. In short:

1. **In Solidity:** call `isClean(attester, target)` on the registry before sending native USDC. It's true only for
   CLEAN, and only while the target's code is still the code that was scanned.
2. **Without changing your contracts:** send through `TwelveGate.forward{value: …}(target, data)`.
3. **In a wallet or frontend:** `GET <API>/v1/status/<address>?chainId=5042` returns the on-chain verdict, the report
   and recent alerts.
4. **Alerts for your own contract:**
   ```bash
   curl -X POST <API>/v1/subscriptions -H 'content-type: application/json' \
     -d '{"address":"0xYourContract","webhookUrl":"https://example.com/twelve"}'
   ```
   Save the `secret` it returns; it's shown only once. Each alert is POSTed to your URL with `x-twelve-signature`,
   the HMAC-SHA256 of the body under that secret.
5. **Before deploying:** run `uv run --project analyzer twelve scan path/to/contracts --fail-on HIGH` in CI.
6. **Best fix:** type amounts with `Usdc6` / `Usdc18` from `contracts/src/guard/Usdc.sol`. Mixing them then won't
   compile.

---

## 9. Check the evidence

- **Corpus** (`/corpus`) shows how the analyzer is measured: planted bugs, each with a fixed twin that must stay
  clean. Open any case to see the bug next to its fix.
- **Mainnet** (`/sweep`) shows what's been measured on real mainnet contracts: the 15-contract sample and the monitor
  replayed over all of mainnet history. Counts only; contracts under disclosure aren't named.

---

## Quick reference

| What | Address |
|---|---|
| TwelveRegistry | `0x6670030e9df18e3A454eA77d69D00Fd8d17728A1` |
| Twelve attester | `0xe98540d28F45830E01D237251Bfc4777E69c9A46` |
| TwelveGate | `0x7a63d663861f84cd0F6F66DE29945620C1Cc95b7` |
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` |
| LeakyRefund (bug) | `0xA6c15eDC8ceffb558A54ead5bd9d833A589276bC` |
| FixedRefund (fix) | `0x62e325C4aaB5f3808DCAaFb71d932f4E97455368` |
| OverpayVault (guarded) | `0xc2Dc300E524Cb9Ee18887E7c2333D24403dF076A` |
| Explorer | https://explorer.arc.io |
