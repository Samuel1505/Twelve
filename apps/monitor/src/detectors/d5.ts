// D5 ATTESTED_TARGET_FINDING_ACTIVITY (INFO): funds flow into a contract attested FINDINGS. Once per contract per day.
// Why a legitimate contract does not trigger it: it only concerns contracts Twelve already attested with findings.
import { formatUsdc18, usdc18 } from "@twelve/shared";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";

export const BLOCKS_PER_DAY = 172_800n; // ~0.5 s blocks (ARC_LEDGER §4); deterministic under replay

export function d5(ctx: TxContext): Alert[] {
  const out: Alert[] = [];
  for (const c of contractsIn(ctx)) {
    const a = ctx.attestation(c);
    if (!a || a.revoked || a.verdict !== 2) continue;
    const inflow = ctx.movements.filter((m) => m.to === c).reduce((s, m) => s + m.amount18, 0n);
    if (inflow === 0n) continue;
    out.push({
      detector: "D5", severity: "INFO", address: c, tx: ctx.tx, block: ctx.block,
      evidence: { inflow_usdc: formatUsdc18(usdc18(inflow)), note: "funds are flowing into a contract with open findings" },
      dedupeKey: `D5:${ctx.chainId}:${c}:${ctx.block / BLOCKS_PER_DAY}`,
    });
  }
  return out;
}
