// D2 DUST_OUTFLOW (MEDIUM). Native outflow ≤ median_out × 10^-9 with ≥ 20 prior outflows.
// Why a legitimate contract does not trigger it: it needs a ≥ 9-order collapse versus the contract's own history,
// and contracts that routinely send tiny amounts (≥ 5% of history within 3 decades) are suppressed.
import { formatUsdc18 } from "@twelve/shared";
import { massNear, medianOut, nOut } from "../profiles.js";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";

export const D2_MIN_HISTORY = 20;
export const D2_COLLAPSE = 10n ** 9n;
export const D2_SUPPRESS_MASS = 0.05;

export function d2(ctx: TxContext): Alert[] {
  const out: Alert[] = [];
  for (const c of contractsIn(ctx)) {
    const p = ctx.profile(c);
    if (!p || nOut(p) < D2_MIN_HISTORY) continue;
    const med = medianOut(p);
    if (med === null) continue;
    for (const m of ctx.movements) {
      if (m.from !== c || m.iface !== "native" || m.amount18 === 0n) continue;
      if (m.amount18 * D2_COLLAPSE > med) continue;
      if (massNear(p, m.amount18, 3) >= D2_SUPPRESS_MASS) continue;
      out.push({
        detector: "D2", severity: "MEDIUM", address: c, tx: ctx.tx, block: ctx.block,
        evidence: { outflow: { iface: "native", raw: m.amount18.toString(), usdc: formatUsdc18(m.amount18) },
          profile: { n_out: nOut(p), median_usdc: formatUsdc18(med) } },
        dedupeKey: `D2:${ctx.chainId}:${c}:${ctx.tx}:${m.idx}`,
      });
    }
  }
  return out;
}
