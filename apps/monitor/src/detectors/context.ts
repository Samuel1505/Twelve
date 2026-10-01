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
  isContract: (a: Address) => boolean;
  profile: (a: Address) => Profile | undefined;
  attestation: (a: Address) => AttestationView | undefined;
};

/** Contracts that appear in this tx, in first-appearance order (deterministic alert order). */
export function contractsIn(ctx: TxContext): Address[] {
  const seen: Address[] = [];
  for (const m of ctx.movements) {
    for (const a of [m.to, m.from]) if (!seen.includes(a) && ctx.isContract(a)) seen.push(a);
  }
  return seen;
}
