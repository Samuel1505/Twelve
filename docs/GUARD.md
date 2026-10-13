# GUARD.md — Compile-time units, checked payouts, the gate, and demo contracts

## 1. `Usdc.sol` — make mixing a compile error

Solidity ≥ 0.8.19 supports user-defined operators on user-defined value types (UDVTs). Two distinct types mean `Usdc6 + Usdc18` **does not compile**. This is the strongest possible fix: the bug class becomes unrepresentable.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

type Usdc6 is uint256;   // ERC-20 view, 6 decimals
type Usdc18 is uint256;  // native view, 18 decimals

uint256 constant SCALE = 1e12; // the ONLY 1e12 in Solidity (I1)
address constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

// ---- Usdc6 operators (free functions, required for `global` operator binding)
function add6(Usdc6 a, Usdc6 b) pure returns (Usdc6) { return Usdc6.wrap(Usdc6.unwrap(a) + Usdc6.unwrap(b)); }
function sub6(Usdc6 a, Usdc6 b) pure returns (Usdc6) { return Usdc6.wrap(Usdc6.unwrap(a) - Usdc6.unwrap(b)); }
function lt6 (Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) <  Usdc6.unwrap(b); }
function lte6(Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) <= Usdc6.unwrap(b); }
function gt6 (Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) >  Usdc6.unwrap(b); }
function gte6(Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) >= Usdc6.unwrap(b); }
function eq6 (Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) == Usdc6.unwrap(b); }
function neq6(Usdc6 a, Usdc6 b) pure returns (bool)  { return Usdc6.unwrap(a) != Usdc6.unwrap(b); }
using {add6 as +, sub6 as -, lt6 as <, lte6 as <=, gt6 as >, gte6 as >=, eq6 as ==, neq6 as !=} for Usdc6 global;
// ---- identical block for Usdc18 (add18, sub18, …) with `for Usdc18 global`

library Usdc {
    error DustRemainder(Usdc18 dust);

    function toNative(Usdc6 a) internal pure returns (Usdc18) {
        return Usdc18.wrap(Usdc6.unwrap(a) * SCALE); // checked mul
    }
    /// floor conversion; dust is returned, never dropped (I3)
    function toErc20(Usdc18 a) internal pure returns (Usdc6 amount, Usdc18 dust) {
        uint256 raw = Usdc18.unwrap(a);
        return (Usdc6.wrap(raw / SCALE), Usdc18.wrap(raw % SCALE));
    }
    function toErc20Exact(Usdc18 a) internal pure returns (Usdc6) {
        (Usdc6 amt, Usdc18 dust) = toErc20(a);
        if (Usdc18.unwrap(dust) != 0) revert DustRemainder(dust);
        return amt;
    }
    function mulDiv6(Usdc6 a, uint256 num, uint256 den) internal pure returns (Usdc6) { /* Math.mulDiv, floor */ }
    function mulDiv18(Usdc18 a, uint256 num, uint256 den) internal pure returns (Usdc18) { /* … */ }

    // typed sources
    function msgValue() internal view returns (Usdc18) { return Usdc18.wrap(msg.value); }
    function nativeBalance(address a) internal view returns (Usdc18) { return Usdc18.wrap(a.balance); }
    function erc20Balance(address a) internal view returns (Usdc6) { return Usdc6.wrap(IERC20(USDC_ERC20).balanceOf(a)); }

    // typed sinks
    function sendNative(address payable to, Usdc18 amt) internal { (bool ok,) = to.call{value: Usdc18.unwrap(amt)}(""); if (!ok) revert NativeSendFailed(to); }
    function sendErc20(address to, Usdc6 amt) internal { SafeERC20.safeTransfer(IERC20(USDC_ERC20), to, Usdc6.unwrap(amt)); }
}
```

Rules:
- `wrap/unwrap` appear **only** inside `guard/` (`Usdc.sol`, `TwelvePayout.sol`). *Not built yet:* analyzer rule (TW-010, INFO, repo-internal lint): `Usdc6.unwrap`/`Usdc18.unwrap` outside `guard/` in Twelve's own code.
- Analyzer treats `Usdc.*` typed sources/sinks as DEFINITE (ANALYZER §5.1).

*As built (Phase 6):* no OpenZeppelin dependency. `sendErc20` / `pullErc20` call `0x3600…` directly and accept a
`true` or empty return; `mulDiv6` / `mulDiv18` use an in-file 512-bit `mulDiv` (floor; reverts `MulDivOverflow` on
overflow or a zero divisor). `TwelveGate` uses a transient-storage lock rather than `ReentrancyGuard`.

Tests (`test/Usdc.t.sol`): round-trip fuzz `toErc20(toNative(a)) == (a, 0)`; `toErc20` dust exactness fuzz; overflow on `toNative` near `type(uint256).max / SCALE`; operators match raw semantics.
Compile-fail test: `contracts/fixtures/compile-fail/Mix.sol` containing `Usdc6 + Usdc18`; `contracts/script/compile-fail.sh` asserts `forge build` of that file **fails** with solc Error 5653 (operator type mismatch). (Store as a fixture outside `src`, compile via `solc` directly in a script; this is the demo's "compile error" beat.)

## 2. `TwelvePayout.sol` — runtime check for untyped legacy code

For teams that can't retype a codebase: pay natively while declaring intent in ERC-20 units.

```solidity
abstract contract TwelvePayout {
    error UnitMismatch(uint256 intended6, uint256 native18);
    error WindowCapExceeded(uint256 attempted6, uint256 remaining6);

    uint256 public immutable windowCap6;     // max payout per window (ERC-20 units)
    uint256 public immutable windowLength;   // seconds
    uint256 private _windowStart; uint256 private _spent6;

    /// Pays exactly intended6 USDC natively. `native18` is what the legacy code computed;
    /// it must equal intended6 * 1e12 or the call reverts — this is the 10^12 circuit breaker.
    function _payNativeChecked(address payable to, uint256 intended6, uint256 native18) internal {
        if (Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(intended6))) != native18) revert UnitMismatch(intended6, native18);
        _consume(intended6);
        Usdc.sendNative(to, Usdc18.wrap(native18));
    }
    function _consume(uint256 amt6) private { /* roll window by block.timestamp; revert WindowCapExceeded */ }
}
```
The cap bounds blast radius even for bugs the equality check can't see.

## 3. `TwelveGate.sol` — registry consumer (demo + integration example)

```solidity
contract TwelveGate is ReentrancyGuard {
    ITwelveRegistry public immutable registry;
    address public immutable attester;
    error TargetNotClean(address target, ITwelveRegistry.Status status);
    event Forwarded(address indexed from, address indexed target, uint256 value18, bytes4 selector);

    /// Forward native USDC + calldata only to targets CLEAN under `attester`.
    function forward(address target, bytes calldata data) external payable nonReentrant returns (bytes memory) {
        ITwelveRegistry.Status s = registry.status(attester, target);
        if (s != ITwelveRegistry.Status.CLEAN) revert TargetNotClean(target, s);
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        emit Forwarded(msg.sender, target, msg.value, bytes4(data));
        return ret;
    }
}
```
Note: gate forwards native value only; ERC-20-view flows need the user's approval on the target directly — document, don't over-engineer.

## 4. Demo contracts (`contracts/src/demo/`)

Deployed to **mainnet** with trivial amounts, clearly labeled in NatSpec: `/// @notice DELIBERATELY VULNERABLE — Twelve demo. Do not send funds.`

### 4.1 `LeakyRefund.sol` — the bug, realistic shape
A tiny "ticket shop": pay `price6` via ERC-20 `transferFrom`; if sold out, refund **natively** — the classic port-from-Ethereum mistake.
```solidity
function buy(uint256 paid6) external nonReentrant {
    USDC.transferFrom(msg.sender, address(this), paid6);          // ERC-20 view, 6-dec
    if (sold >= capacity) {
        (bool ok,) = payable(msg.sender).call{value: paid6}("");  // BUG: native view expects 18-dec
        require(ok);
        return;
    }
    sold++;
}
```
Effects: analyzer TW-003 HIGH (INFERRED as built, `paid6` from `transferFrom` param flows to native sink — param unit set by the `transferFrom` sink expectation, see ANALYZER §4 backward inference note below); monitor D1 HIGH (ERC-20 inflow raw `y`, native outflow raw `y`, same tx). Buyer paying 5 USDC receives 0.000000000005 USDC.

> Backward inference: a public param with no annotation is `⊥`. When it reaches a DEFINITE sink (`transferFrom` amount expects `(1,6)`), bind it to `(1,6)` at INFERRED confidence *for the rest of the function* **only if** that sink dominates the later use. Otherwise leave `⊥`. Implement as a pre-pass; add corpus cases for the dominated and non-dominated variants.

### 4.2 `FixedRefund.sol` — same logic, typed
Uses `Usdc6` for `paid6`, refunds via `Usdc.sendNative(to, Usdc.toNative(paid))`. Analyzer: CLEAN. Monitor: native outflow raw = `y × 10¹²` → no D1.

### 4.3 `OverpayVault.sol` — the drain shape, guarded
Credits `msg.value` into `credits[user]`, withdraws via `USDC.transfer(user, credits[user])` (TW-004 / TW-005). Second function `withdrawGuarded` routes through `TwelvePayout` and reverts with `UnitMismatch`. On mainnet, fund with ≤ 1 USDC; the unguarded withdraw simply reverts for insufficient balance at 10¹² scale — **the demo shows the guarded revert reason**, not a real drain.

## 5. Why this layer is secondary (be honest in pitch)
Adoption paradox: teams that know to use a guard already know the bug. The guard's real value is (a) the **type system** fix as the recommended remediation linked from every finding's `fix`, and (b) a cap for legacy code. Lead the pitch with analyzer + monitor + registry.
