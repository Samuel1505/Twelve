import { createPublicClient, http, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { arcMainnet, arcTestnet } from "@twelve/shared";
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
