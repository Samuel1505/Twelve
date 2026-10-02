// Attester (docs/REGISTRY.md §6, ARCHITECTURE §2.3): the only process that signs. Single writer per chain,
// allowlisted calls only, simulate-then-write, balance watchdog. Holds ATTESTER_PRIVATE_KEY, never the deployer key.
import {
  createWalletClient, encodeFunctionData, http, stringToHex, type Address, type Hex, type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { twelveRegistryAbi, formatUsdc18, usdc18, type Usdc18 } from "@twelve/shared";
import { chainOf, codehashOf } from "./chain.js";
import type { ChainId } from "./config.js";
import { err, ok, type Result } from "./result.js";
import { redact } from "./redact.js";

export type AttestRequest = {
  target: Address;
  codehash: Hex;
  reportHash: Hex;
  verdict: 1 | 2 | 3;
  high: number;
  medium: number;
  implementation: Address | null;
  implCodehash: Hex | null;
  schemaVersion: number;
  toolVersion: string; // e.g. twelve/0.1.0+abcdef1 (fits bytes32)
};

export type AttestErrorCode = "CODE_CHANGED" | "LOW_BALANCE" | "BLOCKLISTED" | "REVERTED" | "RPC" | "NOT_CONFIGURED";
export type AttestError = { code: AttestErrorCode; retryable: boolean; message: string };
export type TxResult = { tx: Hex; block: bigint };

export interface Attester {
  readonly address: Address;
  attest(chainId: ChainId, req: AttestRequest): Promise<Result<TxResult, AttestError>>;
  revoke(chainId: ChainId, target: Address, reason: string): Promise<Result<TxResult, AttestError>>;
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"0".repeat(64)}` as const;

/** Serializes async work: one in-flight transaction per chain (nonce safety). */
class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(fn, fn);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

type ChainCtx = { pub: PublicClient; wallet: WalletClient; registry: Address; queue: SerialQueue; nonce: number | null };

export type AttesterDeps = {
  privateKey: Hex;
  registry: Address;
  minBalance: Usdc18;
  clients: Partial<Record<ChainId, { pub: PublicClient; rpcUrl: string }>>;
  log?: (level: "info" | "error", msg: string, extra?: Record<string, unknown>) => void;
};

export function makeAttester(d: AttesterDeps): Attester {
  const account = privateKeyToAccount(d.privateKey);
  const log = d.log ?? ((level, msg, extra) => console[level === "error" ? "error" : "log"](JSON.stringify({ level, msg, ...extra })));
  const ctx = new Map<ChainId, ChainCtx>();
  for (const [k, c] of Object.entries(d.clients)) {
    if (!c) continue;
    const id = Number(k) as ChainId;
    ctx.set(id, {
      pub: c.pub,
      wallet: createWalletClient({ account, chain: chainOf(id), transport: http(c.rpcUrl) }),
      registry: d.registry,
      queue: new SerialQueue(),
      nonce: null,
    });
  }

  function classify(e: unknown): AttestError {
    const msg = redact(e instanceof Error ? e.message : String(e));
    if (/blocklist|blacklist/i.test(msg)) return { code: "BLOCKLISTED", retryable: false, message: msg.slice(0, 300) };
    if (/revert|CodehashMismatch|TargetHasNoCode|InvalidVerdict|NothingToRevoke/i.test(msg)) {
      return { code: "REVERTED", retryable: false, message: msg.slice(0, 300) };
    }
    return { code: "RPC", retryable: true, message: msg.slice(0, 300) };
  }

  async function send(id: ChainId, data: Hex, simulate: () => Promise<unknown>): Promise<Result<TxResult, AttestError>> {
    const c = ctx.get(id);
    if (!c) return err({ code: "NOT_CONFIGURED", retryable: false, message: `no RPC for chain ${id}` });
    return c.queue.run(async () => {
      try {
        const bal = usdc18(await c.pub.getBalance({ address: account.address }));
        if (bal < d.minBalance) {
          log("error", "attester balance below floor", { chainId: id, balance: formatUsdc18(bal), floor: formatUsdc18(d.minBalance) });
          return err({ code: "LOW_BALANCE", retryable: true, message: `attester balance ${formatUsdc18(bal)} USDC below floor` });
        }
        await simulate();
        c.nonce ??= await c.pub.getTransactionCount({ address: account.address, blockTag: "pending" });
        // allowlist: the only destination is the registry, the only calldata attest/revoke built above
        const hash = await c.wallet.sendTransaction({ account, chain: chainOf(id), to: c.registry, data, nonce: c.nonce });
        c.nonce += 1;
        const receipt = await c.pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (receipt.status !== "success") return err({ code: "REVERTED", retryable: false, message: `tx ${hash} reverted` });
        return ok({ tx: hash, block: receipt.blockNumber });
      } catch (e) {
        c.nonce = null; // resync from chain on the next send
        const ae = classify(e);
        log("error", "attester send failed", { chainId: id, code: ae.code, message: ae.message });
        return err(ae);
      }
    });
  }

  return {
    address: account.address,
    async attest(id, r) {
      const c = ctx.get(id);
      if (!c) return err({ code: "NOT_CONFIGURED", retryable: false, message: `no RPC for chain ${id}` });
      const now = await codehashOf(c.pub, r.target);
      if (now !== r.codehash) {
        return err({ code: "CODE_CHANGED", retryable: true, message: `codehash now ${now ?? "none"}, scanned ${r.codehash}` });
      }
      const args = [
        r.target, r.codehash, r.reportHash, r.verdict, r.high, r.medium, r.implementation ?? ZERO,
        r.implCodehash ?? ZERO32, r.schemaVersion, stringToHex(r.toolVersion, { size: 32 }),
      ] as const;
      const data = encodeFunctionData({ abi: twelveRegistryAbi, functionName: "attest", args });
      return send(id, data, () =>
        c.pub.simulateContract({ account, address: c.registry, abi: twelveRegistryAbi, functionName: "attest", args }));
    },
    async revoke(id, target, reason) {
      const c = ctx.get(id);
      if (!c) return err({ code: "NOT_CONFIGURED", retryable: false, message: `no RPC for chain ${id}` });
      const args = [target, stringToHex(reason, { size: 32 })] as const;
      const data = encodeFunctionData({ abi: twelveRegistryAbi, functionName: "revoke", args });
      return send(id, data, () =>
        c.pub.simulateContract({ account, address: c.registry, abi: twelveRegistryAbi, functionName: "revoke", args }));
    },
  };
}
