// Fact: provider's eth_getLogs max block range and result cap (ARC_LEDGER §7).
// Binary-searches the largest [head-N, head] range the provider accepts for the system-emitter Transfer filter.
// Usage: tsx getlogs-range.ts [--net testnet] [--max 1048576]
import { SYSTEM_EMITTER, TRANSFER_TOPIC } from "@twelve/shared";
import { client, finish, info, netArg, report } from "./lib.ts";

const net = netArg();
const c = client(net);
const mIdx = process.argv.indexOf("--max");
const MAX = BigInt(mIdx >= 0 ? process.argv[mIdx + 1] ?? "1048576" : "1048576");
const head = await c.getBlockNumber();
const errors = new Map<string, bigint>();

async function tryRange(n: bigint): Promise<{ ok: boolean; count?: number; err?: string }> {
  const fromBlock = head - n + 1n < 0n ? 0n : head - n + 1n;
  for (let attempt = 0; ; attempt++) {
    try {
      const logs = await c.request({ method: "eth_getLogs", params: [{ address: SYSTEM_EMITTER, topics: [TRANSFER_TOPIC], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${head.toString(16)}` }] });
      return { ok: true, count: (logs as unknown[]).length };
    } catch (e) {
      const msg = ((e as { details?: string }).details ?? (e as Error).message).split("\n")[0] ?? "";
      if (/429|rate|too many requests/i.test(msg) && attempt < 5) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
      return { ok: false, err: msg };
    }
  }
}

// Exponential probe then binary search on the boundary.
let lo = 0n, hi = 0n;
for (let n = 1n; n <= MAX; n *= 2n) {
  const r = await tryRange(n);
  if (r.ok) { lo = n; info(`range ${n}`, `ok, ${r.count} logs`); } else { hi = n; errors.set(r.err!, n); info(`range ${n}`, `rejected: ${r.err}`); break; }
}
if (hi === 0n) {
  report(true, `eth_getLogs accepts ≥ ${lo} blocks on ${net}`, `no rejection up to --max ${MAX}`);
} else {
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const r = await tryRange(mid);
    if (r.ok) lo = mid; else { hi = mid; errors.set(r.err!, mid); }
  }
  report(lo > 0n, `eth_getLogs max block range on ${net}`, `max accepted = ${lo}, first rejected = ${hi}`);
  for (const [msg, n] of errors) info("rejection message", `@${n}: ${msg}`);
  info("interpretation", "if the message mentions results/response size, the cap is on result count, not block span — rerun on a quieter window");
}
finish();
