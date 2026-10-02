"use client";

import { explorerAddress, explorerTx } from "@/lib/config";
import { cn } from "@/lib/cn";
import { Tooltip } from "./tooltip";

const short = (h: string, head = 6, tail = 4) => `${h.slice(0, head)}…${h.slice(-tail)}`;

/** A shortened hash with the full value on hover, linking to the Arc explorer. Client-side so the tooltip trigger element is built where Base UI clones it. */
export function Hash({ value, kind = "address", className, head, tail }: {
  value: string; kind?: "address" | "tx" | "none"; className?: string; head?: number; tail?: number;
}) {
  const text = <span className={cn("num text-[13px]", className)}>{short(value, head, tail)}</span>;
  if (kind === "none") return <Tooltip content={<span className="num">{value}</span>}>{text}</Tooltip>;
  return (
    <Tooltip content={<span className="num">{value}</span>}>
      <a href={kind === "tx" ? explorerTx(value) : explorerAddress(value)} target="_blank" rel="noreferrer"
        className={cn("num text-[13px] underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-fg hover:decoration-fg/40", className)}>
        {short(value, head, tail)}
      </a>
    </Tooltip>
  );
}
