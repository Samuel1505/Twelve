import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/site/page-header";
import { REPLAY, REPLAY_DETECTORS, SAMPLE, UNDER_DISCLOSURE } from "@/lib/evidence";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Mainnet · Twelve" };

const n = (x: number) => x.toLocaleString("en-US");

export default function SweepPage() {
  const total = SAMPLE.compilers.reduce((s, [, c]) => s + c, 0);
  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
      <PageHeader
        eyebrow="Arc mainnet"
        title="What we've measured"
        lead={<>Results from running Twelve against real mainnet contracts and every USDC movement since genesis. Counts only:
          a contract with an open finding isn&apos;t named here until its owner has had the chance to fix it.</>}
      />

      <p className="mt-8 max-w-[720px] rounded-xl border border-line bg-elev px-4 py-3 text-[13.5px] leading-relaxed text-muted">
        <span className="text-fg">The full sweep of every verified contract hasn&apos;t run yet.</span> This page shows the two
        measurements made so far and will carry the sweep, with its date and tool version, when it does.
      </p>

      <Block
        title="Analyzer on verified contracts"
        meta={`Sample of ${SAMPLE.scanned}, ${SAMPLE.date}, blocks ${n(SAMPLE.blocks[0])}–${n(SAMPLE.blocks[1])}`}
        source="docs/evidence/phase2-mainnet-sample.md"
        lead="Each contract's verified source was rebuilt and compiled with its original settings, then compared byte for byte with the code on-chain before any analysis. One contract per name, in explorer order."
      >
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          <Stat v={`${SAMPLE.exact + SAMPLE.masked} / ${SAMPLE.scanned}`} k="matched on-chain code" d={`${SAMPLE.exact} exact, ${SAMPLE.masked} differ only in metadata`} />
          <Stat v={String(SAMPLE.matchFailed)} k="failed to match" d="none skipped" />
          <Stat v={String(SAMPLE.verdicts.CLEAN)} k="clean" tone="ok" d={`${SAMPLE.verdicts.FINDINGS} with findings, ${SAMPLE.verdicts.INCOMPLETE} incomplete`} />
          <Stat v={`${SAMPLE.medianSeconds} s`} k="median scan" d="fetch, rebuild, compile, match, analyze" />
        </dl>
        <div className="mt-6 rounded-2xl border border-line px-5 py-4">
          <div className="text-[12px] text-subtle">Compilers in the sample</div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-elev-2">
            {SAMPLE.compilers.map(([v, c], i) => (
              <div key={v} className={cn("h-full", ["bg-fg/70", "bg-fg/45", "bg-fg/25", "bg-fg/12"][i])} style={{ width: `${(c / total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
            {SAMPLE.compilers.map(([v, c], i) => (
              <li key={v} className="flex items-center gap-2">
                <span aria-hidden className={cn("size-2 rounded-sm", ["bg-fg/70", "bg-fg/45", "bg-fg/25", "bg-fg/12"][i])} />
                <span className="num text-fg">solc {v}</span><span className="num text-subtle">{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          The run also found {SAMPLE.toolBugsFixed} bugs in Twelve itself (a factory whose embedded child carries its own
          metadata, and assembly that was flagged too eagerly). Both are fixed and covered by tests.
        </p>
      </Block>

      <Block
        title="Monitor over all of mainnet history"
        meta="Blocks 0 – 23.78M, completed 2026-10-02"
        source="docs/MONITOR.md §9"
        lead="Every USDC Transfer log since genesis replayed through the same detectors that run live, then every alert triaged by hand."
      >
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          <Stat v={n(REPLAY.logs)} k="Transfer logs" d="both views, paired" />
          <Stat v={n(REPLAY.movements)} k="USDC movements" d="after pairing ERC-20 and native twins" />
          <Stat v={n(REPLAY.addresses)} k="addresses profiled" d="contracts resolved only when they alert" />
        </dl>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-subtle">
              <tr>
                <th className="px-5 py-3 font-normal">Detector</th>
                <th className="px-3 py-3 text-right font-normal">Alerts</th>
                <th className="px-3 py-3 text-right font-normal">Contracts</th>
                <th className="px-3 py-3 text-right font-normal">Real bugs</th>
                <th className="px-3 py-3 text-right font-normal">False alarms</th>
                <th className="px-5 py-3 font-normal">Triage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {REPLAY_DETECTORS.map((d) => (
                <tr key={d.id}>
                  <td className="num px-5 py-3 text-fg">{d.id}</td>
                  <td className="num px-3 py-3 text-right text-muted">{d.alerts}</td>
                  <td className="num px-3 py-3 text-right text-muted">{d.contracts}</td>
                  <td className={cn("num px-3 py-3 text-right", d.tp !== "0" && d.tp !== "–" ? "text-bad" : "text-muted")}>{d.tp}</td>
                  <td className={cn("num px-3 py-3 text-right", d.fp === "0" ? "text-ok" : "text-muted")}>{d.fp}</td>
                  <td className="max-w-[340px] px-5 py-3 leading-relaxed text-muted">{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          D1 is the detector that defines the bug, and none of its alerts were wrong. D3 is deliberately broad: it reports
          any contract emptying itself in one go and leaves the judgement to a person, so its false alarms are expected.
        </p>
      </Block>

      <section className="mt-20 grid gap-6 rounded-2xl border border-line bg-elev px-6 py-7 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:px-8">
        <div className="num text-[44px] leading-none tracking-[-0.02em] text-bad">{UNDER_DISCLOSURE}</div>
        <div>
          <h2 className="text-[16px] font-semibold text-fg">third-party contracts under disclosure</h2>
          <p className="mt-1.5 max-w-[64ch] text-[13.5px] leading-relaxed text-muted">
            Live contracts on mainnet that move USDC with the wrong unit. Their owners are told first, with a reproduction
            on testnet that never touches their funds. They&apos;re named here only after a fix, or after a reasonable window.
          </p>
        </div>
      </section>
    </div>
  );
}

function Block({ title, meta, source, lead, children }: { title: string; meta: string; source: string; lead: string; children: ReactNode }) {
  return (
    <section className="mt-20">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{title}</h2>
          <p className="num mt-1.5 text-[12px] text-subtle">{meta}</p>
        </div>
        <span className="num text-[12px] text-subtle">{source}</span>
      </div>
      <p className="mb-6 max-w-[70ch] text-[14.5px] leading-[1.7] text-muted">{lead}</p>
      {children}
    </section>
  );
}

function Stat({ v, k, d, tone }: { v: string; k: string; d: string; tone?: "ok" }) {
  return (
    <div className="bg-bg px-5 py-5">
      <dt className="sr-only">{k}</dt>
      <dd>
        <div className={cn("num text-[26px] leading-none tracking-[-0.02em]", tone === "ok" ? "text-ok" : "text-fg")}>{v}</div>
        <div className="mt-2.5 text-[13.5px] text-fg">{k}</div>
        <div className="mt-1 text-[12px] leading-relaxed text-subtle">{d}</div>
      </dd>
    </div>
  );
}
