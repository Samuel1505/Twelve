// Typed access to apps/api. zod at the boundary (CLAUDE.md §8); every call returns a result, never throws.
import { z } from "zod";
import { ReportCore } from "@twelve/shared/report";
import { AlertRow } from "./alerts";
import { API_URL } from "./config";

export { ReportCore };
export type Finding = ReportCore["findings"][number];

export const OnchainStatus = z.enum(["NONE", "CLEAN", "FINDINGS", "INCOMPLETE", "STALE", "REVOKED"]);
export type OnchainStatus = z.infer<typeof OnchainStatus>;

const Onchain = z.union([
  z.object({
    registry: z.string(),
    attester: z.string(),
    status: OnchainStatus,
    reportHash: z.string(),
    codehash: z.string(),
    attestedAt: z.coerce.number(),
    implementation: z.string().nullable(),
    proxyNote: z.string().optional(),
  }),
  z.object({ error: z.string() }),
]);

export const Status = z.object({
  chainId: z.number(),
  address: z.string(),
  onchain: Onchain.nullable(),
  report: z.object({
    reportHash: z.string(),
    verdict: z.string(),
    toolVersion: z.string(),
    scannedAt: z.string(),
    core: ReportCore,
  }).nullable(),
  alerts: z.array(AlertRow),
});
export type Status = z.infer<typeof Status>;

export const ScanEvent = z.object({
  scanId: z.string(),
  state: z.string(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().nullable().optional(),
  reportHash: z.string().optional(),
  attestTx: z.string().optional(),
});
export type ScanEvent = z.infer<typeof ScanEvent>;

export type ApiError = { kind: "unreachable" } | { kind: "http"; status: number; message: string } | { kind: "invalid" };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, error: { kind: "unreachable" } };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
    return { ok: false, error: { kind: "http", status: res.status, message } };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: { kind: "invalid" } };
}

export const getStatus = (address: string, chainId = 5042) =>
  call(`/v1/status/${address}?chainId=${chainId}`, Status);

export const startScan = (address: string, chainId = 5042) =>
  call("/v1/scans", z.object({ scanId: z.string() }), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, address }),
  });

export const getSource = (address: string, file: string, chainId = 5042) =>
  call(`/v1/source/${address}?chainId=${chainId}&file=${encodeURIComponent(file)}`, z.object({ file: z.string(), content: z.string() }));

export const listAlerts = (q: { chainId?: number; severity?: string; cursor?: string | null; limit?: number }) => {
  const p = new URLSearchParams();
  if (q.chainId) p.set("chainId", String(q.chainId));
  if (q.severity) p.set("severity", q.severity);
  if (q.cursor) p.set("cursor", q.cursor);
  p.set("limit", String(q.limit ?? 50));
  return call(`/v1/alerts?${p}`, z.object({ alerts: z.array(AlertRow), nextCursor: z.string().nullable() }));
};

export const scanEventsUrl = (scanId: string) => `${API_URL}/v1/scans/${scanId}/events`;
