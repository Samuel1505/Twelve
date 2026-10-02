"use client";

import { useEffect, useState } from "react";
import { STAGES, stageIndex } from "@/lib/scan-states";
import { cn } from "@/lib/cn";

/**
 * Pipeline progress. Stages switch instantly (they can be milliseconds apart; animating each would lag the truth);
 * only the current stage carries a spinner.
 */
export function ScanProgress({ state, startedAt }: { state: string; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const at = state === "QUEUED" ? -1 : stageIndex(state);
  const secs = Math.max(0, (now - startedAt) / 1000);

  return (
    <div className="rounded-2xl border border-line bg-elev">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <p className="text-[14px] text-fg">
          {state === "QUEUED" ? "Waiting for the scanner…" : `${STAGES[at]?.label ?? "Working"}…`}
        </p>
        <span className="num text-[12px] text-subtle">{secs.toFixed(1)} s</span>
      </div>
      <ol className="grid grid-cols-1 gap-x-6 gap-y-2.5 px-5 py-4 sm:grid-cols-3">
        {STAGES.map((s, i) => {
          const done = i < at;
          const current = i === at;
          return (
            <li key={s.id} className={cn("flex items-center gap-2.5 text-[13px]",
              done ? "text-muted" : current ? "text-fg" : "text-subtle/70")}>
              <span aria-hidden className="grid size-4 place-items-center">
                {done ? (
                  <svg viewBox="0 0 16 16" className="size-3.5 text-ok" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : current ? (
                  <span className="spinner size-3.5 rounded-full border-[1.5px] border-line-strong border-t-fg" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="num text-[11px] text-subtle">{String(i + 1).padStart(2, "0")}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line px-5 py-3 text-[12.5px] leading-relaxed text-subtle">
        Twelve rebuilds the verified source and proves it compiles to the code on-chain before analyzing anything. A
        report about code that isn&apos;t deployed would be worthless.
      </p>
    </div>
  );
}
