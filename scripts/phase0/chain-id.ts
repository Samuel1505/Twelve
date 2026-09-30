// Fact: eth_chainId on mainnet provider = 0x13b2 (5042), testnet = 5042002 (ARC_LEDGER §3, gotcha #7).
import { toHex } from "viem";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "@twelve/shared";
import { client, finish, report } from "./lib.ts";

for (const [net, expected] of [["mainnet", ARC_MAINNET_CHAIN_ID], ["testnet", ARC_TESTNET_CHAIN_ID]] as const) {
  try {
    const id = await client(net).getChainId();
    report(id === expected, `eth_chainId ${net} == ${toHex(expected)} (${expected})`, `got ${toHex(id)} (${id})`);
  } catch (e) {
    report(false, `eth_chainId ${net} reachable`, (e as Error).message.split("\n")[0] ?? "error");
  }
}
finish();
