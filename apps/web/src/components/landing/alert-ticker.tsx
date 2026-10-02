"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Hash } from "@/components/ui/address";
import { Pill, UnitChip } from "@/components/ui/unit-chip";
import { AlertRow, DETECTORS, ago, summarize } from "@/lib/alerts";
import { API_URL, MAINNET } from "@/lib/config";
import { cn } from "@/lib/cn";

type State = "loading" | "live" | "offline";
const MAX = 6;

/** Latest mainnet alerts, then live over SSE (/v1/alerts/stream). Every state renders a sentence, never a broken box. */
export function AlertTicker({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [state, setState] = useState<State>("loading");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/v1/alerts?chainId=${MAINNET.chainId}&limit=${MAX}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const body = z.object({ alerts: z.array(AlertRow) }).parse(await r.json());
        if (cancelled) return;
        setRows(body.alerts.filter((a) => a.severity !== "OPS"));
        setState("live");
        es = new EventSource(`${API_URL}/v1/alerts/stream`);
        es.onmessage = (m) => {
          const a = AlertRow.safeParse(JSON.parse(m.data));
          if (!a.success || a.data.chainId !== MAINNET.chainId || a.data.severity === "OPS") return;
          setRows((prev) => [a.data, ...prev.filter((x) => x.id !== a.data.id)].slice(0, MAX));
        };
        es.onerror = () => setState((s) => (s === "live" ? "live" : "offline"));
      } catch {
        if (!cancelled) setState("offline");
      }
    })();
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      es?.close();
      clearInterval(t);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-elev">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5 text-[13px] text-fg">
          <span aria-hidden className={cn("size-1.5 rounded-full",
            state === "live" ? "bg-ok" : state === "loading" ? "bg-subtle" : "bg-v18")} />
          Live alerts · Arc mainnet
        </div>
        <span className="text-[12px] text-subtle">
          {state === "live" ? "streaming" : state === "loading" ? "connecting…" : "feed unreachable"}
        </span>
      </div>

      {state === "offline" && rows.length === 0 && (
        <p className="px-5 py-6 text-[13px] leading-relaxed text-muted">
          The monitor&apos;s feed isn&apos;t reachable from here right now. Alerts are still raised and stored; they&apos;ll
          appear when the connection returns.
        </p>
      )}
      {state === "loading" && (
        <div aria-hidden className="divide-y divide-line">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="h-5 w-11 rounded bg-elev-2" />
              <div className="h-3 w-40 rounded bg-elev-2" />
              <div className="ml-auto h-3 w-12 rounded bg-elev-2" />
            </div>
          ))}
        </div>
      )}
      {state === "live" && rows.length === 0 && (
        <p className="px-5 py-6 text-[13px] text-muted">No alerts yet. When a 10¹² signature crosses mainnet, it lands here within seconds.</p>
      )}

      <ul className="divide-y divide-line">
        {rows.map((a) => {
          const s = summarize(a);
          return (
            <li key={a.id} className="ticker-row grid gap-x-4 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div className="flex items-center gap-2.5">
                <Pill tone={(["HIGH", "MEDIUM", "LOW", "INFO"].includes(a.severity) ? a.severity : "INFO") as "HIGH"} />
                <span className="text-[13px] text-fg">{DETECTORS[a.detector] ?? a.detector}</span>
              </div>
              <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted", compact && "hidden sm:flex")}>
                {a.address && <Hash value={a.address} className="text-muted" />}
                {s.inflow && s.outflow && (
                  <span className="num flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="text-subtle">in</span> {s.inflow.usdc}
                    <UnitChip exp={s.inflow.iface === "erc20" ? 6 : 18} label={s.inflow.iface === "erc20" ? "erc20" : "native"} />
                    <span className="text-subtle">→ out</span> <span className="text-bad">{s.outflow.usdc}</span>
                    <UnitChip exp={s.outflow.iface === "erc20" ? 6 : 18} label={s.outflow.iface === "erc20" ? "erc20" : "native"} />
                  </span>
                )}
                {!s.inflow && s.outflow && <span className="num text-[12px]">out {s.outflow.usdc} USDC</span>}
                {s.text && <span className="text-[12px]">{s.text}</span>}
              </div>
              <div className="flex items-center gap-3 text-[12px] text-subtle sm:justify-end">
                {a.tx && <Hash value={a.tx} kind="tx" className="text-[12px] text-subtle" />}
                <span className="num">{ago(a.createdAt, now)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
