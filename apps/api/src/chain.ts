import { createPublicClient, getAddress, http, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT, arcMainnet, arcTestnet } from "@twelve/shared";
import type { ChainId } from "./config.js";

export const chainOf = (id: ChainId) => (id === 5042 ? arcMainnet : arcTestnet);

export function publicClient(id: ChainId, url: string): PublicClient {
  return createPublicClient({ chain: chainOf(id), transport: http(url, { retryCount: 4, retryDelay: 400 }) }) as PublicClient;
}

/** extcodehash as the registry sees it; null when there is no code (EOA / empty). */
export async function codehashOf(client: PublicClient, address: Address, blockTag: "latest" = "latest"): Promise<Hex | null> {
  const code = await client.getCode({ address, blockTag });
  return code && code !== "0x" ? keccak256(code) : null;
}

/** Legacy ZeppelinOS implementation slot (ADR-018; used by Arc's own 0x3600). */
export const ZOS_IMPLEMENTATION_SLOT: Hex = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";

const slotAddress = (word: Hex | undefined): Address | null => {
  if (!word || BigInt(word) === 0n) return null;
  return getAddress(`0x${word.slice(-40)}`);
};

/** The implementation a proxy points at *now*, read the same way the analyzer classified it (fetch/proxy.py).
 *  null when the slot is empty. EIP-1167 clones embed the implementation in code, so their codehash covers it. */
export async function currentImplementation(client: PublicClient, proxy: Address, kind: string): Promise<Address | null> {
  if (kind === "eip1967Proxy") return slotAddress(await client.getStorageAt({ address: proxy, slot: EIP1967_IMPLEMENTATION_SLOT }));
  if (kind === "zosProxy") return slotAddress(await client.getStorageAt({ address: proxy, slot: ZOS_IMPLEMENTATION_SLOT }));
  if (kind === "beaconProxy") {
    const beacon = slotAddress(await client.getStorageAt({ address: proxy, slot: EIP1967_BEACON_SLOT }));
    if (!beacon) return null;
    const r = await client.call({ to: beacon, data: "0x5c60da1b" }); // implementation()
    return slotAddress(r.data);
  }
  return null;
}
