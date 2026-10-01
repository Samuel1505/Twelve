// Webhook delivery (MONITOR §6): X-Twelve-Signature = hex(hmac_sha256(secret, body)); 5 attempts with exponential
// backoff, then `dead` (the dead-letter state stays queryable in `deliveries`).
import { createHmac } from "node:crypto";
import type { Db } from "@twelve/db";

export const MAX_ATTEMPTS = 5;
export const sign = (secret: string, body: string): string => createHmac("sha256", secret).update(body).digest("hex");

type Row = { id: string; attempts: number; webhook_url: string; secret: string; alert: Record<string, unknown> };

export async function deliverDue(db: Db, post: (url: string, body: string, sig: string) => Promise<number> = httpPost): Promise<number> {
  const r = await db.query<Row>(
    `SELECT d.id, d.attempts, s.webhook_url, s.secret,
            json_build_object('id', a.id, 'chainId', a.chain_id, 'detector', a.detector, 'severity', a.severity,
              'address', '0x' || encode(a.address, 'hex'), 'tx', '0x' || encode(a.tx, 'hex'), 'block', a.block,
              'evidence', a.evidence, 'createdAt', a.created_at) AS alert
     FROM deliveries d JOIN subscriptions s ON s.id = d.subscription_id JOIN alerts a ON a.id = d.alert_id
     WHERE d.status = 'pending' AND d.next_at <= now() ORDER BY d.id LIMIT 20 FOR UPDATE OF d SKIP LOCKED`);
  for (const row of r.rows) {
    const body = JSON.stringify(row.alert);
    let status = 0;
    let error = "";
    try {
      status = await post(row.webhook_url, body, sign(row.secret, body));
    } catch (e) {
      error = String(e).slice(0, 300);
    }
    if (status >= 200 && status < 300) {
      await db.query("UPDATE deliveries SET status = 'delivered', attempts = attempts + 1, last_error = NULL WHERE id = $1", [row.id]);
    } else {
      const attempts = row.attempts + 1;
      await db.query(
        `UPDATE deliveries SET attempts = $2::int, last_error = $3,
           status = CASE WHEN $2::int >= $4::int THEN 'dead' ELSE 'pending' END,
           next_at = now() + make_interval(secs => power(2, $2::int)::int) WHERE id = $1`,
        [row.id, attempts, error || `HTTP ${status}`, MAX_ATTEMPTS]);
    }
  }
  return r.rows.length;
}

async function httpPost(url: string, body: string, sig: string): Promise<number> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-twelve-signature": sig },
    body, signal: AbortSignal.timeout(10_000) });
  return res.status;
}
