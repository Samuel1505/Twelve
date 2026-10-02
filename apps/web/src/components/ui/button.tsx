import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-fg text-bg hover:bg-fg/90",
  secondary: "bg-elev-2 text-fg border border-line-strong hover:border-fg/25",
  ghost: "text-muted hover:text-fg hover:bg-elev-2",
};

const base =
  "pressable inline-flex h-9 select-none items-center justify-center gap-2 rounded-lg px-3.5 text-[14px] font-medium " +
  "whitespace-nowrap disabled:pointer-events-none disabled:opacity-50";

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(base, styles[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", className, href, children, external }: {
  variant?: Variant; className?: string; href: string; children: ReactNode; external?: boolean;
}) {
  if (external) {
    return (
      <a className={cn(base, styles[variant], className)} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <Link className={cn(base, styles[variant], className)} href={href}>{children}</Link>;
}
