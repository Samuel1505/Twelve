import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, lead, children }: {
  eyebrow?: string; title: string; lead: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="max-w-[720px]">
      {eyebrow && <p className="text-[13px] text-subtle">{eyebrow}</p>}
      <h1 className="mt-2 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] text-fg sm:text-[44px]">{title}</h1>
      <p className="mt-4 text-[16px] leading-[1.7] text-muted">{lead}</p>
      {children}
    </header>
  );
}
