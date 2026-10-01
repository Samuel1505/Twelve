// Adaptive eth_getLogs (ARC_LEDGER §3): Infura caps a call at 10,000 blocks AND 20,000 results / a response size;
// it names the range to retry with. We follow its hint, else halve. Fixed windows would fail near head.
import type { PublicClient } from "viem";
import type { RpcLog } from "../decode.js";

export type LogFilter = { address: string[]; topics: string[][] };

const HINT = /retry with the range (\d+)-(\d+)/;
const TOO_BIG = /exceeds max results|size limit|response body exceeded|too large|limited to a 10,000 range|ranges over/i;

export async function getLogsAdaptive(client: PublicClient, filter: LogFilter, from: bigint, to: bigint,
  attempt = 0): Promise<RpcLog[]> {
  try {
    return (await client.request({
      method: "eth_getLogs",
      params: [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] as never,
    })) as unknown as RpcLog[];
  } catch (e) {
    const msg = e instanceof Error ? `${e.message} ${(e as { details?: string }).details ?? ""}` : String(e);
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
    throw e;
  }
}
