import "server-only";
import type { ReactNode } from "react";
import { MEASURED, REPLAY, corpusMetrics } from "@/lib/evidence";

const fmt = (n: number) => n.toLocaleString("en-US");

/** Every figure is produced by the tool and cited to where it lives in the repo. */
export function Evidence() {
  const c = corpusMetrics();
  return (
    <dl className="divide-y divide-line border-y border-line">
      <Item
        value={fmt(REPLAY.logs)}
        label="USDC Transfer logs replayed, every block since genesis"
        detail={<>{fmt(REPLAY.movements)} movements across {fmt(REPLAY.addresses)} addresses</>}
        source="docs/MONITOR.md §9"
      />
      <Item
        value={`${REPLAY.d1FalsePositives} / ${REPLAY.d1Alerts}`}
        label={`false positives among fingerprint alerts over all of mainnet history`}
        detail={<>Four live contracts with the bug, unverified ones included. Owners are being contacted before anything is named.</>}
        source="docs/MONITOR.md §9"
      />
      <Item
        value={`${c.highCaught} / ${c.highPlanted}`}
        label="planted high-severity bugs caught"
        detail={<>{c.highSafeFp} false alarms on their fixed twins and hard negatives</>}
        source="corpus/METRICS.md"
      />
      <Item
        value={`${MEASURED.matched} / ${MEASURED.scanned}`}
        label="verified mainnet contracts rebuilt and matched to on-chain bytecode"
        detail={<>Reports are never attested for code that doesn&apos;t match</>}
        source="docs/evidence/phase2-mainnet-sample.md"
      />
      <Item
        value={MEASURED.alertLatency}
        label="from block to alert on mainnet"
        detail={<>LeakyRefund refund, head-following at 250 ms</>}
        source="docs/evidence/phase4-testnet-exits.md"
      />
      <Item
        value={`${MEASURED.attestCostUsdc} USDC`}
        label="to attest one result on Arc"
        detail={<>Gas is paid in USDC, so every scan can be attested</>}
        source="docs/REGISTRY.md §4.4"
      />
    </dl>
  );
}

function Item({ value, label, detail, source }: { value: string; label: string; detail: ReactNode; source: string }) {
  return (
    <div className="grid gap-x-8 gap-y-1 py-6 sm:grid-cols-[minmax(0,15rem)_1fr_auto] sm:items-baseline">
      <dt className="num text-[22px] tracking-[-0.01em] text-fg sm:text-[26px]">{value}</dt>
      <dd>
        <div className="text-[15px] text-fg">{label}</div>
        <div className="mt-1 text-[13px] text-muted">{detail}</div>
      </dd>
      <dd className="num text-[12px] text-subtle sm:text-right">{source}</dd>
    </div>
  );
}
