import { CodeLine } from "@/components/ui/code-block";
import type { Hunk } from "@/lib/corpus";
import { cn } from "@/lib/cn";

/** bug.sol → safe.sol, as hunks. Red is the planted bug, green its fixed twin. */
export function CaseDiff({ hunks, expectLines }: { hunks: Hunk[]; expectLines: number[] }) {
  if (!hunks.length) return <p className="px-4 py-3 text-[13px] text-subtle">The two files are identical.</p>;
  return (
    <div className="overflow-x-auto">
      <pre className="num min-w-max py-2 text-[12.5px] leading-[1.7]">
        {hunks.map((h, i) => (
          <div key={i} className={cn(i > 0 && "mt-2 border-t border-dashed border-line pt-2")}>
            {h.lines.map((l, k) => {
              const flagged = l.kind === "-" && l.a !== undefined && expectLines.includes(l.a);
              return (
                <div key={k} className={cn("flex pr-4",
                  l.kind === "-" ? "bg-bad-soft" : l.kind === "+" ? "bg-ok-soft" : "")}>
                  <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-subtle/60">{l.a ?? ""}</span>
                  <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-subtle/60">{l.b ?? ""}</span>
                  <span aria-hidden className={cn("w-5 shrink-0 select-none",
                    l.kind === "-" ? "text-bad" : l.kind === "+" ? "text-ok" : "text-subtle/40")}>{l.kind === " " ? "" : l.kind}</span>
                  <span className={cn(flagged && "underline decoration-bad decoration-wavy decoration-[1.5px] underline-offset-[5px]")}>
                    <CodeLine text={l.text} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </pre>
    </div>
  );
}
