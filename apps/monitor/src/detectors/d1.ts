// D1 CROSS_VIEW_RAW_EQUALITY (MONITOR §4) — the fingerprint, HIGH.
// Why a legitimate contract does not trigger it: a correct conversion scales by 10^12 between views, so the raw
// integers of an inflow in one view and an outflow in the other are never equal except by coincidence; the
// ≥ 10^4 raw floor removes coincidental tiny matches.
import { formatUsdc18, formatUsdc6, rawEqualAcrossViews, usdc18, usdc6 } from "@twelve/shared";
import type { Alert } from "../types.js";
import { contractsIn, type TxContext } from "./context.js";

export const D1_MIN_RAW = 10n ** 4n;

export function d1(ctx: TxContext): Alert[] {
  const alerts: Alert[] = [];
  for (const c of contractsIn(ctx)) {
    const nativeIn = ctx.movements.filter((m) => m.to === c && m.iface === "native");
    const erc20In = ctx.movements.filter((m) => m.to === c && m.iface === "erc20");
    const nativeOut = ctx.movements.filter((m) => m.from === c && m.iface === "native");
    const erc20Out = ctx.movements.filter((m) => m.from === c && m.iface === "erc20");
    // overpay: native in x (18-dec raw) == ERC-20 out raw (6-dec) → paid 10^12× intended
    for (const i of nativeIn) {
      const o = erc20Out.find((e) => e.raw6 !== null && rawEqualAcrossViews(i.amount18, e.raw6) && i.amount18 >= D1_MIN_RAW);
      if (o?.raw6 != null) {
        alerts.push(alert(ctx, c, "overpay",
          { iface: "native", raw: i.amount18.toString(), usdc: formatUsdc18(i.amount18) },
          { iface: "erc20", raw: o.raw6.toString(), usdc: formatUsdc6(o.raw6) }, "10^12", o.idx));
      }
    }
    // underpay: ERC-20 in y (6-dec raw) == native out raw (18-dec) → recipient got 10^-12 of intended
    for (const i of erc20In) {
      if (i.raw6 === null || (i.raw6 as bigint) < D1_MIN_RAW) continue;
      const o = nativeOut.find((n) => rawEqualAcrossViews(n.amount18, usdc6(i.raw6 as bigint)));
      if (o) {
        alerts.push(alert(ctx, c, "underpay",
          { iface: "erc20", raw: i.raw6.toString(), usdc: formatUsdc6(i.raw6) },
          { iface: "native", raw: o.amount18.toString(), usdc: formatUsdc18(usdc18(o.amount18)) }, "10^-12", o.idx));
      }
    }
  }
  return alerts;
}

function alert(ctx: TxContext, c: `0x${string}`, kind: string, inflow: object, outflow: object, ratio: string,
  outIdx: number): Alert {
  const p = ctx.profile(c);
  return {
    detector: "D1", severity: "HIGH", address: c, tx: ctx.tx, block: ctx.block,
    evidence: { kind, inflow, outflow, ratio, profile: p ? { n_out: p.nOut.native + p.nOut.erc20 } : null },
    dedupeKey: `D1:${ctx.chainId}:${c}:${ctx.tx}:${outIdx}`,
  };
}
