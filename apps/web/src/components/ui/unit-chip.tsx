import { cn } from "@/lib/cn";

/** The unit of a value, colored by view: 6 decimals = ERC-20 (blue), 18 decimals = native (amber). */
export function UnitChip({ exp, label, className }: { exp: 6 | 18; label?: string; className?: string }) {
  return (
    <span className={cn("num inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded px-1.5 text-[11px] font-medium",
      exp === 6 ? "bg-v6-soft text-v6" : "bg-v18-soft text-v18", className)}>
      {label ?? `${exp}-dec`}
    </span>
  );
}

const sev = {
  HIGH: "bg-bad-soft text-bad",
  MEDIUM: "bg-v18-soft text-v18",
  LOW: "bg-elev-2 text-muted",
  INFO: "bg-elev-2 text-muted",
  OPS: "bg-elev-2 text-muted",
  FINDINGS: "bg-bad-soft text-bad",
  CLEAN: "bg-ok-soft text-ok",
  INCOMPLETE: "bg-v18-soft text-v18",
} as const;

export function Pill({ tone, children, className }: { tone: keyof typeof sev; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold tracking-wide", sev[tone], className)}>
      {children ?? tone}
    </span>
  );
}
