// Test harness: fresh Postgres database + local anvil (chain id 5042002) with the real TwelveRegistry bytecode.
// The registry only reads extcodehash and writes storage, so a local EVM is faithful for it (labeled local, I8).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  createTestClient, createWalletClient, http, publicActions, walletActions, type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@twelve/shared";
import { connect, migrate, type Db } from "../src/db.js";

export const ANVIL_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  attester: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const satisfies Record<string, Hex>;

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://twelve:twelve@localhost:5432/postgres";

export async function freshDb(name = `twelve_test_${process.pid}`): Promise<{ db: Db; drop: () => Promise<void> }> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const db = connect(ADMIN_URL.replace(/\/[^/]*$/, `/${name}`));
  await migrate(db);
  return {
    db,
    drop: async () => {
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name}`);
      await a.end();
    },
  };
}

const artifact = (name: string): { abi: unknown[]; bytecode: Hex } => {
  const j = JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};

export type Chain = {
  url: string;
  pub: PublicClient;
  registry: Address;
  deploy: (bytecode: Hex) => Promise<Address>;
  setCode: (a: Address, code: Hex) => Promise<void>;
  setBalance: (a: Address, wei: bigint) => Promise<void>;
  stop: () => void;
};

export async function startAnvil(port = 8600 + (process.pid % 300)): Promise<Chain> {
  const proc: ChildProcess = spawn("anvil", ["--port", String(port), "--chain-id", "5042002", "--hardfork", "osaka", "--silent"]);
  const url = `http://127.0.0.1:${port}`;
  const test = createTestClient({ mode: "anvil", chain: arcTestnet, transport: http(url) }).extend(publicActions).extend(walletActions);
  for (let i = 0; i < 100; i++) {
    try {
      await test.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const deployer = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS.deployer), chain: arcTestnet, transport: http(url) }).extend(publicActions);
  const deploy = async (bytecode: Hex): Promise<Address> => {
    const hash = await deployer.deployContract({ abi: [], bytecode });
    const r = await deployer.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error("deploy failed");
    return r.contractAddress;
  };
  const registry = await deploy(artifact("TwelveRegistry").bytecode);
  return {
    url,
    pub: test as unknown as PublicClient,
    registry,
    deploy,
    setCode: (a, code) => test.setCode({ address: a, bytecode: code }),
    setBalance: (a, wei) => test.setBalance({ address: a, value: wei }),
    stop: () => proc.kill("SIGKILL"),
  };
}

/** Runtime `PUSH1 1 PUSH1 0 SSTORE STOP`-style contracts with distinct codehashes. */
export const initCodeFor = (runtimeByte: number): Hex => {
  const rt = `60${runtimeByte.toString(16).padStart(2, "0")}5f5500`; // PUSH1 b; PUSH0; SSTORE; STOP (5 bytes)
  return `0x60058060095f395ff3${rt}` as Hex; // CODECOPY 5 runtime bytes from offset 9, RETURN them
};
