// Fact: Blockscout Pro API smart-contracts/<addr> response shape (ARC_LEDGER §7, ADR-011).
// Saves the raw response to analyzer/tests/fixtures/blockscout_smart_contract.json.
// Usage: tsx blockscout.ts [--net testnet] [--address 0x...]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { finish, info, netArg, report, repoRoot, requireEnv } from "./lib.ts";

const { BLOCKSCOUT_API_KEY } = requireEnv("BLOCKSCOUT_API_KEY");
const chainId = netArg() === "testnet" ? 5042002 : 5042;
const base = `https://api.blockscout.com/${chainId}/api/v2`;

// VERIFY: auth scheme for the Pro API. Try query param first, then header; report which worked.
async function get(path: string): Promise<{ status: number; body: unknown; auth: string }> {
  for (const [auth, url, headers] of [
    ["query:apikey", `${base}${path}${path.includes("?") ? "&" : "?"}apikey=${BLOCKSCOUT_API_KEY}`, {}],
    ["header:authorization", `${base}${path}`, { authorization: `Bearer ${BLOCKSCOUT_API_KEY}` }],
  ] as const) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (res.status !== 401 && res.status !== 403) return { status: res.status, body, auth };
    info(`auth ${auth}`, `HTTP ${res.status}`);
  }
  return { status: 401, body: null, auth: "none" };
}

const aIdx = process.argv.indexOf("--address");
let address = aIdx >= 0 ? process.argv[aIdx + 1] : undefined;
if (!address) {
  const list = await get("/smart-contracts");
  report(list.status === 200, "GET /smart-contracts list", `HTTP ${list.status} via ${list.auth}`);
  const items = (list.body as { items?: { address?: { hash?: string }; language?: string }[] })?.items ?? [];
  address = items.find((i) => i.language === "solidity")?.address?.hash;
  if (!address) { report(false, "found a verified Solidity contract", "list empty or unexpected shape"); finish(); }
}

const r = await get(`/smart-contracts/${address}`);
report(r.status === 200, `GET /smart-contracts/${address}`, `HTTP ${r.status} via ${r.auth}`);
if (r.status === 200 && r.body && typeof r.body === "object") {
  const out = resolve(repoRoot, "analyzer/tests/fixtures/blockscout_smart_contract.json");
  writeFileSync(out, JSON.stringify(r.body, null, 2) + "\n");
  info("fixture", out);
  const b = r.body as Record<string, unknown>;
  info("top-level fields", Object.keys(b).sort().join(", "));
  for (const k of ["source_code", "additional_sources", "compiler_version", "compiler_settings", "evm_version",
    "optimization_enabled", "optimization_runs", "constructor_args", "deployed_bytecode", "file_path", "language", "is_verified", "immutable_references"]) {
    report(k in b, `field present: ${k}`, k in b ? `type ${Array.isArray(b[k]) ? "array" : typeof b[k]}` : "absent");
  }
}
finish();
