import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { Hash } from "@/components/ui/address";
import { CodeBlock } from "@/components/ui/code-block";
import { Pill, UnitChip } from "@/components/ui/unit-chip";
import { MAINNET, explorerTx } from "@/lib/config";
import { cn } from "@/lib/cn";
import report from "@/content/leaky-refund.report.json";

/** Slither reports 1-based columns; the code block underlines a 0-based [start, end) range. */
const toRange = (startCol: number, endCol: number): [number, number] => [startCol - 1, endCol - 1];

function leakySource(from: number, to: number): string {
  const src = readFileSync(join(process.cwd(), "..", "..", "contracts", "src", "demo", "LeakyRefund.sol"), "utf8");
  return src.split("\n").slice(from - 1, to).join("\n");
}

/** The compile-fail fixture (contracts/fixtures/compile-fail/Mix.sol), from `contract` to the end. */
function mixFixture(): { code: string; first: number; line: number; col: [number, number] } {
  const lines = readFileSync(join(process.cwd(), "..", "..", "contracts", "fixtures", "compile-fail", "Mix.sol"), "utf8")
    .replace(/\n$/, "").split("\n");
  const start = lines.findIndex((l) => l.startsWith("contract "));
  const at = lines.findIndex((l) => l.includes("paid + balance"));
  const c = lines[at]!.indexOf("paid + balance");
  return { code: lines.slice(start).join("\n"), first: start + 1, line: at + 1, col: [c, c + "paid + balance".length] };
}

export function Layers() {
  const mix = mixFixture();
  const f = report.reportCore.findings[0]!;
  const loc = f.location;
  const excerptFrom = loc.startLine - 5;
  return (
    <div className="space-y-24 sm:space-y-32">
      <Layer
        n="01"
        when="Before deploy"
        title="The analyzer finds the line"
        body={
          <>
            It follows the decimal unit of every USDC value through the compiled contract and stops where 6 meets 18. For a
            deployed contract it first rebuilds the verified source and checks the bytecode against the chain, so the report
            is about the code that is actually live.
          </>
        }
        artifact={
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Pill tone="HIGH" />
              <span className="num text-fg">{f.rule}</span>
              <span className="text-muted">Native sink receives a 6-decimal value</span>
              <span className="ml-auto text-[12px] text-subtle">confidence {f.confidence.toLowerCase()}</span>
            </div>
            <CodeBlock
              code={leakySource(excerptFrom, loc.startLine + 2)}
              firstLine={excerptFrom}
              highlight={loc.startLine}
              underline={toRange(loc.startCol, loc.endCol)}
              title={`${loc.file} · ${f.contract}.${f.function}`}
            />
            <Trace />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-subtle">
              <span>Real output of <span className="num text-muted">twelve scan</span> on this file</span>
              <span className="num">reportHash {report.reportHash.slice(0, 10)}…{report.reportHash.slice(-6)}</span>
            </div>
          </div>
        }
      />

      <Layer
        n="02"
        when="On chain"
        title="The verdict is attested, bound to code"
        body={
          <>
            Each result is written to Arc with the contract&apos;s codehash. If the code changes, the attestation goes stale on
            its own. Any router, wallet or protocol can check it in a single call, and rerun the analyzer to get the same
            hash.
          </>
        }
        artifact={
          <div className="space-y-3">
            <CodeBlock
              title="Refuse native USDC into flagged contracts"
              code={`if (!registry.isClean(ATTESTER, target)) {
    revert TargetNotClean(target, registry.status(ATTESTER, target));
}
(bool ok,) = target.call{value: msg.value}(data);`}
            />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
              <Fact k="Registry" v={<Hash value={MAINNET.registry} />} />
              <Fact k="Target (demo contract)" v={<Hash value="0x5A76D4AB409CA2114808eDD38cB9A8343a34b7Fb" />} />
              <Fact k="Status" v={<span className="flex items-center gap-2"><Pill tone="FINDINGS" /><span className="whitespace-nowrap text-subtle">gate reverts</span></span>} />
              <Fact k="Attest tx" v={<Hash kind="tx" value="0x9862a8c52fd0c59db4cf530c3c2d3e6b1231260ee2245cf4728878624db6bde6" />} />
            </dl>
          </div>
        }
      />

      <Layer
        n="03"
        when="After deploy"
        title="The monitor catches it in flight"
        body={
          <>
            Arc logs every native USDC movement. The monitor pairs those logs with their ERC-20 twins and spots the same raw
            number entering through one view and leaving through the other in one transaction. It needs no source code, so
            it covers unverified contracts too.
          </>
        }
        artifact={
          <div className="overflow-hidden rounded-xl border border-line bg-sunken">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[13px]">
              <Pill tone="HIGH" />
              <span className="text-fg">Cross-view raw equality</span>
              <span className="text-subtle">·</span>
              <Hash value={MAINNET.leakyRefund} className="text-muted" />
              <span className="ml-auto text-[12px] text-subtle">0.94 s after the block</span>
            </div>
            <div className="divide-y divide-line">
              <Flow dir="In" view={6} raw="10000" usdc="0.010000" note="buyer pays, ERC-20 transferFrom" />
              <Flow dir="Out" view={18} raw="10000" usdc="0.00000000000001" note="refund, call{value}" bad />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12px] text-subtle">
              <span>Same integer, different views: <span className="num text-bad">ratio 10⁻¹²</span></span>
              <a className="num underline decoration-line-strong underline-offset-[3px] hover:text-fg" target="_blank" rel="noreferrer"
                href={explorerTx("0x6ef99d2387156f1bf811cc8bb6dbf7a922a97f68fcc1896959ac44448fc193c3")}>
                tx 0x6ef99d…93c3
              </a>
            </div>
          </div>
        }
      />

      <Layer
        n="04"
        when="In your code"
        title="The fix is a type"
        body={
          <>
            Give each view its own type and mixing them stops compiling. Twelve&apos;s guard library defines
            <span className="num text-fg">Usdc6</span> and <span className="num text-fg">Usdc18</span>, with conversions that
            return the dust instead of dropping it. The fixed shop on mainnet uses it and scans clean.
          </>
        }
        artifact={
          <div className="space-y-3">
            <CodeBlock
              title="fixtures/compile-fail/Mix.sol"
              firstLine={mix.first}
              highlight={mix.line}
              underline={mix.col}
              code={mix.code}
            />
            <div className="rounded-xl border border-bad/25 bg-bad-soft px-4 py-3">
              <p className="num text-[12.5px] leading-relaxed text-fg/90">
                <span className="text-bad">Error:</span> The type of the second operand of this user-defined binary operator
                + does not match the type of the first operand, which is Usdc6.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
              <Fact k="FixedRefund (typed)" v={<Hash value={MAINNET.fixedRefund} />} />
              <Fact k="Status" v={<Pill tone="CLEAN" />} />
            </dl>
          </div>
        }
      />
    </div>
  );
}

function Layer({ n, when, title, body, artifact }: {
  n: string; when: string; title: string; body: ReactNode; artifact: ReactNode;
}) {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div className="lg:pt-2">
        <div className="flex items-center gap-3 text-[13px]">
          <span className="num text-subtle">{n}</span>
          <span className="h-px w-6 bg-line-strong" />
          <span className="text-muted">{when}</span>
        </div>
        <h3 className="mt-4 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[28px]">{title}</h3>
        <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.7] text-muted">{body}</p>
      </div>
      <div className="min-w-0">{artifact}</div>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="bg-sunken px-4 py-3">
      <dt className="text-[12px] text-subtle">{k}</dt>
      <dd className="mt-1 text-fg">{v}</dd>
    </div>
  );
}

function Flow({ dir, view, raw, usdc, note, bad }: {
  dir: string; view: 6 | 18; raw: string; usdc: string; note: string; bad?: boolean;
}) {
  return (
    <div className="grid grid-cols-[36px_1fr] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[44px_1fr_auto]">
      <span className="text-[12px] text-subtle">{dir}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="num text-[14px] text-fg">{raw}</span>
          <UnitChip exp={view} label={view === 6 ? "erc20 · 6 dec" : "native · 18 dec"} />
        </div>
        <div className="mt-0.5 text-[12px] text-subtle">{note}</div>
      </div>
      <span className={cn("num col-start-2 text-[13px] sm:col-start-auto", bad ? "text-bad" : "text-fg")}>{usdc} USDC</span>
    </div>
  );
}

function Trace() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sunken px-4 py-3 text-[12.5px]">
      <span className="text-subtle">Unit trace</span>
      <span className="num inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-fg">
        paid6 <UnitChip exp={6} label="[1,6]" />
      </span>
      <span className="text-subtle">← transferFrom amount</span>
      <span aria-hidden className="text-subtle">→</span>
      <span className="num inline-flex items-center gap-1.5 rounded-md border border-bad/40 bg-bad-soft px-2 py-1 text-fg">
        call{"{value}"} expects <UnitChip exp={18} label="[1,18]" />
      </span>
    </div>
  );
}
