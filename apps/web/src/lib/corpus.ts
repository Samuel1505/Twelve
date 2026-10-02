import "server-only";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Everything on /corpus is read from the repository at build/request time: no hand-copied numbers.
const ROOT = join(process.cwd(), "..", "..");
const CORPUS = join(ROOT, "corpus");

const Baseline = z.object({
  highRecall: z.tuple([z.number(), z.number()]),
  highSafeFp: z.number(),
  rules: z.record(z.string(), z.object({ matched: z.number(), expected: z.number(), safeFp: z.number() })),
});
const Expect = z.object({
  findings: z.array(z.object({ rule: z.string(), severity: z.string(), function: z.string(), line: z.number() })),
  verdict: z.string().optional(),
  safeVerdict: z.string().optional(),
});

export type Hunk = { lines: { kind: " " | "-" | "+"; text: string; a?: number; b?: number }[] };
export type Case = {
  id: string; name: string; kind: "pair" | "negative" | "typed"; pattern: string;
  expect: z.infer<typeof Expect>["findings"]; hunks: Hunk[]; source?: string;
};

export function metrics() {
  const read = (f: string) => Baseline.parse(JSON.parse(readFileSync(join(CORPUS, f), "utf8")));
  const casesOf = (f: string) => Number(/cases:\s*(\d+)/.exec(readFileSync(join(CORPUS, f), "utf8"))?.[1] ?? 0);
  return {
    source: { ...read("METRICS.baseline.json"), cases: casesOf("METRICS.md") },
    deployed: { ...read("METRICS.deployed.baseline.json"), cases: casesOf("METRICS.deployed.md") },
  };
}

/** Pattern descriptions from the spec table (docs/CORPUS_AND_TESTING.md §2). */
function patterns(): Map<string, string> {
  const doc = readFileSync(join(ROOT, "docs", "CORPUS_AND_TESTING.md"), "utf8");
  const out = new Map<string, string>();
  for (const m of doc.matchAll(/^\| (c\d{2}) \| [^|]+ \| (.+?) \| [^|]+ \|$/gm)) out.set(m[1]!, m[2]!.trim());
  const hard = /^Hard negatives[^:]*:(.*)$/m.exec(doc)?.[1] ?? "";
  for (const m of hard.matchAll(/`(h\d{2})` ([^;]+?)(?:;|\.\s*$|$)/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

export function cases(): Case[] {
  const pats = patterns();
  return readdirSync(CORPUS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[ch]\d{2}_/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((dir): Case => {
      const id = dir.slice(0, 3);
      const name = dir.slice(4).replaceAll("_", " ");
      const p = (f: string) => join(CORPUS, dir, f);
      const expect = existsSync(p("expect.json")) ? Expect.parse(JSON.parse(readFileSync(p("expect.json"), "utf8"))).findings : [];
      const pattern = pats.get(id) ?? "";
      const bug = existsSync(p("bug.sol")) ? readFileSync(p("bug.sol"), "utf8") : null;
      const safe = existsSync(p("safe.sol")) ? readFileSync(p("safe.sol"), "utf8") : null;
      if (bug && safe) return { id, name, kind: "pair", pattern, expect, hunks: diff(bug, safe) };
      const only = bug ?? safe ?? "";
      return { id, name, kind: id.startsWith("h") ? "negative" : "typed", pattern, expect, hunks: [], source: excerpt(only) };
    });
}

/** The contract body without license/pragma boilerplate, capped so a page of cases stays readable. */
function excerpt(src: string, max = 40): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^(contract|library|interface|abstract|type|using|\/\/\/)/.test(l));
  return lines.slice(Math.max(0, start), Math.max(0, start) + max).join("\n").trimEnd();
}

/** Line diff (LCS) grouped into hunks with one line of context. Corpus files are small, so O(n·m) is fine. */
export function diff(a: string, b: string, context = 1): Hunk[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  const ops: Hunk["lines"] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) ops.push({ kind: " ", text: A[i]!, a: ++i, b: ++j });
    // removals before additions, as in a unified diff
    else if (i < n && (j >= m || L[i + 1]![j]! >= L[i]![j + 1]!)) ops.push({ kind: "-", text: A[i]!, a: ++i });
    else ops.push({ kind: "+", text: B[j]!, b: ++j });
  }
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastChange = -Infinity;
  ops.forEach((op, k) => {
    if (op.kind !== " ") {
      if (!cur || k - lastChange > 2 * context + 1) {
        cur = { lines: ops.slice(Math.max(0, k - context), k) };
        hunks.push(cur);
      } else {
        cur.lines.push(...ops.slice(lastChange + 1, k));
      }
      cur.lines.push(op);
      lastChange = k;
    }
  });
  // trailing context
  for (const h of hunks) {
    const lastIdx = ops.indexOf(h.lines[h.lines.length - 1]!);
    h.lines.push(...ops.slice(lastIdx + 1, lastIdx + 1 + context).filter((o) => o.kind === " "));
  }
  return hunks;
}
