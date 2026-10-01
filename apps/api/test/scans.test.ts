import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { parseUsdc18, reportHash, twelveRegistryAbi, type ReportCore } from "@twelve/shared";
import type { Analyzer, ToolInfo } from "../src/analyzer.js";
import { makeAttester } from "../src/attester.js";
import { getScan, scanEvents, type Db } from "../src/db.js";
import { ScanBus } from "../src/events.js";
import { err, ok } from "../src/result.js";
import { processScan, type ScanDeps } from "../src/scans.js";
import { ANVIL_KEYS, freshDb, initCodeFor, startAnvil, type Chain } from "./helpers.js";

let chain: Chain;
let db: Db;
let drop: () => Promise<void>;
const TOOL: ToolInfo = { name: "twelve", version: "0.1.0", gitCommit: "abcdef1234567", slither: "0.11.6",
  rulesHash: `0x${"11".repeat(32)}`, schemaVersion: 1 };

before(async () => {
  chain = await startAnvil();
  ({ db, drop } = await freshDb(`twelve_test_scans_${process.pid}`));
});
after(async () => {
  chain.stop();
  await drop();
});

function coreFor(address: Address, codehash: Hex, verdict: "CLEAN" | "FINDINGS"): ReportCore {
  return {
    schemaVersion: 1,
    tool: { name: "twelve", version: TOOL.version, gitCommit: TOOL.gitCommit, slither: TOOL.slither, rulesHash: TOOL.rulesHash },
    target: { chainId: 5042002, address: address.toLowerCase(), codehash, kind: "contract" },
    input: { standardJsonHash: `0x${"22".repeat(32)}`, compiler: "0.8.30+commit.73712a01", evmVersion: "osaka",
      optimizer: { enabled: true, runs: 200 }, bytecodeMatch: { status: "exact", maskedRanges: [] }, bindingBlock: 1 },
    bindings: [],
    findings: verdict === "CLEAN" ? [] : [{
      id: `0x${"33".repeat(32)}`, rule: "TW-004", severity: "HIGH", confidence: "DEFINITE", contract: "C", function: "f()",
      location: { file: "c.sol", startLine: 3, endLine: 3, startCol: 1, endCol: 9 }, trace: [], message: "m", fix: "x",
    }],
    coverage: { functionsAnalyzed: 1, unsupported: [] },
    verdict,
  } as ReportCore;
}

function fakeAnalyzer(behave: (a: Hex) => "CLEAN" | "FINDINGS" | "NOT_VERIFIED" | "BADHASH"): Analyzer & { calls: number } {
  const self = {
    calls: 0,
    tool: async () => TOOL,
    scan: async (_chain: "arc" | "arc-testnet", address: Hex, onStage: (s: string) => void) => {
      self.calls += 1;
      for (const s of ["RESOLVING", "FETCHING", "REBUILDING", "COMPILING", "MATCHING", "BINDING", "ANALYZING"]) onStage(s);
      const mode = behave(address);
      if (mode === "NOT_VERIFIED") return err({ code: "NOT_VERIFIED", message: "no source" });
      const codehash = keccak256((await chain.pub.getCode({ address: getAddress(address) }))!);
      const core = coreFor(getAddress(address), codehash, mode === "BADHASH" ? "CLEAN" : mode);
      return ok({ reportHash: mode === "BADHASH" ? (`0x${"44".repeat(32)}` as Hex) : reportHash(core), core, meta: {} });
    },
  };
  return self;
}

async function newScan(address: Address): Promise<string> {
  const r = await db.query<{ id: string }>("INSERT INTO scans (chain_id, address, state) VALUES (5042002, $1, 'QUEUED') RETURNING id",
    [Buffer.from(address.slice(2).toLowerCase(), "hex")]);
  return r.rows[0]!.id;
}

const deps = (analyzer: Analyzer): ScanDeps => ({
  db, bus: new ScanBus(), analyzer, clients: { 5042002: chain.pub },
  attester: makeAttester({ privateKey: ANVIL_KEYS.attester, registry: chain.registry, minBalance: parseUsdc18("0.05"),
    clients: { 5042002: { pub: chain.pub, rpcUrl: chain.url } }, log: () => {} }),
});

test("full pipeline: FINDINGS target gets attested FINDINGS, events in order", async () => {
  const target = await chain.deploy(initCodeFor(7));
  const an = fakeAnalyzer(() => "FINDINGS");
  const id = await newScan(target);
  await processScan(deps(an), id);
  const scan = (await getScan(db, id))!;
  assert.equal(scan.state, "DONE");
  assert.ok(scan.attest_tx && scan.report_hash);
  const stages = (await scanEvents(db, id)).map((e) => e.stage);
  assert.deepEqual(stages, ["RESOLVING", "FETCHING", "REBUILDING", "COMPILING", "MATCHING", "BINDING", "ANALYZING",
    "HASHING", "HASHING", "ATTESTING", "DONE"]);
  const d = deps(an);
  const status = await chain.pub.readContract({ address: chain.registry, abi: twelveRegistryAbi, functionName: "status",
    args: [d.attester!.address, target] });
  assert.equal(status, 2);
});

test("dedupe: same code + tool reuses the report and does not re-attest", async () => {
  const target = await chain.deploy(initCodeFor(8));
  const an = fakeAnalyzer(() => "CLEAN");
  const id1 = await newScan(target);
  await processScan(deps(an), id1);
  const id2 = await newScan(target);
  await processScan(deps(an), id2);
  assert.equal(an.calls, 1);
  const [s1, s2] = [(await getScan(db, id1))!, (await getScan(db, id2))!];
  assert.equal(s2.state, "DONE");
  assert.equal(s2.report_hash, s1.report_hash);
  assert.equal(s2.attest_tx, null);
});

test("analyzer terminal errors are recorded and never attested", async () => {
  const target = await chain.deploy(initCodeFor(9));
  const id = await newScan(target);
  await processScan(deps(fakeAnalyzer(() => "NOT_VERIFIED")), id);
  const s = (await getScan(db, id))!;
  assert.equal(s.state, "NOT_VERIFIED");
  assert.equal(s.attest_tx, null);
});

test("TS/Python reportHash disagreement stops the pipeline", async () => {
  const target = await chain.deploy(initCodeFor(10));
  const id = await newScan(target);
  await processScan(deps(fakeAnalyzer(() => "BADHASH")), id);
  assert.equal((await getScan(db, id))!.state, "ANALYZER_ERROR");
});

test("an address with no code is NOT_A_CONTRACT without running the analyzer", async () => {
  const an = fakeAnalyzer(() => "CLEAN");
  const id = await newScan("0x000000000000000000000000000000000000dEaD");
  await processScan(deps(an), id);
  assert.equal((await getScan(db, id))!.state, "NOT_A_CONTRACT");
  assert.equal(an.calls, 0);
});
