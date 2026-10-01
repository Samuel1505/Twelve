// Persistence for live ingestion. One window = one transaction (logs_raw, movements, profiles, alerts, checkpoint):
// a crash replays the window idempotently (upserts on natural keys).
import { getAddress, type Address, type Hex } from "viem";
import { toBytes, toHex, type Db } from "@twelve/db";
import { usdc18 } from "@twelve/shared";
import type { RegistryEvent } from "./decode.js";
import type { AttestationView } from "./detectors/context.js";
import { BLOCKS_PER_DAY } from "./detectors/d5.js";
import { dense, sparse, type Profile } from "./profiles.js";
import type { Alert, Movement, TransferLog } from "./types.js";

export const STREAM = "all";
const ZERO = "0x0000000000000000000000000000000000000000";

export type Checkpoint = { block: bigint; hash: Hex };

export async function getCheckpoint(db: Db, chainId: number): Promise<Checkpoint | null> {
  const r = await db.query<{ block: string; block_hash: Buffer }>(
    "SELECT block, block_hash FROM checkpoints WHERE chain_id = $1 AND stream = $2", [chainId, STREAM]);
  const row = r.rows[0];
  return row ? { block: BigInt(row.block), hash: toHex(row.block_hash) } : null;
}

export async function loadProfiles(db: Db, chainId: number, completeHistory: boolean): Promise<Map<Address, Profile>> {
  const r = await db.query<{ address: Buffer; n_out_native: number; n_out_erc20: number; hist_native: number[];
    hist_erc20: number[]; balance_18: string; max_out_frac: number; updated_block: string }>(
    "SELECT * FROM profiles WHERE chain_id = $1", [chainId]);
  const m = new Map<Address, Profile>();
  for (const x of r.rows) {
    const a = getAddress(toHex(x.address));
    m.set(a, { address: a, nOut: { native: x.n_out_native, erc20: x.n_out_erc20 },
      hist: { native: sparse(x.hist_native), erc20: sparse(x.hist_erc20) }, balance18: usdc18(BigInt(x.balance_18)),
      maxOutFrac: x.max_out_frac, updatedBlock: BigInt(x.updated_block), balanceUnderflow: false, completeHistory });
  }
  return m;
}

/** Twelve's attestations (one attester) as the detectors see them; proxies = live records with an implementation. */
export async function loadAttestations(db: Db, chainId: number, attester: Address): Promise<Map<Address, AttestationView>> {
  const r = await db.query<{ target: Buffer; verdict: number; revoked: boolean; implementation: Buffer | null }>(
    "SELECT target, verdict, revoked, implementation FROM attestations WHERE chain_id = $1 AND attester = $2",
    [chainId, toBytes(attester.toLowerCase())]);
  return new Map(r.rows.map((x) => [getAddress(toHex(x.target)), {
    verdict: x.verdict as 1 | 2 | 3, revoked: x.revoked,
    implementation: x.implementation ? getAddress(toHex(x.implementation)) : null }]));
}

export const proxiesOf = (att: ReadonlyMap<Address, AttestationView>): Set<Address> =>
  new Set([...att].filter(([, v]) => !v.revoked && v.implementation !== null).map(([k]) => k));

/** Apply registry events (chain is the truth, REGISTRY §2) to the in-memory view; returns DB writes to perform. */
export function applyRegistry(att: Map<Address, AttestationView>, attester: Address, events: readonly RegistryEvent[]) {
  for (const e of events) {
    if (getAddress(e.attester) !== attester) continue;
    if (e.kind === "Attested") {
      att.set(e.target, { verdict: e.verdict as 1 | 2 | 3, revoked: false,
        implementation: e.implementation === ZERO ? null : e.implementation });
    } else {
      const cur = att.get(e.target);
      if (cur) att.set(e.target, { ...cur, revoked: true });
    }
  }
}

export type WindowWrite = {
  chainId: number;
  checkpoint: Checkpoint;
  transfers: readonly TransferLog[];
  movements: readonly Movement[];
  profiles: readonly Profile[];
  alerts: readonly Alert[];
  registry: readonly RegistryEvent[];
  attester: Address;
};

/** Persist one window atomically. Returns the ids of alerts that were newly inserted (dedupe + cooldown applied). */
export async function persistWindow(db: Db, w: WindowWrite): Promise<{ id: string; alert: Alert }[]> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    if (w.transfers.length) {
      await c.query(
        `INSERT INTO logs_raw (chain_id, block, log_index, block_hash, tx, emitter, topic0, "from", "to", value_raw)
         SELECT $1, * FROM unnest($2::bigint[], $3::int[], $4::bytea[], $5::bytea[], $6::bytea[], $7::bytea[],
           $8::bytea[], $9::bytea[], $10::numeric[]) ON CONFLICT DO NOTHING`,
        [w.chainId, w.transfers.map((t) => t.block.toString()), w.transfers.map((t) => t.logIndex),
          w.transfers.map((t) => toBytes(t.blockHash)), w.transfers.map((t) => toBytes(t.tx)),
          w.transfers.map((t) => toBytes(t.stream === "system" ? "0xfffffffffffffffffffffffffffffffffffffffe"
            : "0x3600000000000000000000000000000000000000")),
          w.transfers.map(() => toBytes("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")),
          w.transfers.map((t) => toBytes(t.from.toLowerCase())), w.transfers.map((t) => toBytes(t.to.toLowerCase())),
          w.transfers.map((t) => t.value.toString())]);
    }
    if (w.movements.length) {
      await c.query(
        `INSERT INTO movements (chain_id, block, tx, idx, erc20_idx, "from", "to", amount_18, iface)
         SELECT $1, * FROM unnest($2::bigint[], $3::bytea[], $4::int[], $5::int[], $6::bytea[], $7::bytea[],
           $8::numeric[], $9::text[]) ON CONFLICT DO NOTHING`,
        [w.chainId, w.movements.map((m) => m.block.toString()), w.movements.map((m) => toBytes(m.tx)),
          w.movements.map((m) => m.idx), w.movements.map((m) => m.erc20Idx),
          w.movements.map((m) => toBytes(m.from.toLowerCase())), w.movements.map((m) => toBytes(m.to.toLowerCase())),
          w.movements.map((m) => m.amount18.toString()), w.movements.map((m) => m.iface)]);
    }
    if (w.profiles.length) {
      await c.query(
        `INSERT INTO profiles (chain_id, address, n_out_native, n_out_erc20, hist_native, hist_erc20, balance_18,
           max_out_frac, updated_block)
         SELECT $1, a, nn, ne, string_to_array(hn, ',')::int[], string_to_array(he, ',')::int[], b, f, u
         FROM unnest($2::bytea[], $3::int[], $4::int[], $5::text[], $6::text[], $7::numeric[], $8::float8[], $9::bigint[])
           AS t(a, nn, ne, hn, he, b, f, u)
         ON CONFLICT (chain_id, address) DO UPDATE SET n_out_native = EXCLUDED.n_out_native,
           n_out_erc20 = EXCLUDED.n_out_erc20, hist_native = EXCLUDED.hist_native, hist_erc20 = EXCLUDED.hist_erc20,
           balance_18 = EXCLUDED.balance_18, max_out_frac = EXCLUDED.max_out_frac, updated_block = EXCLUDED.updated_block`,
        [w.chainId, w.profiles.map((p) => toBytes(p.address.toLowerCase())), w.profiles.map((p) => p.nOut.native),
          w.profiles.map((p) => p.nOut.erc20), w.profiles.map((p) => dense(p.hist.native).join(",")),
          w.profiles.map((p) => dense(p.hist.erc20).join(",")), w.profiles.map((p) => p.balance18.toString()),
          w.profiles.map((p) => p.maxOutFrac), w.profiles.map((p) => p.updatedBlock.toString())]);
    }
    for (const e of w.registry) {
      if (getAddress(e.attester) !== w.attester) continue;
      if (e.kind === "Attested") {
        await c.query(
          `INSERT INTO attestations (chain_id, target, attester, codehash, report_hash, verdict, revoked, tx, block, implementation)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9)
           ON CONFLICT (chain_id, target, attester) DO UPDATE SET codehash = EXCLUDED.codehash,
             report_hash = EXCLUDED.report_hash, verdict = EXCLUDED.verdict, revoked = false, tx = EXCLUDED.tx,
             block = EXCLUDED.block, implementation = EXCLUDED.implementation, updated_at = now()`,
          [w.chainId, toBytes(e.target.toLowerCase()), toBytes(e.attester.toLowerCase()), toBytes(e.codehash),
            toBytes(e.reportHash), e.verdict, toBytes(e.tx), e.block.toString(),
            e.implementation === ZERO ? null : toBytes(e.implementation.toLowerCase())]);
      } else {
        await c.query("UPDATE attestations SET revoked = true, updated_at = now() WHERE chain_id = $1 AND target = $2 AND attester = $3",
          [w.chainId, toBytes(e.target.toLowerCase()), toBytes(e.attester.toLowerCase())]);
      }
    }
    const inserted: { id: string; alert: Alert }[] = [];
    for (const a of w.alerts) {
      if ((a.severity === "MEDIUM" || a.severity === "INFO") && a.address && a.block !== null) {
        // per-address cooldown (MONITOR §6): one MEDIUM/INFO per detector per address per day of blocks
        const recent = await c.query("SELECT 1 FROM alerts WHERE chain_id = $1 AND detector = $2 AND address = $3 AND block > $4 LIMIT 1",
          [w.chainId, a.detector, toBytes(a.address.toLowerCase()), (a.block - BLOCKS_PER_DAY).toString()]);
        if (recent.rowCount) continue;
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO alerts (chain_id, detector, severity, address, tx, block, evidence, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [w.chainId, a.detector, a.severity, a.address ? toBytes(a.address.toLowerCase()) : null,
          a.tx ? toBytes(a.tx) : null, a.block?.toString() ?? null, JSON.stringify(a.evidence), a.dedupeKey]);
      const id = r.rows[0]?.id;
      if (!id) continue;
      inserted.push({ id, alert: a });
      if (a.address) {
        await c.query(`INSERT INTO deliveries (alert_id, subscription_id)
                       SELECT $1, id FROM subscriptions WHERE address = $2 ON CONFLICT DO NOTHING`,
          [id, toBytes(a.address.toLowerCase())]);
      }
      await c.query("SELECT pg_notify('twelve_alerts', $1)", [id]);
    }
    await c.query(
      `INSERT INTO checkpoints (chain_id, stream, block, block_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (chain_id, stream) DO UPDATE SET block = EXCLUDED.block, block_hash = EXCLUDED.block_hash, updated_at = now()`,
      [w.chainId, STREAM, w.checkpoint.block.toString(), toBytes(w.checkpoint.hash)]);
    await c.query("COMMIT");
    return inserted;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Ops alert outside a window (continuity halt etc.). */
export async function opsAlert(db: Db, chainId: number, a: Alert): Promise<void> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO alerts (chain_id, detector, severity, address, tx, block, evidence, dedupe_key)
     VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [chainId, a.detector, a.severity, a.block?.toString() ?? null, JSON.stringify(a.evidence), a.dedupeKey]);
  if (r.rows[0]) await db.query("SELECT pg_notify('twelve_alerts', $1)", [r.rows[0].id]);
}
