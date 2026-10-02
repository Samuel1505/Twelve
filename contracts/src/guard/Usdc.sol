// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// The ONLY Solidity file where the 10^12 USDC scale appears (invariant I1). docs/GUARD.md §1.
//
// On Arc one USDC balance has two views: native (18 decimals: msg.value, balance, call{value}) and ERC-20 (6 decimals:
// 0x3600… balanceOf/transfer). Giving each view its own type makes mixing them a compile error:
//     Usdc6 a; Usdc18 b;  a + b;  // TypeError: operator + not compatible with types Usdc6 and Usdc18

/// @dev ERC-20 view amount (6 decimals).
type Usdc6 is uint256;
/// @dev Native view amount (18 decimals).
type Usdc18 is uint256;

/// @dev Raw-integer ratio between the native (18-dec) and ERC-20 (6-dec) views of USDC.
uint256 constant SCALE = 1e12;
/// @dev Arc's USDC ERC-20 interface over the native balance.
address constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

// ---- Usdc6 operators (free functions are required for `global` operator binding)
function add6(Usdc6 a, Usdc6 b) pure returns (Usdc6) {
    return Usdc6.wrap(Usdc6.unwrap(a) + Usdc6.unwrap(b));
}

function sub6(Usdc6 a, Usdc6 b) pure returns (Usdc6) {
    return Usdc6.wrap(Usdc6.unwrap(a) - Usdc6.unwrap(b));
}

function lt6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) < Usdc6.unwrap(b);
}

function lte6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) <= Usdc6.unwrap(b);
}

function gt6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) > Usdc6.unwrap(b);
}

function gte6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) >= Usdc6.unwrap(b);
}

function eq6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) == Usdc6.unwrap(b);
}

function neq6(Usdc6 a, Usdc6 b) pure returns (bool) {
    return Usdc6.unwrap(a) != Usdc6.unwrap(b);
}

using {add6 as +, sub6 as -, lt6 as <, lte6 as <=, gt6 as >, gte6 as >=, eq6 as ==, neq6 as !=} for Usdc6 global;

// ---- Usdc18 operators
function add18(Usdc18 a, Usdc18 b) pure returns (Usdc18) {
    return Usdc18.wrap(Usdc18.unwrap(a) + Usdc18.unwrap(b));
}

function sub18(Usdc18 a, Usdc18 b) pure returns (Usdc18) {
    return Usdc18.wrap(Usdc18.unwrap(a) - Usdc18.unwrap(b));
}

function lt18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) < Usdc18.unwrap(b);
}

function lte18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) <= Usdc18.unwrap(b);
}

function gt18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) > Usdc18.unwrap(b);
}

function gte18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) >= Usdc18.unwrap(b);
}

function eq18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) == Usdc18.unwrap(b);
}

function neq18(Usdc18 a, Usdc18 b) pure returns (bool) {
    return Usdc18.unwrap(a) != Usdc18.unwrap(b);
}

using {
    add18 as +, sub18 as -, lt18 as <, lte18 as <=, gt18 as >, gte18 as >=, eq18 as ==, neq18 as !=
} for Usdc18 global;

interface IUsdcErc20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title Usdc
/// @notice Typed sources, sinks and conversions for Arc's two USDC views. Conversions never drop dust silently (I3).
library Usdc {
    error DustRemainder(Usdc18 dust);
    error NativeSendFailed(address to);
    error Erc20TransferFailed(address to, Usdc6 amount);
    error MulDivOverflow();

    // ---- conversions

    /// @notice ERC-20 amount → the same value in the native view. Reverts on overflow (checked multiply).
    function toNative(Usdc6 a) internal pure returns (Usdc18) {
        return Usdc18.wrap(Usdc6.unwrap(a) * SCALE);
    }

    /// @notice Native amount → ERC-20 view, rounded down. The remainder below 10^-6 USDC is returned, never dropped.
    function toErc20(Usdc18 a) internal pure returns (Usdc6 amount, Usdc18 dust) {
        uint256 raw = Usdc18.unwrap(a);
        return (Usdc6.wrap(raw / SCALE), Usdc18.wrap(raw % SCALE));
    }

    /// @notice Native amount → ERC-20 view; reverts if the amount isn't a whole number of 10^-6 USDC.
    function toErc20Exact(Usdc18 a) internal pure returns (Usdc6) {
        (Usdc6 amt, Usdc18 dust) = toErc20(a);
        if (Usdc18.unwrap(dust) != 0) revert DustRemainder(dust);
        return amt;
    }

    /// @notice floor(a * num / den) without intermediate overflow, in the ERC-20 view (e.g. fees in basis points).
    function mulDiv6(Usdc6 a, uint256 num, uint256 den) internal pure returns (Usdc6) {
        return Usdc6.wrap(mulDiv(Usdc6.unwrap(a), num, den));
    }

    /// @notice floor(a * num / den) without intermediate overflow, in the native view.
    function mulDiv18(Usdc18 a, uint256 num, uint256 den) internal pure returns (Usdc18) {
        return Usdc18.wrap(mulDiv(Usdc18.unwrap(a), num, den));
    }

    // ---- typed sources

    /// @notice `msg.value`, which is always in the native view.
    function msgValue() internal view returns (Usdc18) {
        return Usdc18.wrap(msg.value);
    }

    /// @notice `a.balance`, which is always in the native view.
    function nativeBalance(address a) internal view returns (Usdc18) {
        return Usdc18.wrap(a.balance);
    }

    /// @notice `USDC.balanceOf(a)`, which is always in the ERC-20 view.
    function erc20Balance(address a) internal view returns (Usdc6) {
        return Usdc6.wrap(IUsdcErc20(USDC_ERC20).balanceOf(a));
    }

    // ---- typed sinks

    /// @notice Send `amt` through the native view.
    function sendNative(address payable to, Usdc18 amt) internal {
        (bool ok,) = to.call{value: Usdc18.unwrap(amt)}("");
        if (!ok) revert NativeSendFailed(to);
    }

    /// @notice Send `amt` through the ERC-20 view. Accepts tokens that return nothing as well as `true`.
    function sendErc20(address to, Usdc6 amt) internal {
        (bool ok, bytes memory ret) =
            USDC_ERC20.call(abi.encodeCall(IUsdcErc20.transfer, (to, Usdc6.unwrap(amt))));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Erc20TransferFailed(to, amt);
    }

    /// @notice Pull `amt` from `from` through the ERC-20 view (requires approval).
    function pullErc20(address from, Usdc6 amt) internal {
        (bool ok, bytes memory ret) = USDC_ERC20.call(
            abi.encodeCall(IUsdcErc20.transferFrom, (from, address(this), Usdc6.unwrap(amt)))
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Erc20TransferFailed(address(this), amt);
    }

    /// @dev Full-precision floor(x * y / d) (512-bit intermediate; Remco Bloemen's method, MIT). Reverts if the result
    ///      does not fit in 256 bits or d == 0.
    function mulDiv(uint256 x, uint256 y, uint256 d) private pure returns (uint256 result) {
        unchecked {
            uint256 prod0 = x * y;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                if (d == 0) revert MulDivOverflow();
                return prod0 / d;
            }
            if (d <= prod1) revert MulDivOverflow();
            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = d & (~d + 1);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            result = prod0 * inv;
        }
    }
}
