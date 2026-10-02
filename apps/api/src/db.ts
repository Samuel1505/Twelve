import { z } from "zod";
import type { Hex } from "viem";
import { connect, migrate, toBytes, toHex, type Db } from "@twelve/db";

export { connect, migrate, toBytes, toHex, type Db };

const hexCol = z.instanceof(Buffer).transform(toHex);
const hexColNull = hexCol.nullable();

export const ScanRow = z.object({
  id: z.string().uuid(),
  chain_id: z.number().int(),
  address: hexCol,
  codehash: hexColNull,
  state: z.string(),
  error: z.unknown().nullable(),
  report_hash: hexColNull,
  attest_tx: hexColNull,
  created_at: z.date(),
  updated_at: z.date(),
});
export type ScanRow = z.infer<typeof ScanRow>;

export const ScanEventRow = z.object({
  stage: z.string(),
  started_at: z.date(),
  ended_at: z.date().nullable(),
  error: z.unknown().nullable(),
});

export const ReportRow = z.object({
  report_hash: hexCol,
  address: hexColNull, // null for source-mode reports
  verdict: z.string(),
  tool_version: z.string(),
  core_jcs: z.string(),
  meta: z.record(z.string(), z.unknown()),
  created_at: z.date(),
});

export async function insertScan(db: Db, chainId: number, address: Hex): Promise<string> {
  const r = await db.query<{ id: string }>(
    "INSERT INTO scans (chain_id, address, state) VALUES ($1, $2, 'QUEUED') RETURNING id",
    [chainId, toBytes(address.toLowerCase())],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("insert scan returned no id");
  return id;
}

export async function getScan(db: Db, id: string): Promise<ScanRow | null> {
  const r = await db.query("SELECT * FROM scans WHERE id = $1", [id]);
  return r.rows[0] ? ScanRow.parse(r.rows[0]) : null;
}

export async function scanEvents(db: Db, id: string): Promise<z.infer<typeof ScanEventRow>[]> {
  const r = await db.query("SELECT stage, started_at, ended_at, error FROM scan_events WHERE scan_id = $1 ORDER BY id", [id]);
  return r.rows.map((x) => ScanEventRow.parse(x));
}

export async function setState(
  db: Db,
  id: string,
  state: string,
  patch: { codehash?: Hex; reportHash?: Hex; attestTx?: Hex; error?: unknown } = {},
): Promise<void> {
  await db.query(
    `UPDATE scans SET state = $2, updated_at = now(),
       codehash = COALESCE($3, codehash), report_hash = COALESCE($4, report_hash),
       attest_tx = COALESCE($5, attest_tx), error = COALESCE($6, error)
     WHERE id = $1`,
    [
      id,
      state,
      patch.codehash ? toBytes(patch.codehash) : null,
      patch.reportHash ? toBytes(patch.reportHash) : null,
      patch.attestTx ? toBytes(patch.attestTx) : null,
      patch.error === undefined ? null : JSON.stringify(patch.error),
    ],
  );
  await db.query("UPDATE scan_events SET ended_at = now() WHERE scan_id = $1 AND ended_at IS NULL", [id]);
  await db.query("INSERT INTO scan_events (scan_id, stage, error, ended_at) VALUES ($1, $2, $3, $4)", [
    id,
    state,
    patch.error === undefined ? null : JSON.stringify(patch.error),
    TERMINAL.has(state) ? new Date() : null,
  ]);
}

export const TERMINAL = new Set([
  "DONE", "NOT_A_CONTRACT", "UNSUPPORTED", "NOT_VERIFIED", "MATCH_FAILED", "COMPILE_FAILED", "ANALYZER_ERROR",
  "ATTEST_FAILED", "CHAIN_MISMATCH", "FETCH_FAILED", "CONFIG", "WITHHELD",
]);

export async function findReport(
  db: Db, chainId: number, address: Hex, codehash: Hex, toolVersion: string,
): Promise<Hex | null> {
  const r = await db.query<{ report_hash: Buffer }>(
    `SELECT report_hash FROM reports WHERE chain_id = $1 AND address = $2 AND codehash = $3 AND tool_version = $4
     ORDER BY created_at DESC LIMIT 1`,
    [chainId, toBytes(address.toLowerCase()), toBytes(codehash), toolVersion],
  );
  const row = r.rows[0];
  return row ? toHex(row.report_hash) : null;
}

export async function insertReport(
  db: Db,
  r: { hash: Hex; schemaVersion: number; toolVersion: string; chainId: number; address: Hex; codehash: Hex;
    verdict: string; coreJcs: string; meta: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO reports (report_hash, schema_version, tool_version, chain_id, address, codehash, verdict, core_jcs, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (report_hash) DO NOTHING`,
    [toBytes(r.hash), r.schemaVersion, r.toolVersion, r.chainId, toBytes(r.address.toLowerCase()), toBytes(r.codehash),
      r.verdict, r.coreJcs, JSON.stringify(r.meta)],
  );
}

export async function getReport(db: Db, hash: Hex): Promise<z.infer<typeof ReportRow> | null> {
  const r = await db.query(
    "SELECT report_hash, address, verdict, tool_version, core_jcs, meta, created_at FROM reports WHERE report_hash = $1",
    [toBytes(hash)],
  );
  return r.rows[0] ? ReportRow.parse(r.rows[0]) : null;
}

export async function latestReportFor(db: Db, chainId: number, address: Hex): Promise<z.infer<typeof ReportRow> | null> {
  const r = await db.query(
    `SELECT report_hash, address, verdict, tool_version, core_jcs, meta, created_at FROM reports
     WHERE chain_id = $1 AND address = $2 ORDER BY created_at DESC LIMIT 1`,
    [chainId, toBytes(address.toLowerCase())],
  );
  return r.rows[0] ? ReportRow.parse(r.rows[0]) : null;
}

export async function upsertAttestation(
  db: Db,
  a: { chainId: number; target: Hex; attester: Hex; codehash: Hex; reportHash: Hex; verdict: number; revoked: boolean;
    tx: Hex; block: bigint },
): Promise<void> {
  await db.query(
    `INSERT INTO attestations (chain_id, target, attester, codehash, report_hash, verdict, revoked, tx, block)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (chain_id, target, attester) DO UPDATE SET codehash = EXCLUDED.codehash,
       report_hash = EXCLUDED.report_hash, verdict = EXCLUDED.verdict, revoked = EXCLUDED.revoked,
       tx = EXCLUDED.tx, block = EXCLUDED.block, updated_at = now()`,
    [a.chainId, toBytes(a.target.toLowerCase()), toBytes(a.attester.toLowerCase()), toBytes(a.codehash),
      toBytes(a.reportHash), a.verdict, a.revoked, toBytes(a.tx), a.block.toString()],
  );
}

export async function attestedReport(db: Db, chainId: number, target: Hex, attester: Hex): Promise<Hex | null> {
  const r = await db.query<{ report_hash: Buffer; revoked: boolean }>(
    "SELECT report_hash, revoked FROM attestations WHERE chain_id = $1 AND target = $2 AND attester = $3",
    [chainId, toBytes(target.toLowerCase()), toBytes(attester.toLowerCase())],
  );
  const row = r.rows[0];
  return row && !row.revoked ? toHex(row.report_hash) : null;
}
