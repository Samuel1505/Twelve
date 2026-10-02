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
