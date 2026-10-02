import { Hash } from "@/components/ui/address";
import { Pill, UnitChip, type PillTone } from "@/components/ui/unit-chip";
import { type AlertRow, type Flow, DETECTORS, ago, isWithheld, summarize } from "@/lib/alerts";
import { cn } from "@/lib/cn";

const tone = (s: string): PillTone => (["HIGH", "MEDIUM", "LOW", "INFO", "OPS"].includes(s) ? (s as PillTone) : "INFO");

/** One alert. Amounts always show raw integer, view and USDC (DEMO_SCRIPT: never a bare number). */
export function AlertItem({ a, now, showAddress = true, detailed = false }: {
  a: AlertRow; now: number; showAddress?: boolean; detailed?: boolean;
}) {
  const s = summarize(a);
  const withheld = isWithheld(a);
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          <Pill tone={tone(a.severity)} />
          <span className="text-fg">{DETECTORS[a.detector] ?? a.detector}</span>
          {showAddress && a.address && <Hash value={a.address} className="text-muted" />}
          {withheld && <span className="text-[12px] text-subtle">third-party · withheld</span>}
        </div>
        {(s.inflow || s.outflow) && (
          <div className={cn("grid gap-1.5", detailed ? "sm:grid-cols-2 sm:gap-3" : "")}>
            {s.inflow && <FlowLine dir="in" f={s.inflow} />}
            {s.outflow && <FlowLine dir="out" f={s.outflow} bad />}
          </div>
        )}
        {s.text && <p className="text-[13px] leading-relaxed text-muted">{s.text}</p>}
      </div>
      <div className="flex items-center gap-3 text-[12px] text-subtle sm:flex-col sm:items-end sm:gap-1">
        <span className="num" title={new Date(a.createdAt).toUTCString()}>{withheld ? `≈ ${ago(a.createdAt, now)}` : ago(a.createdAt, now)}</span>
        {a.tx && <Hash value={a.tx} kind="tx" className="text-[12px] text-subtle" />}
        {detailed && a.block && <span className="num">block {Number(a.block).toLocaleString("en-US")}</span>}
      </div>
    </div>
  );
}

function FlowLine({ dir, f, bad }: { dir: "in" | "out"; f: Flow; bad?: boolean }) {
  const v = f.iface === "erc20" ? 6 : 18;
  return (
    <div className="num flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <span className="w-6 text-subtle">{dir}</span>
      <span className="text-fg">{f.raw}</span>
      <UnitChip exp={v} label={v === 6 ? "erc20 · 6 dec" : "native · 18 dec"} />
      <span className="text-subtle">=</span>
      <span className={bad ? "text-bad" : "text-fg"}>{f.usdc} USDC</span>
    </div>
  );
}
