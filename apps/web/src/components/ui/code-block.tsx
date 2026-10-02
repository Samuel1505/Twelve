import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";

/**
 * Minimal, deterministic Solidity/shell highlighter (server-rendered). Highlights one "collision" line and, optionally,
 * underlines the exact column range the analyzer reported (location.startCol/endCol, 0-based).
 */
const KEYWORDS = new Set([
  "pragma", "solidity", "contract", "interface", "library", "function", "modifier", "returns", "return", "external",
  "public", "internal", "private", "view", "pure", "payable", "if", "else", "revert", "require", "emit", "event",
  "error", "constant", "immutable", "memory", "storage", "calldata", "type", "is", "using", "for", "global", "new",
  "bool", "address", "uint256", "uint8", "bytes", "bytes32", "string", "mapping", "true", "false",
]);

type Tok = { t: string; c: string };

function tokenize(line: string, lang: "sol" | "sh"): Tok[] {
  const out: Tok[] = [];
  const re = lang === "sh"
    ? /(#.*$)|("[^"]*"|'[^']*')|(--?[\w-]+)|(0x[0-9a-fA-F]+)|(\s+)|([^\s]+)/g
    : /(\/\/.*$)|("[^"]*")|(0x[0-9a-fA-F]+|\b\d[\d_]*\b)|([A-Za-z_][\w]*)|(\s+)|([^\sA-Za-z_\d"])/g;
  for (const m of line.matchAll(re)) {
    const [s, comment, str, a, b] = m;
    if (lang === "sh") {
      if (comment) out.push({ t: s, c: "text-subtle" });
      else if (str) out.push({ t: s, c: "text-ok" });
      else if (a) out.push({ t: s, c: "text-v6" });
      else if (b) out.push({ t: s, c: "text-v18" });
      else out.push({ t: s, c: "text-fg" });
      continue;
    }
    const ident = m[4];
    if (comment) out.push({ t: s, c: "text-subtle italic" });
    else if (str) out.push({ t: s, c: "text-ok" });
    else if (a) out.push({ t: s, c: "text-v18" });
    else if (ident && KEYWORDS.has(ident)) out.push({ t: s, c: "text-muted" });
    else if (ident && /^[A-Z]/.test(ident)) out.push({ t: s, c: "text-v6" });
    else out.push({ t: s, c: "text-fg/90" });
  }
  return out;
}

function renderLine(line: string, lang: "sol" | "sh", underline?: [number, number]): ReactNode {
  const toks = tokenize(line, lang);
  if (!underline) return toks.map((k, i) => <span key={i} className={k.c}>{k.t}</span>);
  // split tokens at the underline boundaries so the wavy mark covers exactly the reported columns
  const [u0, u1] = underline;
  const nodes: ReactNode[] = [];
  let col = 0;
  toks.forEach((k, i) => {
    const start = col;
    const end = col + k.t.length;
    col = end;
    const pieces: [number, number][] = [[start, Math.min(end, u0)], [Math.max(start, u0), Math.min(end, u1)], [Math.max(start, u1), end]];
    pieces.forEach(([a, b], j) => {
      if (b <= a) return;
      const text = k.t.slice(a - start, b - start);
      const marked = j === 1;
      nodes.push(
        <span key={`${i}-${j}`} className={cn(k.c, marked && "underline decoration-bad decoration-wavy decoration-[1.5px] underline-offset-[5px]")}>
          {text}
        </span>,
      );
    });
  });
  return nodes;
}

/** One highlighted line, for views that lay out lines themselves (diffs). */
export function CodeLine({ text, lang = "sol" }: { text: string; lang?: "sol" | "sh" }) {
  return <>{renderLine(text, lang)}</>;
}

export function CodeBlock({
  code, lang = "sol", firstLine = 1, highlight, underline, title, copy = true, className, lineNumbers = true,
}: {
  code: string; lang?: "sol" | "sh"; firstLine?: number; highlight?: number; underline?: [number, number];
  title?: ReactNode; copy?: boolean; className?: string; lineNumbers?: boolean;
}) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-sunken", className)}>
      {(title || copy) && (
        <div className="flex h-9 items-center justify-between border-b border-line pl-3.5 pr-1.5">
          <div className="num text-[12px] text-subtle">{title}</div>
          {copy && <CopyButton value={code} />}
        </div>
      )}
      <pre className="overflow-x-auto py-3 text-[13px] leading-[1.7]">
        <code className="num grid min-w-max">
          {lines.map((l, i) => {
            const n = firstLine + i;
            const hot = n === highlight;
            return (
              <span key={n} className={cn("relative flex pr-4", hot ? "bg-bad-soft" : "")}>
                {hot && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-bad" />}
                {lineNumbers && (
                  <span aria-hidden className={cn("w-11 shrink-0 select-none pr-4 text-right", hot ? "text-bad" : "text-subtle/60")}>{n}</span>
                )}
                <span className={cn(!lineNumbers && "pl-4")}>{renderLine(l, lang, hot ? underline : undefined)}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
