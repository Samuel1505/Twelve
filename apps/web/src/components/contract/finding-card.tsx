"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Pill, UnitChip } from "@/components/ui/unit-chip";
import { type Finding, getSource } from "@/lib/api";
import { unitLabel, viewOf } from "@/lib/format";
import { ruleTitle } from "@/lib/rules";

const CONTEXT_BEFORE = 4;
const CONTEXT_AFTER = 2;

type Excerpt = { state: "loading" } | { state: "ok"; code: string; first: number } | { state: "missing" };

/** Source files are tried on the implementation first (proxy findings live there), then on the address itself. */
function useExcerpt(addresses: string[], f: Finding): Excerpt {
  const [ex, setEx] = useState<Excerpt>({ state: "loading" });
  const key = `${addresses.join(",")}:${f.location.file}:${f.location.startLine}`;
  useEffect(() => {
    let live = true;
    (async () => {
      for (const a of addresses) {
        const r = await getSource(a, f.location.file);
        if (!live) return;
        if (r.ok) {
          const lines = r.value.content.split("\n");
          const first = Math.max(1, f.location.startLine - CONTEXT_BEFORE);
          const last = Math.min(lines.length, f.location.endLine + CONTEXT_AFTER);
          setEx({ state: "ok", code: lines.slice(first - 1, last).join("\n"), first });
          return;
        }
      }
      setEx({ state: "missing" });
    })();
    return () => {
      live = false;
    };
    // key captures every input that changes the excerpt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ex;
}

export function FindingCard({ f, sourceAddresses, index }: { f: Finding; sourceAddresses: string[]; index: number }) {
  const ex = useExcerpt(sourceAddresses, f);
  const loc = f.location;
  const oneLine = loc.startLine === loc.endLine;
  const tone = f.severity === "HIGH" ? "HIGH" : f.severity === "MEDIUM" ? "MEDIUM" : f.severity === "LOW" ? "LOW" : "INFO";

  return (
    <article id={`finding-${index + 1}`} className="scroll-mt-24 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Pill tone={tone} />
          <span className="num text-fg">{f.rule}</span>
          <span className="text-subtle">·</span>
          <span className="text-subtle">confidence {f.confidence.toLowerCase()}</span>
        </div>
        <h3 className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-fg">{ruleTitle(f.rule)}</h3>
        <p className="max-w-[68ch] text-[14px] leading-relaxed text-muted">
          {f.message}
        </p>
      </header>

      {ex.state === "loading" && (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-sunken px-4 py-4">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-3 rounded bg-elev-2" style={{ width: `${40 + ((i * 37) % 50)}%` }} />)}
        </div>
      )}
      {ex.state === "ok" && (
        <CodeBlock
          code={ex.code}
          firstLine={ex.first}
          highlight={loc.startLine}
          {...(oneLine ? { underline: [loc.startCol - 1, loc.endCol - 1] as [number, number] } : {})}
          title={`${loc.file}:${loc.startLine} · ${f.contract}.${f.function}`}
        />
      )}
      {ex.state === "missing" && (
        <p className="rounded-xl border border-line bg-sunken px-4 py-3 text-[13px] text-muted">
          <span className="num text-fg">{loc.file}:{loc.startLine}</span> in <span className="num">{f.contract}.{f.function}</span>.
          The source excerpt couldn&apos;t be loaded right now; the location above is exact.
        </p>
      )}

      <Trace f={f} />

      <div className="rounded-xl border border-line px-4 py-3">
        <div className="text-[12px] text-subtle">How to fix</div>
        <p className="mt-1 text-[14px] leading-relaxed text-fg">{f.fix}</p>
      </div>
    </article>
  );
}

/** The value's path from where its unit was learned to where it collides. */
function Trace({ f }: { f: Finding }) {
  if (!f.trace.length) return null;
  return (
    <div className="rounded-xl border border-line bg-sunken">
      <div className="border-b border-line px-4 py-2.5 text-[12px] text-subtle">Unit trace</div>
      <ol className="divide-y divide-line">
        {f.trace.map((t, i) => {
          const u = t.unit ?? t.expects;
          const v = viewOf(u);
          const sink = t.expects !== undefined;
          return (
            <li key={i} className="grid gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center">
              <span className="text-[12px] text-subtle">{t.step}</span>
              <span className="num min-w-0 break-words text-[12.5px] text-fg">{t.expr}</span>
              <span className="flex items-center gap-2">
                {sink && <span className="text-[12px] text-subtle">expects</span>}
                {v ? <UnitChip exp={v} label={v === 6 ? "6 dec · erc20" : "18 dec · native"} /> :
                  <span className="num rounded bg-elev-2 px-1.5 py-0.5 text-[11px] text-muted">{unitLabel(u)}</span>}
                <span className="num text-[11px] text-subtle">:{t.loc.split(":").pop()}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
