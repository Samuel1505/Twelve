import type { ReactNode } from "react";
import { Hash } from "@/components/ui/address";
import { CodeBlock } from "@/components/ui/code-block";
import { Pill } from "@/components/ui/unit-chip";
import { type OnchainStatus, type Status } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { utc } from "@/lib/format";

const SENTENCE: Record<OnchainStatus, string> = {
  NONE: "Not attested on-chain yet.",
  CLEAN: "Attested clean. Routers using TwelveGate let native USDC through to it.",
  FINDINGS: "Attested with findings. TwelveGate refuses to send native USDC to it.",
  INCOMPLETE: "Attested as partly analyzed. Consumers decide whether that's enough.",
  STALE: "The code changed after it was attested, so the attestation no longer applies.",
  REVOKED: "The attester revoked it, for example after a proxy upgrade.",
};

export function AttestationPanel({ status, attestTx }: { status: Status; attestTx?: string | undefined }) {
  const oc = status.onchain;
  const shown = status.report?.reportHash;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-elev">
      <header className="border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-medium text-fg">On-chain attestation</h2>
      </header>
      {!oc && <p className="px-5 py-4 text-[13px] text-muted">This server doesn&apos;t have a registry configured, so there&apos;s nothing on-chain to show.</p>}
      {oc && "error" in oc && (
        <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">The registry couldn&apos;t be read just now. The report below is unaffected; reload to try again.</p>
      )}
      {oc && !("error" in oc) && (
        <>
          <div className="space-y-2 px-5 py-4">
            <Pill tone={oc.status} />
            <p className="text-[13.5px] leading-relaxed text-muted">{SENTENCE[oc.status]}</p>
            {oc.proxyNote && <p className="text-[12.5px] leading-relaxed text-subtle">Proxy: {oc.proxyNote}.</p>}
          </div>
          {oc.status !== "NONE" && (
            <dl className="divide-y divide-line border-t border-line text-[13px]">
              <Row k="Report hash" v={
                <span className="flex flex-wrap items-center gap-2">
                  <Hash value={oc.reportHash} kind="none" head={10} tail={6} />
                  {shown && (oc.reportHash.toLowerCase() === shown.toLowerCase()
                    ? <span className="text-[12px] text-ok">matches this report</span>
                    : <span className="text-[12px] text-v18">differs from this report</span>)}
                </span>} />
              <Row k="Codehash" v={<Hash value={oc.codehash} kind="none" head={10} tail={6} />} />
              {oc.attestedAt > 0 && <Row k="Attested" v={<span className="num">{utc(oc.attestedAt)}</span>} />}
              {oc.implementation && <Row k="Implementation" v={<Hash value={oc.implementation} />} />}
              {attestTx && <Row k="Transaction" v={<Hash value={attestTx} kind="tx" />} />}
            </dl>
          )}
          <dl className="divide-y divide-line border-t border-line text-[13px]">
            <Row k="Registry" v={<Hash value={oc.registry} />} />
            <Row k="Attester" v={<Hash value={oc.attester} />} />
          </dl>
        </>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 whitespace-nowrap text-subtle">{k}</dt>
      <dd className="min-w-0 text-right text-fg">{v}</dd>
    </div>
  );
}

export function VerifyPanel({ hash }: { hash: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[14px] font-medium text-fg">Check it yourself</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Rebuilds the report from the chain with the same tool version and compares the hash.
        </p>
      </div>
      <CodeBlock
        lang="sh"
        lineNumbers={false}
        code={`API=${API_URL}
H=${hash}
curl -so report.json "$API/v1/reports/$H"
uv run twelve verify --report report.json`}
      />
    </section>
  );
}

export function BuildFacts({ status }: { status: Status }) {
  const core = status.report?.core;
  if (!core) return null;
  const m = core.input.bytecodeMatch;
  const usdc = core.bindings.filter((b) => b.value === "0x3600000000000000000000000000000000000000");
  const opt = core.input.optimizer as { enabled?: boolean; runs?: number };
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <header className="border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-medium text-fg">What was analyzed</h2>
      </header>
      <dl className="divide-y divide-line text-[13px]">
        <Row k="Bytecode" v={m ? <span className="text-ok">{m.status === "exact" ? "matches on-chain" : "matches"}{m.maskedRanges.length ? <span className="text-subtle"> · {m.maskedRanges.length} immutables masked</span> : null}</span> : "—"} />
        <Row k="Compiler" v={<span className="num">{core.input.compiler.split("+")[0]}</span>} />
        <Row k="EVM · optimizer" v={<span className="num">{core.input.evmVersion} · {opt.enabled ? `${opt.runs ?? "on"} runs` : "off"}</span>} />
        <Row k="USDC bound as" v={usdc.length ? <span className="num">{usdc.map((b) => b.var.split(".").pop()).join(", ")}</span> : <span className="text-subtle">not referenced</span>} />
        <Row k="Functions" v={<span className="num">{core.coverage.functionsAnalyzed}</span>} />
        {core.input.bindingBlock !== undefined && <Row k="Read at block" v={<span className="num">{core.input.bindingBlock.toLocaleString("en-US")}</span>} />}
        <Row k="Tool" v={<span className="num">{core.tool.version}</span>} />
      </dl>
    </section>
  );
}
