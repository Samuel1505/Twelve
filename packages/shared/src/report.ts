// Report schema v1, mirrored from analyzer/twelve/report.py (docs/ANALYZER.md §7). Parsed at every boundary.
import canonicalize from "canonicalize";
import { keccak256, toHex, type Hex } from "viem";
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const unit = z.union([z.tuple([z.number().int(), z.number().int()]), z.string(), z.null()]);

export const Severity = z.enum(["HIGH", "MEDIUM", "LOW", "INFO"]);
export const Verdict = z.enum(["CLEAN", "FINDINGS", "INCOMPLETE"]);

export const TraceStep = z.object({
  step: z.string(),
  expr: z.string(),
  loc: z.string(),
  unit: z.tuple([z.number().int(), z.number().int()]).optional(),
  expects: z.tuple([z.number().int(), z.number().int()]).optional(),
});

export const Finding = z.object({
  id: hex32,
  rule: z.string().regex(/^TW-\d{3}$/),
  severity: Severity,
  confidence: z.enum(["DEFINITE", "INFERRED", "HEURISTIC"]),
  contract: z.string(),
  function: z.string(),
  location: z.object({
    file: z.string(),
    startLine: z.number().int(),
    endLine: z.number().int(),
    startCol: z.number().int(),
    endCol: z.number().int(),
  }),
  left: z.object({ unit, expr: z.string() }).optional(),
  right: z.object({ unit, expr: z.string() }).optional(),
  trace: z.array(TraceStep),
  message: z.string(),
  fix: z.string(),
});

export const DeployedTarget = z.object({
  chainId: z.number().int(),
  address,
  codehash: hex32,
  kind: z.enum(["contract", "eip1967Proxy", "beaconProxy", "zosProxy", "eip1167Clone"]),
  implementation: z.object({ address, codehash: hex32 }).optional(),
});
export const SourceTarget = z.object({ kind: z.literal("source"), files: z.array(z.string()) });

export const ReportCore = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  tool: z.object({ name: z.literal("twelve"), version: z.string(), gitCommit: z.string(),
    slither: z.string(), rulesHash: hex32 }),
  target: z.union([DeployedTarget, SourceTarget]),
  input: z.object({
    standardJsonHash: hex32,
    compiler: z.string(),
    evmVersion: z.string(),
    optimizer: z.record(z.string(), z.unknown()),
    bytecodeMatch: z.object({ status: z.enum(["exact", "masked"]),
      maskedRanges: z.array(z.tuple([z.number().int(), z.number().int()])) }).optional(),
    bindingBlock: z.number().int().optional(),
  }),
  bindings: z.array(z.object({ var: z.string(), value: address, method: z.string(), mutable: z.boolean() })),
  findings: z.array(Finding),
  coverage: z.object({
    functionsAnalyzed: z.number().int(),
    unsupported: z.array(z.object({ function: z.string(), reason: z.string() })),
  }),
  verdict: Verdict,
});
export type ReportCore = z.infer<typeof ReportCore>;

/** Output of `twelve scan --json` (success) or its structured error. */
export const AnalyzerOutput = z.union([
  z.object({ reportHash: hex32, reportCore: ReportCore, meta: z.record(z.string(), z.unknown()) }),
  z.object({ error: z.object({ code: z.string(), type: z.string(), message: z.string() }) }),
]);
export type AnalyzerOutput = z.infer<typeof AnalyzerOutput>;

/** RFC 8785 canonical JSON text (the exact bytes that are hashed and served). */
export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError("value is not canonicalizable");
  return canonical;
}

/** reportHash = keccak256(JCS(reportCore)) (I6, ADR-006) — must equal the Python analyzer's value byte for byte. */
export function reportHash(core: unknown): Hex {
  return keccak256(toHex(canonicalJson(core)));
}

export const VERDICT_CODE = { CLEAN: 1, FINDINGS: 2, INCOMPLETE: 3 } as const;
