// Numbers shown on the site. Each is produced by the tool and cited to its source in the repo; nothing is estimated
// for marketing (DEMO_SCRIPT §3). Corpus figures are read from the committed metric baselines at build time.
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Baseline = z.object({ highRecall: z.tuple([z.number(), z.number()]), highSafeFp: z.number() });

function baseline(file: string): z.infer<typeof Baseline> {
  const path = join(process.cwd(), "..", "..", "corpus", file);
  return Baseline.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function corpusMetrics() {
  const source = baseline("METRICS.baseline.json");
  const deployed = baseline("METRICS.deployed.baseline.json");
  return {
    highCaught: source.highRecall[0] + deployed.highRecall[0],
    highPlanted: source.highRecall[1] + deployed.highRecall[1],
    highSafeFp: source.highSafeFp + deployed.highSafeFp,
  };
}

/** Full-history mainnet replay, completed 2026-10-02 (docs/MONITOR.md §9). */
export const REPLAY = {
  logs: 67_687_598,
  movements: 43_040_670,
  addresses: 1_249_355,
  d1Alerts: 49,
  d1Contracts: 4,
  d1FalsePositives: 0,
} as const;

/** docs/evidence/phase2-mainnet-sample.md, phase4-testnet-exits.md, REGISTRY.md §4.4 */
export const MEASURED = {
  matched: 15,
  scanned: 15,
  alertLatency: "0.94 s",
  attestCostUsdc: "0.0025",
} as const;

/** Deployed-mode sample of verified mainnet contracts, 2026-09-30 (docs/evidence/phase2-mainnet-sample.md).
 * Aggregates only: CORPUS_AND_TESTING §6 forbids naming third-party contracts on /sweep. */
export const SAMPLE = {
  date: "2026-09-30",
  blocks: [23_581_831, 23_582_115] as const,
  scanned: 15,
  exact: 10,
  masked: 5, // identical executable code; only CBOR metadata or linked libraries differ
  matchFailed: 0,
  verdicts: { CLEAN: 15, FINDINGS: 0, INCOMPLETE: 0 },
  compilers: [["0.7.6", 5], ["0.8.24", 4], ["0.8.26", 5], ["0.8.28", 1]] as const,
  medianSeconds: 8.8,
  toolBugsFixed: 2, // factory metadata masking; over-eager UNSUPPORTED_ASM
} as const;

/** Detector results over all of mainnet history, blocks 0–23.78M (docs/MONITOR.md §9). */
export const REPLAY_DETECTORS = [
  { id: "D1", alerts: "49", contracts: "4", tp: "49", fp: "0", note: "Every alert is the 10¹² fingerprint." },
  { id: "D2", alerts: "≤ 50", contracts: "35", tp: "1", fp: "14", note: "Settlement dust on routers and pools; 35 unverified or smart-account senders not individually classified." },
  { id: "D3", alerts: "55", contracts: "55", tp: "0", fp: "55", note: "Lifecycle sweeps such as a final LP exit. Reported as “possible drain” by design." },
  { id: "PAIRING", alerts: "0", contracts: "–", tp: "–", fp: "–", note: "Every ERC-20 Transfer had its native twin." },
] as const;

/** Third-party true positives under responsible disclosure (D1: 4 contracts, D2: 1 account). */
export const UNDER_DISCLOSURE = 5;
