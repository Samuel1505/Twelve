import type { Metadata } from "next";
import { AlertsFeed } from "@/components/alerts/alerts-feed";
import { PageHeader } from "@/components/site/page-header";

export const metadata: Metadata = { title: "Alerts · Twelve" };

const DETECTORS = [
  {
    id: "D1", sev: "High", name: "Cross-view raw equality",
    text: "In one transaction, the same integer enters a contract through one view and leaves through the other. One variable fed both interfaces unscaled.",
  },
  {
    id: "D2", sev: "Medium", name: "Dust outflow",
    text: "A contract that usually pays out amount X sends X × 10⁻¹² natively: a typical payment written in the wrong view.",
  },
  {
    id: "D3", sev: "Medium", name: "Abnormal sweep",
    text: "A contract that never moves more than a tenth of its balance sends out 90% or more in one transaction.",
  },
  {
    id: "D4", sev: "Info", name: "Attested proxy upgraded",
    text: "A proxy with a Twelve attestation changed its code. The attestation is revoked and a rescan starts.",
  },
  {
    id: "D5", sev: "Info", name: "Funds into a flagged contract",
    text: "USDC is flowing into a contract whose attestation has open findings.",
  },
];

export default function AlertsPage() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
      <PageHeader
        eyebrow="Live monitor · Arc mainnet"
        title="Alerts"
        lead="Every USDC movement on Arc mainnet is read from the chain's own transfer logs and checked against five detectors. Contracts don't need verified source to be covered."
      />
      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <AlertsFeed />
        <aside className="space-y-6 lg:pt-12">
          <section>
            <h2 className="text-[14px] font-medium text-fg">What each detector means</h2>
            <dl className="mt-4 space-y-5">
              {DETECTORS.map((d) => (
                <div key={d.id}>
                  <dt className="flex items-baseline gap-2 text-[13px]">
                    <span className="num text-subtle">{d.id}</span>
                    <span className="text-fg">{d.name}</span>
                    <span className="text-[12px] text-subtle">{d.sev}</span>
                  </dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-muted">{d.text}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border border-line px-4 py-3.5">
            <h2 className="text-[13px] font-medium text-fg">Why some alerts are withheld</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              When an alert points at someone else&apos;s contract, its owner hears about it first. Until then the feed
              shows that it happened, but not where.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
