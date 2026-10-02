import Link from "next/link";

const NAV = [
  { href: "/alerts", label: "Alerts" },
  { href: "/corpus", label: "Corpus" },
  { href: "/integrate", label: "Integrate" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="pressable flex items-center gap-2 rounded-md" aria-label="Twelve home">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Twelve</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="pressable rounded-md px-2.5 py-1.5 text-muted hover:bg-elev-2 hover:text-fg">
              {n.label}
            </Link>
          ))}
          <Link href="/#scan" className="pressable ml-2 hidden rounded-md bg-fg px-3 py-1.5 font-medium text-bg hover:bg-fg/90 sm:inline-flex">
            Scan a contract
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Two stacked bars of different length: the same value at two scales. */
export function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      <rect x="2" y="5" width="7" height="3" rx="1.5" className="fill-v6" />
      <rect x="2" y="12" width="16" height="3" rx="1.5" className="fill-v18" />
    </svg>
  );
}
