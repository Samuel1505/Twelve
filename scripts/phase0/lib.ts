// Shared helpers for Phase 0 spikes: env loading, clients, PASS/FAIL reporting, evidence dumps.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type PublicClient } from "viem";
import { arcMainnet, arcTestnet } from "@twelve/shared";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../..");
const envPath = resolve(repoRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

/** Returns the env var or exits listing what is missing (never guesses an endpoint). */
export function requireEnv(...names: string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    console.log(`BLOCKED missing env: ${missing.join(", ")} (set in ${envPath})`);
    process.exit(2);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string]));
}

let failures = 0;
export function report(ok: boolean, fact: string, evidence: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${fact} — ${evidence}`);
}
export function info(fact: string, evidence: string): void {
  console.log(`INFO ${fact} — ${evidence}`);
}
export function finish(): never {
  process.exit(failures > 0 ? 1 : 0);
}

/** Raw evidence (receipts, responses) lands in scripts/phase0/out/ (gitignored) for doc excerpts. */
export function dump(name: string, data: unknown): string {
  const dir = resolve(here, "out");
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, name);
  writeFileSync(p, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  return p;
}

export type Net = "mainnet" | "testnet";
export function client(net: Net): PublicClient {
  const url = net === "mainnet" ? requireEnv("ARC_RPC_URL").ARC_RPC_URL : requireEnv("ARC_TESTNET_RPC_URL").ARC_TESTNET_RPC_URL;
  const chain = net === "mainnet" ? arcMainnet : arcTestnet;
  return createPublicClient({ chain, transport: http(url, { retryCount: 4, retryDelay: 500, timeout: 30_000 }) }) as PublicClient;
}

/** `--net testnet` switch so the same spike can be compared across networks. */
export function netArg(): Net {
  const i = process.argv.indexOf("--net");
  return i >= 0 && process.argv[i + 1] === "testnet" ? "testnet" : "mainnet";
}
