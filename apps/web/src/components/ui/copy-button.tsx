"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Copies `value`. Feedback is the label swapping to a check — used often, so no toast and no flourish. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        "pressable inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-subtle hover:bg-elev-2 hover:text-fg",
        className,
      )}
    >
      <span className="relative inline-grid size-3.5 place-items-center">
        <svg viewBox="0 0 16 16" aria-hidden className={cn("absolute size-3.5 transition-[opacity,filter,transform] duration-200 ease-out",
          copied ? "scale-75 opacity-0 blur-[2px]" : "opacity-100")} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
          <path d="M10.75 5.25V3.5A1.25 1.25 0 0 0 9.5 2.25h-6A1.25 1.25 0 0 0 2.25 3.5v6a1.25 1.25 0 0 0 1.25 1.25h1.75" />
        </svg>
        <svg viewBox="0 0 16 16" aria-hidden className={cn("absolute size-3.5 text-ok transition-[opacity,filter,transform] duration-200 ease-out",
          copied ? "opacity-100" : "scale-75 opacity-0 blur-[2px]")} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
