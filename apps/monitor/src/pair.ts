// Pairing (MONITOR §2, ARC_LEDGER §2.1). Pure. Never assumes the two logs are adjacent: pair by (from, to, value)
// equality within the tx, first unconsumed ERC-20 log in logIndex order.
import { isSameAmount, usdc18, usdc6 } from "@twelve/shared";
import { ZERO_ADDRESS, type Movement, type TransferLog } from "./types.js";

export type Paired = { movements: Movement[]; unpaired: TransferLog[]; noops: TransferLog[] };

/** ERC-20 logs that legitimately have no system twin (observed on mainnet, ARC_LEDGER §2.2): zero-value transfers and
 *  self-transfers move no balance, so EIP-7708 emits nothing for them. */
export const isNoopErc20 = (l: TransferLog): boolean => l.value === 0n || l.from === l.to;

export function pairTx(logs: readonly TransferLog[]): Paired {
  const sorted = [...logs].sort((a, b) => a.logIndex - b.logIndex);
  const erc20 = sorted.filter((l) => l.stream === "erc20");
  const used = new Set<number>();
  const movements: Movement[] = [];
  for (const s of sorted) {
    if (s.stream !== "system") continue;
    const a18 = usdc18(s.value);
    const twin = erc20.find((e) => !used.has(e.logIndex) && e.from === s.from && e.to === s.to
      && isSameAmount(a18, usdc6(e.value)));
    let iface: Movement["iface"];
    if (twin) {
      used.add(twin.logIndex);
      iface = "erc20";
    } else if (s.from === ZERO_ADDRESS) {
      iface = "mint";
    } else if (s.to === ZERO_ADDRESS) {
      iface = "burn";
    } else {
      iface = "native";
    }
    movements.push({
      block: s.block, tx: s.tx, txIndex: s.txIndex, idx: s.logIndex, erc20Idx: twin?.logIndex ?? null,
      from: s.from, to: s.to, amount18: a18, raw6: twin ? usdc6(twin.value) : null, iface,
    });
  }
  // any other ERC-20 log without a system twin is a data anomaly (indexer bug or protocol change): never silently drop
  const leftover = erc20.filter((e) => !used.has(e.logIndex));
  return { movements, unpaired: leftover.filter((l) => !isNoopErc20(l)), noops: leftover.filter(isNoopErc20) };
}
