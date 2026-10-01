// Scan state machine (docs/ARCHITECTURE.md §3). One job = one scan; every transition writes scan_events and
// is published to SSE subscribers. Reports that did not match on-chain code never exist (I5), so never attest.
import { getAddress, type Hex, type PublicClient } from "viem";
import { VERDICT_CODE, canonicalJson, reportHash, type ReportCore } from "@twelve/shared";
import type { Analyzer } from "./analyzer.js";
import { toolVersionString } from "./analyzer.js";
import type { AttestRequest, Attester } from "./attester.js";
import { codehashOf } from "./chain.js";
import { CHAINS, type ChainId } from "./config.js";
import {
  attestedReport, findReport, getReport, getScan, insertReport, setState, upsertAttestation, type Db,
} from "./db.js";
import type { ScanBus } from "./events.js";

export type ScanDeps = {
  db: Db;
  bus: ScanBus;
  analyzer: Analyzer;
  attester: Attester | null; // null: attestation disabled (no key configured) → scans end at DONE unattested
  clients: Partial<Record<ChainId, PublicClient>>;
};

async function transition(d: ScanDeps, id: string, state: string, patch: Parameters<typeof setState>[3] = {}) {
  await setState(d.db, id, state, patch);
  d.bus.publish({
    scanId: id, state,
    ...(patch.error !== undefined ? { error: patch.error } : {}),
    ...(patch.reportHash ? { reportHash: patch.reportHash } : {}),
    ...(patch.attestTx ? { attestTx: patch.attestTx } : {}),
  });
}

const counts = (core: ReportCore) => ({
  high: core.findings.filter((f) => f.severity === "HIGH").length,
  medium: core.findings.filter((f) => f.severity === "MEDIUM").length,
});

export function attestRequestOf(core: ReportCore, hash: Hex, toolVersion: string): AttestRequest {
  if (core.target.kind === "source") throw new Error("source-mode reports are never attested");
  const t = core.target;
  return {
    target: getAddress(t.address),
    codehash: t.codehash as Hex,
    reportHash: hash,
    verdict: VERDICT_CODE[core.verdict],
    ...counts(core),
    implementation: t.implementation ? getAddress(t.implementation.address) : null,
    implCodehash: t.implementation ? (t.implementation.codehash as Hex) : null,
    schemaVersion: core.schemaVersion,
    toolVersion,
  };
}

/** Runs one scan to a terminal state. Throws only on programmer/DB errors (pg-boss retries those). */
export async function processScan(d: ScanDeps, scanId: string): Promise<void> {
  const scan = await getScan(d.db, scanId);
  if (!scan) return;
  const chainId = scan.chain_id as ChainId;
  const client = d.clients[chainId];
  if (!client) {
    await transition(d, scanId, "CONFIG", { error: { code: "CONFIG", message: `chain ${chainId} not configured` } });
    return;
  }
  const address = getAddress(scan.address);

  await transition(d, scanId, "RESOLVING");
  const codehash = await codehashOf(client, address);
  if (!codehash) {
    await transition(d, scanId, "NOT_A_CONTRACT", { error: { code: "NOT_A_CONTRACT", message: "no code at address" } });
    return;
  }
  const tool = await d.analyzer.tool();
  const toolVersion = toolVersionString(tool);

  // content-addressed dedupe: same code + same tool ⇒ same report (I4)
  let hash = await findReport(d.db, chainId, address, codehash, toolVersion);
  let core: ReportCore | null = null;
  if (hash) {
    const row = await getReport(d.db, hash);
    core = row ? (JSON.parse(row.core_jcs) as ReportCore) : null;
  }
  if (!hash || !core) {
    // stage events arrive from the analyzer's stderr; chain them so DB/SSE order matches pipeline order
    let last = "RESOLVING";
    let stages: Promise<void> = Promise.resolve();
    const res = await d.analyzer.scan(CHAINS[chainId], address, (stage) => {
      if (stage !== last && stage !== "RESOLVING") {
        last = stage;
        stages = stages.then(() => transition(d, scanId, stage)).catch(() => undefined);
      }
    });
    await stages;
    if (!res.ok) {
      const code = res.error.code === "CONFIG" || res.error.code === "CHAIN_MISMATCH" ? "CONFIG" : res.error.code;
      await transition(d, scanId, code, { codehash, error: res.error });
      return;
    }
    await transition(d, scanId, "HASHING", { codehash });
    const recomputed = reportHash(res.value.core);
    if (recomputed !== res.value.reportHash) {
      await transition(d, scanId, "ANALYZER_ERROR", {
        error: { code: "ANALYZER_ERROR", message: `reportHash mismatch: python ${res.value.reportHash} ts ${recomputed}` },
      });
      return;
    }
    core = res.value.core;
    if (core.target.kind === "source" || core.target.codehash !== codehash) {
      // code changed between RESOLVING and the analyzer's pinned block: report the scanned code honestly
      await transition(d, scanId, "ANALYZER_ERROR", {
        error: { code: "CODE_CHANGED", message: "code changed during scan; resubmit" },
      });
      return;
    }
    hash = recomputed;
    const coreJcs = canonicalJson(core);
    await insertReport(d.db, {
      hash, schemaVersion: core.schemaVersion, toolVersion, chainId, address, codehash,
      verdict: core.verdict, coreJcs, meta: res.value.meta,
    });
  }
  await transition(d, scanId, "HASHING", { codehash, reportHash: hash });

  if (!d.attester) {
    await transition(d, scanId, "DONE", { reportHash: hash });
    return;
  }
  if ((await attestedReport(d.db, chainId, address, d.attester.address)) === hash) {
    await transition(d, scanId, "DONE", { reportHash: hash }); // already attested this exact report
    return;
  }
  await transition(d, scanId, "ATTESTING");
  const req = attestRequestOf(core, hash, toolVersion);
  const sent = await d.attester.attest(chainId, req);
  if (!sent.ok) {
    await transition(d, scanId, "ATTEST_FAILED", { error: sent.error });
    return;
  }
  await upsertAttestation(d.db, {
    chainId, target: address, attester: d.attester.address, codehash, reportHash: hash, verdict: req.verdict,
    revoked: false, tx: sent.value.tx, block: sent.value.block,
  });
  await transition(d, scanId, "DONE", { reportHash: hash, attestTx: sent.value.tx });
}
