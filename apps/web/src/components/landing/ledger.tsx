"use client";

import { useEffect, useRef, useState } from "react";
import { formatUsdc18, parseUsdc6, toUsdc18, usdc18 } from "@twelve/shared/units";
import { cn } from "@/lib/cn";

const PRESETS = ["0.01", "5", "1000"] as const;
type Preset = (typeof PRESETS)[number];

/**
 * One balance, two raw integers. The twelve digits between the views are the whole bug; they reveal once on first
 * view (explanatory, rare). Switching amounts is frequent, so it updates instantly — no animation.
 */
export function Ledger() {
  const [amount, setAmount] = useState<Preset>("5");
  // the stagger plays once, on first paint; later amount switches re-render without it
  const firstRun = useRef(true);
  useEffect(() => {
    firstRun.current = false;
  }, []);

  const raw6 = parseUsdc6(amount);
  const raw18 = toUsdc18(raw6);
  const head = raw6.toString();
  const scaled = raw18.toString().slice(head.length); // always the twelve digits of 10^12
  const dust = formatUsdc18(usdc18(raw6)); // the 6-dec integer delivered through the native view

  return (
    <div className="rounded-2xl border border-line bg-elev">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="text-[13px] text-muted">
          One balance in USDC, <span className="text-fg">two raw integers</span>
        </div>
        <div role="radiogroup" aria-label="Amount in USDC" className="flex shrink-0 rounded-lg border border-line bg-sunken p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={amount === p}
              onClick={() => setAmount(p)}
              className={cn(
                "pressable num h-7 rounded-md px-2.5 text-[12px]",
                amount === p ? "bg-elev-2 text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "text-subtle hover:text-fg",
              )}
            >
              {Number(p).toLocaleString("en-US")}
            </button>
          ))}
        </div>
      </div>

      <dl className="divide-y divide-line">
        <Row
          view="ERC-20 view"
          where={<>USDC.balanceOf · transfer · <span className="num">0x3600…</span></>}
          exp={6}
          value={<span className="text-v6">{head}</span>}
        />
        <Row
          view="Native view"
          where={<>msg.value · address.balance · gas</>}
          exp={18}
          value={
            <>
              <span className="text-v18">{head}</span>
              <span className="relative text-v18/55">
                {scaled.split("").map((d, i) => (
                  <span
                    key={`${amount}-${i}`}
                    className={cn("inline-block", firstRun.current && "digit-reveal")}
                    style={firstRun.current ? { animationDelay: `${180 + i * 35}ms` } : undefined}
                  >
                    {d}
                  </span>
                ))}
                <span aria-hidden className="absolute -bottom-2 left-0 right-0 h-px bg-v18/40" />
                <span className="absolute -bottom-6 right-0 text-[11px] font-medium tracking-normal text-v18">× 10¹²</span>
              </span>
            </>
          }
          pad
        />
      </dl>

      <div className="border-t border-line bg-bad-soft/40 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="text-[13px] text-muted">
            Send the ERC-20 number through the native door:
            <span className="num ml-2 text-fg">call{"{"}value: <span className="text-v6">{head}</span>{"}"}</span>
          </div>
          <div className="sm:text-right">
            <div className="num text-[15px] text-bad">{dust} USDC</div>
            <div className="text-[12px] text-subtle">arrives, out of {Number(amount).toLocaleString("en-US")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ view, where, exp, value, pad }: {
  view: string; where: React.ReactNode; exp: 6 | 18; value: React.ReactNode; pad?: boolean;
}) {
  return (
    <div className={cn("grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,230px)_1fr] sm:items-center", pad && "pb-8")}>
      <dt>
        <div className="flex items-center gap-2 text-[13px] text-fg">
          <span aria-hidden className={cn("size-1.5 rounded-full", exp === 6 ? "bg-v6" : "bg-v18")} />
          {view}
          <span className="num text-[12px] text-subtle">{exp} dec</span>
        </div>
        <div className="mt-0.5 text-[12px] text-subtle">{where}</div>
      </dt>
      <dd className="num overflow-x-auto text-[17px] tracking-[0.02em] sm:text-right sm:text-[19px]">{value}</dd>
    </div>
  );
}
