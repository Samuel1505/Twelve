// Is-contract resolution with a DB-backed cache (one getCode per address, ever). 7702-delegated EOAs are profiled as
// contracts with a flag (MONITOR §3, gotcha #9). Code is read at latest: a later self-destruct makes an address an EOA.
import { getAddress, type Address, type PublicClient } from "viem";
import { toBytes, toHex, type Db } from "@twelve/db";
import type { Account } from "./engine.js";

const DELEGATION_PREFIX = "0xef0100";

export class Accounts {
  readonly map = new Map<Address, Account>();
  lastError: string | null = null;
  constructor(private readonly chainId: number, private readonly client: PublicClient, private readonly db: Db | null) {}

  async load(): Promise<void> {
    if (!this.db) return;
    const r = await this.db.query<{ address: Buffer; is_contract: boolean; delegated: boolean }>(
      "SELECT address, is_contract, delegated FROM accounts WHERE chain_id = $1", [this.chainId]);
    for (const row of r.rows) {
      this.map.set(getAddress(toHex(row.address)), { isContract: row.is_contract, delegated: row.delegated });
    }
  }

  /** Resolve every unknown address; concurrency-limited batches (the transport batches JSON-RPC calls). */
  async resolve(addresses: readonly Address[]): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const missing = addresses.filter((a) => !this.map.has(a));
      if (missing.length === 0) return;
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      await this.#resolveOnce(missing);
    }
    const left = addresses.filter((a) => !this.map.has(a));
    if (left.length) {
      throw new Error(`could not resolve code for ${left.length} addresses (e.g. ${left[0]}); last error: ${this.lastError}`);
    }
  }

  async #resolveOnce(unknown: readonly Address[]): Promise<void> {
    const found: [Address, Account][] = [];
    for (let i = 0; i < unknown.length; i += 25) { // 25 concurrent getCode requests per round
      const chunk = unknown.slice(i, i + 25);
      const codes = await Promise.all(chunk.map((address) => this.client.getCode({ address }).catch((e: unknown) => {
        this.lastError = String((e as { shortMessage?: string; message?: string }).shortMessage ?? e).slice(0, 160);
        return undefined;
      })));
      chunk.forEach((a, j) => {
        const code = codes[j];
        if (code === undefined) return; // transient failure: retry next batch, never guess
        const delegated = code.startsWith(DELEGATION_PREFIX) && code.length === 2 + 46;
        const acc = { isContract: code !== "0x" && code.length > 2, delegated };
        this.map.set(a, acc);
        found.push([a, acc]);
      });
    }
    if (this.db && found.length) {
      await this.db.query(
        `INSERT INTO accounts (chain_id, address, is_contract, delegated)
         SELECT $1, * FROM unnest($2::bytea[], $3::bool[], $4::bool[]) ON CONFLICT DO NOTHING`,
        [this.chainId, found.map(([a]) => toBytes(a)), found.map(([, x]) => x.isContract), found.map(([, x]) => x.delegated)]);
    }
  }
}
