import type { Address, Hex } from "viem";
import type { Usdc18, Usdc6 } from "@twelve/shared";

/** A decoded Transfer log from either stream (ARC_LEDGER §2). */
export type TransferLog = {
  stream: "system" | "erc20"; // 0xff..fe (18-dec) | 0x3600 (6-dec)
  block: bigint;
  blockHash: Hex;
  tx: Hex;
  txIndex: number;
  logIndex: number;
  from: Address;
  to: Address;
  value: bigint; // raw; unit given by `stream`
};

export type Iface = "erc20" | "native" | "mint" | "burn";

/** One USDC movement = one system log, classified by interface (MONITOR §2). */
export type Movement = {
  block: bigint;
  tx: Hex;
  txIndex: number;
  idx: number; // system log index
  erc20Idx: number | null;
  from: Address;
  to: Address;
  amount18: Usdc18;
  raw6: Usdc6 | null; // the ERC-20 twin's raw value when iface = erc20
  iface: Iface;
};

export type Severity = "HIGH" | "MEDIUM" | "LOW" | "INFO" | "OPS";

export type Alert = {
  detector: "D1" | "D2" | "D3" | "D4" | "D5" | "PAIRING" | "CONTINUITY" | "BALANCE";
  severity: Severity;
  address: Address | null;
  tx: Hex | null;
  block: bigint | null;
  evidence: Record<string, unknown>;
  dedupeKey: string;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
