// D4 action: revoke through the API's attester (the monitor never holds a key), then enqueue a rescan.
import type { Address } from "viem";
import { errorText } from "./ingest/fetch.js";

export type Revoker = (chainId: number, proxy: Address) => Promise<{ ok: boolean; tx?: string; error?: string }>;

export function apiRevoker(apiUrl: string, adminToken: string, log: (m: string, x?: Record<string, unknown>) => void): Revoker {
  return async (chainId, proxy) => {
    try {
      const r = await fetch(`${apiUrl}/v1/admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ chainId, target: proxy, reason: "UPGRADED" }),
      });
      const body = (await r.json().catch(() => ({}))) as { tx?: string; error?: unknown };
      if (!r.ok) return { ok: false, error: JSON.stringify(body.error ?? r.status) };
      // rescan the new implementation; failure here is logged, the revoke already landed
      await fetch(`${apiUrl}/v1/scans`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId, address: proxy }) }).catch((e) => log("rescan enqueue failed", { e: errorText(e) }));
      return { ok: true, ...(body.tx ? { tx: body.tx } : {}) };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  };
}
