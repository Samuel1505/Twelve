// D4 ATTESTED_PROXY_UPGRADED (ops + auto-action). Upgraded/BeaconUpgraded from a proxy with a live attestation ⇒
// revoke(proxy, "UPGRADED") through the API attester, rescan, INFO alert (REGISTRY §4.3, MONITOR §7).
import type { Address, Hex } from "viem";
import type { Alert } from "../types.js";
import type { AttestationView } from "./context.js";

export type UpgradeLog = { chainId: number; block: bigint; tx: Hex; logIndex: number; proxy: Address;
  newImplementation: Address; kind: "Upgraded" | "BeaconUpgraded" };

export function d4(u: UpgradeLog, att: AttestationView | undefined): { alert: Alert; revoke: boolean } | null {
  if (!att || att.revoked || att.implementation === null) return null;
  return {
    revoke: true,
    alert: {
      detector: "D4", severity: "INFO", address: u.proxy, tx: u.tx, block: u.block,
      evidence: { event: u.kind, previous_implementation: att.implementation, new_implementation: u.newImplementation,
        action: "revoke UPGRADED + rescan" },
      dedupeKey: `D4:${u.chainId}:${u.proxy}:${u.tx}:${u.logIndex}`,
    },
  };
}
