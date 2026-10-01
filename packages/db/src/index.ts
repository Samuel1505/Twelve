// Postgres plumbing shared by apps/api and apps/monitor (node-only; never imported by web).
// Migrations live in apps/api/migrations (CLAUDE.md §8); both processes may run them at boot, serialized by a lock.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import type { Hex } from "viem";

export type Db = pg.Pool;

export const connect = (url: string, max = 10): Db => new pg.Pool({ connectionString: url, max });

export const MIGRATIONS_DIR = new URL("../../../apps/api/migrations/", import.meta.url);
const MIGRATION_LOCK = 0x7477656c76; // "twelv"

/** Applies numbered plain-SQL files once each, in order, under an advisory lock (api and monitor may boot together). */
export async function migrate(db: Db, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((x) => /^\d+_.+\.sql$/.test(x)).sort()) {
      if (done.has(f)) continue;
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(new URL(f, dir), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}

export const toBytes = (h: Hex | string): Buffer => Buffer.from(h.slice(2), "hex");
export const toHex = (b: Buffer): Hex => `0x${b.toString("hex")}`;
