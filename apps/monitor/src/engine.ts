// Per-tx processing shared by live ingestion and replay: pair → detectors (pre-tx snapshot) → profile updates.
import type { Address } from "viem";
import { d1 } from "./detectors/d1.js";
import { d2 } from "./detectors/d2.js";
import { d3 } from "./detectors/d3.js";
import { d5 } from "./detectors/d5.js";
import type { AttestationView, TxContext } from "./detectors/context.js";
import { pairTx } from "./pair.js";
import { applyTx, emptyProfile, type Profile } from "./profiles.js";
import { ZERO_ADDRESS, type Alert, type Movement, type TransferLog } from "./types.js";

export type Account = { isContract: boolean; delegated: boolean };

export type EngineState = {
  chainId: number;
  profiles: Map<Address, Profile>; // every address that moved USDC (ADR-020)
  attestations: Map<Address, AttestationView>;
  /** true when ingestion started at genesis: new profiles then have exact balances (MONITOR §1 backfill). */
  completeHistory: boolean;
};

/** Detectors whose subject must be a contract; their candidates are filtered by `onlyContracts`. */
const CONTRACT_DETECTORS = new Set(["D1", "D2", "D3", "D5", "BALANCE"]);

export type BatchResult = { movements: Movement[]; alerts: Alert[]; changed: Set<Address> };

/** Group logs by tx in chain order (block, txIndex), each group in logIndex order. */
export function groupByTx(logs: readonly TransferLog[]): TransferLog[][] {
  const sorted = [...logs].sort((a, b) =>
    a.block === b.block ? (a.txIndex === b.txIndex ? a.logIndex - b.logIndex : a.txIndex - b.txIndex)
      : a.block < b.block ? -1 : 1);
  const groups: TransferLog[][] = [];
  for (const l of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.tx === l.tx) last.push(l);
    else groups.push([l]);
  }
  return groups;
}

export function addressesOf(logs: readonly TransferLog[]): Address[] {
  const s = new Set<Address>();
  for (const l of logs) {
    s.add(l.from);
    s.add(l.to);
  }
  return [...s];
}

export function processBatch(state: EngineState, logs: readonly TransferLog[]): BatchResult {
  const out: BatchResult = { movements: [], alerts: [], changed: new Set() };
  for (const txLogs of groupByTx(logs)) {
    const first = txLogs[0];
    if (!first) continue;
    const { movements, unpaired } = pairTx(txLogs);
    for (const u of unpaired) {
      out.alerts.push({
        detector: "PAIRING", severity: "OPS", address: null, tx: u.tx, block: u.block,
        evidence: { note: "ERC-20 log without a system twin (ARC_LEDGER §2.1)", logIndex: u.logIndex,
          from: u.from, to: u.to, raw6: u.value.toString() },
        dedupeKey: `PAIRING:${state.chainId}:${u.tx}:${u.logIndex}`,
      });
    }
    out.movements.push(...movements);
    if (movements.length === 0) continue;
    const ctx: TxContext = {
      chainId: state.chainId, block: first.block, tx: first.tx, movements,
      profile: (a) => state.profiles.get(a), attestation: (a) => state.attestations.get(a),
    };
    const a1 = d1(ctx);
    out.alerts.push(...a1, ...d2(ctx), ...d3(ctx, new Set(a1.map((a) => a.address ?? ""))), ...d5(ctx));

    // profiles after detection: detectors judged this tx against history *before* it
    const touched = new Set<Address>();
    for (const m of movements) for (const a of [m.from, m.to]) if (a !== ZERO_ADDRESS) touched.add(a);
    for (const a of touched) {
      const prev = state.profiles.get(a) ?? emptyProfile(a, first.block, state.completeHistory);
      const next = applyTx(prev, movements.filter((m) => m.from === a || m.to === a), first.block);
      if (next.balanceUnderflow && !prev.balanceUnderflow && next.completeHistory) {
        out.alerts.push({
          detector: "BALANCE", severity: "OPS", address: a, tx: first.tx, block: first.block,
          evidence: { note: "movements imply a negative balance: profile history incomplete" },
          dedupeKey: `BALANCE:${state.chainId}:${a}`,
        });
      }
      state.profiles.set(a, next);
      out.changed.add(a);
    }
  }
  return out;
}

/** Keep alerts whose subject is a contract (or 7702-delegated EOA). Resolves only the candidates, with a cache. */
export async function onlyContracts(alerts: readonly Alert[],
  resolve: (a: readonly Address[]) => Promise<void>, account: (a: Address) => Account | undefined): Promise<Alert[]> {
  const need = [...new Set(alerts.filter((a) => CONTRACT_DETECTORS.has(a.detector) && a.address).map((a) => a.address!))];
  if (need.length) await resolve(need);
  return alerts.filter((a) => !CONTRACT_DETECTORS.has(a.detector) || !a.address || account(a.address)?.isContract === true);
}
