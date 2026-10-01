import type { Address, Hex } from "viem";
import type { Profile } from "../profiles.js";
import type { Movement } from "../types.js";

export type AttestationView = { verdict: 1 | 2 | 3; revoked: boolean; implementation: Address | null };

/** Everything a detector may look at for one tx. Profiles are the PRE-tx snapshot (MONITOR §4: pure detectors). */
export type TxContext = {
  chainId: number;
  block: bigint;
  tx: Hex;
  movements: readonly Movement[];
  profile: (a: Address) => Profile | undefined;
  attestation: (a: Address) => AttestationView | undefined;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** Addresses in this tx, first-appearance order (deterministic). Detectors treat each as a *candidate*; alerts on
 *  addresses that turn out not to be contracts are dropped by the caller after a cached getCode (ADR-020). */
export function contractsIn(ctx: TxContext): Address[] {
  const seen: Address[] = [];
  for (const m of ctx.movements) {
    for (const a of [m.to, m.from]) if (a !== ZERO && !seen.includes(a)) seen.push(a);
  }
  return seen;
}
