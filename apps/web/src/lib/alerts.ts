import { z } from "zod";

export const AlertRow = z.object({
  id: z.string(),
  chainId: z.number(),
  detector: z.string(),
  severity: z.string(),
  address: z.string().nullable(),
  tx: z.string().nullable(),
  block: z.string().nullable(),
  evidence: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AlertRow = z.infer<typeof AlertRow>;

export const DETECTORS: Record<string, string> = {
  D1: "Cross-view raw equality",
  D2: "Dust outflow",
  D3: "Abnormal sweep",
  D4: "Attested proxy upgraded",
  D5: "Funds into a flagged contract",
  PAIRING: "Unpaired ERC-20 log",
  CONTINUITY: "Chain continuity",
  BALANCE: "Balance drift",
};

const Flow = z.object({ iface: z.string(), raw: z.string(), usdc: z.string() });

/** One human sentence per alert, from its evidence (MONITOR §4). */
export function summarize(a: AlertRow): { inflow?: z.infer<typeof Flow>; outflow?: z.infer<typeof Flow>; text?: string } {
  const e = a.evidence;
  const inflow = Flow.safeParse(e.inflow);
  const outflow = Flow.safeParse(e.outflow);
  if (a.detector === "D1" && inflow.success && outflow.success) return { inflow: inflow.data, outflow: outflow.data };
  if (a.detector === "D2" && outflow.success) return { outflow: outflow.data };
  if (a.detector === "D3" && typeof e.outflow_usdc === "string") {
    return { text: `${e.outflow_usdc} of ${String(e.pre_balance_usdc)} USDC left in one transaction` };
  }
  if (a.detector === "D4") return { text: "Implementation changed; attestation revoked, rescan queued" };
  if (a.detector === "D5" && typeof e.inflow_usdc === "string") return { text: `${e.inflow_usdc} USDC into a contract with open findings` };
  return {};
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
