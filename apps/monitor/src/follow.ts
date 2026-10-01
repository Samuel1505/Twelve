// Live ingestion (MONITOR §1): checkpointed windows, continuity check (I9: halt loudly, no reorg handling), registry
// sync, D4 auto-revoke, detectors, atomic persistence, then side effects (revoke, notify) after commit.
import type { Address, Hex, PublicClient } from "viem";
import type { Db } from "@twelve/db";
import { Accounts } from "./accounts.js";
import { decodeLogs, logFilter } from "./decode.js";
import { d4 } from "./detectors/d4.js";
import { onlyContracts, processBatch, type EngineState } from "./engine.js";
import { getLogsAdaptive } from "./ingest/fetch.js";
import type { Revoker } from "./revoker.js";
import { applyRegistry, opsAlert, persistWindow, proxiesOf, type Checkpoint } from "./store.js";
import type { Alert } from "./types.js";

export class ContinuityError extends Error {}

export type FollowDeps = {
  db: Db;
  client: PublicClient;
  chainId: number;
  registry: Address | null;
  attester: Address;
  state: EngineState;
  accounts: Accounts;
  revoke: Revoker | null;
  window: bigint;
  onAlert?: (a: Alert) => void;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

/** Process the next window. Returns the new checkpoint, or the same one when already at head. */
export async function step(d: FollowDeps, cp: Checkpoint): Promise<{ cp: Checkpoint; head: bigint; alerts: number }> {
  const head = await d.client.getBlockNumber();
  if (head <= cp.block) return { cp, head, alerts: 0 };
  const from = cp.block + 1n;
  const to = head < cp.block + d.window ? head : cp.block + d.window;

  // continuity (I9): the first new block must extend the checkpointed hash
  const first = await d.client.getBlock({ blockNumber: from });
  if (cp.block >= 0n && first.parentHash !== cp.hash) {
    const err = `parentHash of block ${from} is ${first.parentHash}, checkpoint ${cp.block} is ${cp.hash}`;
    await opsAlert(d.db, d.chainId, { detector: "CONTINUITY", severity: "OPS", address: null, tx: null, block: from,
      evidence: { note: "continuity violated: ingestion halted (I9)", detail: err }, dedupeKey: `CONTINUITY:${d.chainId}:${from}` });
    throw new ContinuityError(err);
  }
  const last = to === from ? first : await d.client.getBlock({ blockNumber: to });

  const proxies = proxiesOf(d.state.attestations);
  const raw = await getLogsAdaptive(d.client, logFilter(d.registry, proxies), from, to);
  const dec = decodeLogs(d.chainId, raw, d.registry, proxies);

  // registry first: an attestation in this window governs D4/D5 for later logs (≤ 1 window delay, MONITOR §7)
  applyRegistry(d.state.attestations, d.attester, dec.registry);

  const alerts: Alert[] = [];
  const revokes: Address[] = [];
  for (const u of dec.upgrades) {
    const r = d4(u, d.state.attestations.get(u.proxy));
    if (r) {
      alerts.push(r.alert);
      revokes.push(u.proxy);
    }
  }
  const batch = processBatch(d.state, dec.transfers);
  alerts.push(...await onlyContracts(batch.alerts, (xs) => d.accounts.resolve(xs), (x) => d.accounts.map.get(x)));

  const newCp = { block: to, hash: last.hash as Hex };
  const inserted = await persistWindow(d.db, {
    chainId: d.chainId, checkpoint: newCp, transfers: dec.transfers, movements: batch.movements,
    profiles: [...batch.changed].map((a) => d.state.profiles.get(a)!), alerts, registry: dec.registry, attester: d.attester,
  });

  // side effects strictly after commit: a crash before here replays the window idempotently
  for (const proxy of new Set(revokes)) {
    if (!d.revoke) {
      d.log("D4: no revoker configured", { proxy });
      continue;
    }
    const r = await d.revoke(d.chainId, proxy);
    d.log(r.ok ? "D4: revoked" : "D4: revoke failed", { proxy, ...r });
    if (r.ok) {
      const cur = d.state.attestations.get(proxy);
      if (cur) d.state.attestations.set(proxy, { ...cur, revoked: true });
    }
  }
  for (const { alert } of inserted) d.onAlert?.(alert);
  return { cp: newCp, head, alerts: inserted.length };
}

export async function follow(d: FollowDeps, start: Checkpoint, pollMs: number, signal?: AbortSignal): Promise<never> {
  let cp = start;
  for (;;) {
    if (signal?.aborted) throw new Error("aborted");
    const r = await step(d, cp);
    if (r.cp.block !== cp.block && (r.alerts || r.cp.block % 1000n === 0n || r.head - r.cp.block < 2n)) {
      d.log("window", { to: r.cp.block.toString(), head: r.head.toString(), lag: (r.head - r.cp.block).toString(), alerts: r.alerts });
    }
    if (r.cp.block === cp.block || r.head === r.cp.block) await new Promise((res) => setTimeout(res, pollMs));
    cp = r.cp;
  }
}
