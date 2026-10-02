import type { ReactNode } from "react";
import { AlertTicker } from "@/components/landing/alert-ticker";
import { Evidence } from "@/components/landing/evidence";
import { Layers } from "@/components/landing/layers";
import { Ledger } from "@/components/landing/ledger";
import { ScanForm } from "@/components/landing/scan-form";
import { CodeBlock } from "@/components/ui/code-block";
import { ButtonLink } from "@/components/ui/button";
import { parseUsdc6, toUsdc18 } from "@twelve/shared/units";
import { API_URL, MAINNET } from "@/lib/config";

const ONE_USDC6 = parseUsdc6("1");

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-[1120px] px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:pb-28">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
          <div className="lg:pt-6">
            <h1 className="text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] text-fg sm:text-[60px]">
              One USDC.
              <br />
              <span className="text-muted">Two numbers.</span>
            </h1>
            <p className="mt-6 max-w-[48ch] text-[16px] leading-[1.7] text-muted">
              On Arc the same balance reads <span className="num text-v6">{ONE_USDC6.toString()}</span> through the ERC-20 and{" "}
              <span className="num text-v18">{toUsdc18(ONE_USDC6).toString()}</span> natively. Code that mixes the two misprices by a factor
              of a trillion. Twelve finds that line before you deploy, attests the verdict on-chain, and catches the transaction
              after.
            </p>
            <div id="scan" className="mt-9 max-w-[560px] scroll-mt-24">
              <ScanForm />
            </div>
          </div>
          <Ledger />
        </div>
      </section>

      {/* Live */}
      <Section
        title="Live on mainnet"
        lead="The monitor reads every USDC movement on Arc and raises an alert the moment the same raw number crosses views."
        aside={<ButtonLink href="/alerts" variant="ghost">All alerts</ButtonLink>}
      >
        <AlertTicker />
      </Section>

      {/* Layers */}
      <Section
        title="Four layers against one bug"
        lead="Each stage below shows a real artifact produced by Twelve, not an illustration."
      >
        <Layers />
      </Section>

      {/* Evidence */}
      <Section
        title="Measured, with sources"
        lead="Numbers produced by the current tool, each traceable to a file in the repository."
        aside={<ButtonLink href="/corpus" variant="ghost">Corpus results</ButtonLink>}
      >
        <Evidence />
      </Section>

      {/* Verify */}
      <Section
        title="Don't trust it. Rerun it."
        lead="Reports are canonical JSON hashed with keccak256. The same verified source and tool version give the same hash anyone can compare with the one on-chain."
      >
        <div className="grid gap-4">
          <CodeBlock
            lang="sh"
            lineNumbers={false}
            title="Recompute a report from the chain"
            code={`uv run twelve scan --chain arc --json \\
    --address ${MAINNET.leakyRefund} > report.json
uv run twelve verify --report report.json`}
          />
          <CodeBlock
            lang="sh"
            lineNumbers={false}
            title="Read the verdict and alerts over HTTP"
            code={`curl ${API_URL}/v1/status/${MAINNET.leakyRefund}?chainId=5042`}
          />
        </div>
      </Section>

      {/* Closing */}
      <section className="mx-auto max-w-[1120px] px-5 pt-28 sm:px-8">
        <div className="rounded-2xl border border-line bg-elev px-6 py-10 sm:px-12 sm:py-14">
          <h2 className="max-w-[24ch] text-[28px] font-semibold leading-tight tracking-[-0.025em] text-fg sm:text-[34px]">
            Check a contract before you send it a cent.
          </h2>
          <div className="mt-8 max-w-[560px]">
            <ScanForm size="md" />
          </div>
        </div>
      </section>
    </>
  );
}

function Section({ title, lead, aside, children }: { title: string; lead: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-[1120px] px-5 pt-24 sm:px-8 sm:pt-32">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px] font-semibold tracking-[-0.025em] text-fg sm:text-[32px]">{title}</h2>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.7] text-muted">{lead}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
