// D2 DUST_OUTFLOW (MEDIUM). Native outflow ≤ median_out × 10^-9 with ≥ 20 prior outflows.
// Why a legitimate contract does not trigger it: it needs a ≥ 9-order collapse versus the contract's own history AND
// the 10^12 signature (amount × 10^12 within one decade of the median payout, ADR-021),
// contracts that routinely send tiny amounts (≥ 5% of history within 3 decades) are suppressed, and outflows below
// 10^4 raw are ignored: a 10^12 underpay of any payment ≥ 0.01 USDC lands at ≥ 10^4 raw, while sub-10^4 outflows are
// rounding dust (mainnet replay: all 12 pre-floor D2 alerts were Uniswap v4 PoolManager / router settlement dust).
import { USDC_SCALE, formatUsdc18, usdc18 } from "@twelve/shared";
import { massNear, medianOut, nOut } from "../profiles.js";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";
import { D1_MIN_RAW } from "./d1.js";

export const D2_MIN_HISTORY = 20;
export const D2_COLLAPSE = 10n ** 9n;
export const D2_SUPPRESS_MASS = 0.05;
/** The 10^12 signature (ADR-021): the dust outflow scaled up by 10^12 must land within one order of magnitude of the
 *  contract's median payout — i.e. it is a typical payment expressed in the wrong view, not arbitrary rounding dust. */
export const D2_SIGNATURE_ORDERS = 10n;

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
      const asIntended = m.amount18 * USDC_SCALE; // what the payout would be had the raw value been 6-dec
      if (asIntended * D2_SIGNATURE_ORDERS < med || asIntended > med * D2_SIGNATURE_ORDERS) continue;
      out.push({
        detector: "D2", severity: "MEDIUM", address: c, tx: ctx.tx, block: ctx.block,
        evidence: { outflow: { iface: "native", raw: m.amount18.toString(), usdc: formatUsdc18(m.amount18) },
          as_if_6dec_usdc: formatUsdc18(usdc18(asIntended)),
          profile: { n_out: nOut(p), median_usdc: formatUsdc18(med) } },
        dedupeKey: `D2:${ctx.chainId}:${c}:${ctx.tx}:${m.idx}`,
      });
    }
  }
  return out;
}
