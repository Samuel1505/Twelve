// The ONLY TypeScript module where the 10^12 USDC scale appears (invariant I1).
// Branded Usdc6 / Usdc18 types and conversions land in Phase 1.

/** Raw-integer ratio between the native (18-dec) and ERC-20 (6-dec) views of USDC. */
export const USDC_SCALE = 10n ** 12n;
