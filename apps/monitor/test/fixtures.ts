import { getAddress, type Address, type Hex } from "viem";
import { USDC_SCALE } from "@twelve/shared";
import type { TransferLog } from "../src/types.js";

export const A = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
export const TX = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
export const ZERO = A(0);

let li = 0;
/** System (18-dec) log. */
export const sys = (tx: number, from: Address, to: Address, v18: bigint, logIndex = li++, block = 100n): TransferLog =>
  ({ stream: "system", block, blockHash: TX(9999), tx: TX(tx), txIndex: tx, logIndex, from, to, value: v18 });
/** ERC-20 (6-dec) log. */
export const erc = (tx: number, from: Address, to: Address, v6: bigint, logIndex = li++, block = 100n): TransferLog =>
  ({ stream: "erc20", block, blockHash: TX(9999), tx: TX(tx), txIndex: tx, logIndex, from, to, value: v6 });
/** An ERC-20-interface transfer emits both logs, system first (observed, ARC_LEDGER §2.1). */
export const erc20Transfer = (tx: number, from: Address, to: Address, v6: bigint, block = 100n): TransferLog[] =>
  [sys(tx, from, to, v6 * USDC_SCALE, li++, block), erc(tx, from, to, v6, li++, block)];
