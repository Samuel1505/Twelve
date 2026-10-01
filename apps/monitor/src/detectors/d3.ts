// D3 ABNORMAL_SWEEP (MEDIUM): one tx moves ≥ 90% of a contract's balance when it historically never moved ≥ 10%.
// Why a legitimate contract does not trigger it: contracts that routinely sweep have max_out_frac ≥ 0.10 and are
// excluded; small or young contracts (< 100 USDC, < 20 outflows) are excluded. Not 10^12-specific: "possible drain".
import { formatUsdc18, parseUsdc18, usdc18 } from "@twelve/shared";
import { nOut } from "../profiles.js";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";

export const D3_MIN_BALANCE = parseUsdc18("100");
export const D3_MIN_HISTORY = 20;
export const D3_MAX_HIST_FRAC = 0.1;

export function d3(ctx: TxContext, d1Fired: ReadonlySet<string>): Alert[] {
  const out: Alert[] = [];
  for (const c of contractsIn(ctx)) {
    const p = ctx.profile(c);
    if (!p || nOut(p) < D3_MIN_HISTORY || p.maxOutFrac >= D3_MAX_HIST_FRAC || p.balance18 < D3_MIN_BALANCE) continue;
    let total = 0n;
    for (const m of ctx.movements) {
      if (m.from === c && (m.iface === "native" || m.iface === "erc20")) total += m.amount18;
    }
    if (total * 10n < p.balance18 * 9n) continue;
    out.push({
      detector: "D3", severity: "MEDIUM", address: c, tx: ctx.tx, block: ctx.block,
      evidence: { kind: "possible drain", outflow_usdc: formatUsdc18(usdc18(total)),
        pre_balance_usdc: formatUsdc18(p.balance18), historical_max_out_frac: p.maxOutFrac, n_out: nOut(p),
        d1_also_fired: d1Fired.has(c) },
      dedupeKey: `D3:${ctx.chainId}:${c}:${ctx.tx}`,
    });
  }
  return out;
}
