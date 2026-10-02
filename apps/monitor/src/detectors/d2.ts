// D2 DUST_OUTFLOW (MEDIUM). Native outflow ≤ median_out × 10^-9 with ≥ 20 prior outflows.
// Why a legitimate contract does not trigger it: it needs a ≥ 9-order collapse versus the contract's own history,
// contracts that routinely send tiny amounts (≥ 5% of history within 3 decades) are suppressed, and outflows below
// 10^4 raw are ignored: a 10^12 underpay of any payment ≥ 0.01 USDC lands at ≥ 10^4 raw, while sub-10^4 outflows are
// rounding dust (mainnet replay: all 12 pre-floor D2 alerts were Uniswap v4 PoolManager / router settlement dust).
import { formatUsdc18 } from "@twelve/shared";
import { massNear, medianOut, nOut } from "../profiles.js";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";
import { D1_MIN_RAW } from "./d1.js";

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
      if (m.from !== c || m.iface !== "native" || m.amount18 < D1_MIN_RAW) continue;
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
