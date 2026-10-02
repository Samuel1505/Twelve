import { Hash } from "@/components/ui/address";
import { MAINNET } from "@/lib/config";
import { Mark } from "./header";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2">
            <Mark />
            <span className="text-[15px] font-semibold text-fg">Twelve</span>
          </div>
          <p className="mt-3 max-w-[40ch] text-[13px] leading-relaxed text-muted">
            The decimal-safety layer for Arc. It only exists because Arc does: one USDC balance, two views, twelve digits apart.
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-2 text-[13px]">
          <dt className="text-subtle">Network</dt>
          <dd className="num text-muted">Arc mainnet · 5042</dd>
          <dt className="text-subtle">Registry</dt>
          <dd><Hash value={MAINNET.registry} className="text-muted" /></dd>
          <dt className="text-subtle">Gate</dt>
          <dd><Hash value={MAINNET.gate} className="text-muted" /></dd>
          <dt className="text-subtle">Attester</dt>
          <dd><Hash value={MAINNET.attester} className="text-muted" /></dd>
        </dl>
      </div>
    </footer>
  );
}
