// Recompute the hashed constants so a typo in constants.ts can't slip through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, hexToBigInt } from "viem";
import {
  TRANSFER_TOPIC, UPGRADED_TOPIC, EIP1967_IMPLEMENTATION_SLOT, EIP1967_BEACON_SLOT,
} from "../src/constants.ts";

const sig = (s: string) => keccak256(toHex(s));
const slot = (s: string) => toHex(hexToBigInt(sig(s)) - 1n, { size: 32 });

test("Transfer topic", () => assert.equal(TRANSFER_TOPIC, sig("Transfer(address,address,uint256)")));
test("Upgraded topic", () => assert.equal(UPGRADED_TOPIC, sig("Upgraded(address)")));
test("EIP-1967 impl slot", () => assert.equal(EIP1967_IMPLEMENTATION_SLOT, slot("eip1967.proxy.implementation")));
test("EIP-1967 beacon slot", () => assert.equal(EIP1967_BEACON_SLOT, slot("eip1967.proxy.beacon")));
