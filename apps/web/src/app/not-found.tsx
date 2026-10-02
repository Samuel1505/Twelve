import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-5 py-28 sm:px-8">
      <p className="num text-[13px] text-subtle">404</p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.025em] text-fg">Nothing at this address</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        This page doesn&apos;t exist. To check a contract, paste its address on the home page.
      </p>
      <div className="mt-8 flex gap-2">
        <ButtonLink href="/#scan" variant="primary">Scan a contract</ButtonLink>
        <ButtonLink href="/alerts" variant="ghost">Live alerts</ButtonLink>
      </div>
    </div>
  );
}
