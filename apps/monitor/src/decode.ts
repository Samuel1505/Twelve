// Raw eth_getLogs entries → typed events. Classification is by (emitter, topic0) together: a watched proxy may be a
// token emitting Transfer, which must never be read as a USDC movement.
import { decodeEventLog, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { SYSTEM_EMITTER, TRANSFER_TOPIC, UPGRADED_TOPIC, USDC_ERC20, twelveRegistryAbi } from "@twelve/shared";
import type { UpgradeLog } from "./detectors/d4.js";
import type { TransferLog } from "./types.js";

export const BEACON_UPGRADED_TOPIC = keccak256(toHex("BeaconUpgraded(address)"));
export const ATTESTED_TOPIC = keccak256(toHex("Attested(address,address,bytes32,bytes32,uint8,uint16,uint16,address)"));
export const REVOKED_TOPIC = keccak256(toHex("Revoked(address,address,bytes32)"));

export type RpcLog = {
  address: Hex; topics: Hex[]; data: Hex; blockNumber: Hex; blockHash: Hex; transactionHash: Hex;
  transactionIndex: Hex; logIndex: Hex; removed?: boolean;
};

export type RegistryEvent =
  | { kind: "Attested"; block: bigint; tx: Hex; logIndex: number; attester: Address; target: Address; reportHash: Hex;
      codehash: Hex; verdict: number; implementation: Address }
  | { kind: "Revoked"; block: bigint; tx: Hex; logIndex: number; attester: Address; target: Address; reason: Hex };

export type Decoded = { transfers: TransferLog[]; registry: RegistryEvent[]; upgrades: UpgradeLog[] };

const SYSTEM = getAddress(SYSTEM_EMITTER);
const ERC20 = getAddress(USDC_ERC20);
const topicAddr = (t: Hex | undefined): Address => getAddress(`0x${(t ?? "0x").slice(-40)}`);

export function decodeLogs(chainId: number, logs: readonly RpcLog[], registry: Address | null,
  proxies: ReadonlySet<Address>): Decoded {
  const out: Decoded = { transfers: [], registry: [], upgrades: [] };
  for (const l of logs) {
    if (l.removed) continue; // deterministic finality: never expected (I9); ignore defensively
    const emitter = getAddress(l.address);
    const t0 = l.topics[0];
    const base = { block: BigInt(l.blockNumber), tx: l.transactionHash, logIndex: Number(l.logIndex) };
    if (t0 === TRANSFER_TOPIC && (emitter === SYSTEM || emitter === ERC20) && l.topics.length === 3) {
      out.transfers.push({
        stream: emitter === SYSTEM ? "system" : "erc20", ...base, blockHash: l.blockHash,
        txIndex: Number(l.transactionIndex), from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), value: BigInt(l.data),
      });
    } else if (registry && emitter === registry && (t0 === ATTESTED_TOPIC || t0 === REVOKED_TOPIC)) {
      const ev = decodeEventLog({ abi: twelveRegistryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "Attested") {
        out.registry.push({ kind: "Attested", ...base, attester: ev.args.attester, target: ev.args.target,
          reportHash: ev.args.reportHash, codehash: ev.args.codehash, verdict: ev.args.verdict,
          implementation: ev.args.implementation });
      } else if (ev.eventName === "Revoked") {
        out.registry.push({ kind: "Revoked", ...base, attester: ev.args.attester, target: ev.args.target, reason: ev.args.reason });
      }
    } else if ((t0 === UPGRADED_TOPIC || t0 === BEACON_UPGRADED_TOPIC) && proxies.has(emitter) && l.topics.length >= 2) {
      out.upgrades.push({ chainId, ...base, proxy: emitter, newImplementation: topicAddr(l.topics[1]),
        kind: t0 === UPGRADED_TOPIC ? "Upgraded" : "BeaconUpgraded" });
    }
  }
  return out;
}

export function logFilter(registry: Address | null, proxies: ReadonlySet<Address>) {
  return {
    address: [SYSTEM, ERC20, ...(registry ? [registry] : []), ...[...proxies].sort()],
    topics: [[TRANSFER_TOPIC, ATTESTED_TOPIC, REVOKED_TOPIC, UPGRADED_TOPIC, BEACON_UPGRADED_TOPIC]],
  };
}
