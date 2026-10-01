// Per-tx processing shared by live ingestion and replay: pair → detectors (pre-tx snapshot) → profile updates.
import type { Address } from "viem";
import { d1 } from "./detectors/d1.js";
import { d2 } from "./detectors/d2.js";
import { d3 } from "./detectors/d3.js";
import { d5 } from "./detectors/d5.js";
import type { AttestationView, TxContext } from "./detectors/context.js";
import { pairTx } from "./pair.js";
import { applyTx, emptyProfile, type Profile } from "./profiles.js";
import type { Alert, Movement, TransferLog } from "./types.js";

export type Account = { isContract: boolean; delegated: boolean };

export type EngineState = {
  chainId: number;
  profiles: Map<Address, Profile>;
  accounts: Map<Address, Account>; // must be resolved for every address in the batch before processing
  attestations: Map<Address, AttestationView>;
};

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
  const isContract = (a: Address) => state.accounts.get(a)?.isContract ?? false;
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
      chainId: state.chainId, block: first.block, tx: first.tx, movements, isContract,
      profile: (a) => state.profiles.get(a), attestation: (a) => state.attestations.get(a),
    };
    const a1 = d1(ctx);
    out.alerts.push(...a1, ...d2(ctx), ...d3(ctx, new Set(a1.map((a) => a.address ?? ""))), ...d5(ctx));

    // profiles after detection: detectors judged this tx against history *before* it
    const touched = new Set<Address>();
    for (const m of movements) for (const a of [m.from, m.to]) if (isContract(a)) touched.add(a);
    for (const a of touched) {
      const acc = state.accounts.get(a)!;
      const prev = state.profiles.get(a) ?? emptyProfile(a, true, acc.delegated, first.block);
      const next = applyTx(prev, movements.filter((m) => m.from === a || m.to === a), first.block);
      if (next.balanceUnderflow && !prev.balanceUnderflow) {
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
