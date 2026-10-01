// Adaptive eth_getLogs (ARC_LEDGER §3): Infura caps a call at 10,000 blocks AND 20,000 results / a response size;
// it names the range to retry with. We follow its hint, else halve. Fixed windows would fail near head.
import type { PublicClient } from "viem";
import type { RpcLog } from "../decode.js";

export type LogFilter = { address: string[]; topics: string[][] };

const HINT = /retry with the range (\d+)-(\d+)/;
const TOO_BIG = /exceeds max results|size limit|response body exceeded|too large|limited to a 10,000 range|ranges over|timed? ?out|took too long|deadline/i;
export const WINDOW_DEADLINE_MS = 45_000;

/** Reject if `p` does not settle within `ms` (a hung request must split, never stall ingestion). */
function deadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`eth_getLogs deadline: timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Full text of an error and its cause chain (viem wraps provider messages), with URLs redacted: provider URLs
 *  carry API keys and must never reach logs (I11). */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 8; i++) {
    const x = cur as { message?: string; details?: string; shortMessage?: string; cause?: unknown };
    for (const s of [x.shortMessage, x.details, x.message]) if (s) parts.push(s);
    cur = x.cause;
  }
  return parts.join(" | ").replace(/https?:\/\/[^\s"']+/g, "<rpc-url>");
}

export async function getLogsAdaptive(client: PublicClient, filter: LogFilter, from: bigint, to: bigint,
  attempt = 0): Promise<RpcLog[]> {
  try {
    return (await deadline(client.request({
      method: "eth_getLogs",
      params: [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] as never,
    }, { retryCount: 1 }), WINDOW_DEADLINE_MS)) as unknown as RpcLog[];
  } catch (e) {
    const msg = errorText(e);
    if (TOO_BIG.test(msg) && to > from) {
      const hint = HINT.exec(msg);
      let mid = (from + to) / 2n;
      if (hint) {
        const end = BigInt(hint[2] ?? "0");
        if (end >= from && end < to) mid = end;
      }
      const left = await getLogsAdaptive(client, filter, from, mid);
      const right = await getLogsAdaptive(client, filter, mid + 1n, to);
      return [...left, ...right];
    }
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
      return getLogsAdaptive(client, filter, from, to, attempt + 1);
    }
    throw new Error(`eth_getLogs [${from}, ${to}] failed: ${msg.slice(0, 400)}`);
  }
}
