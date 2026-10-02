// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// MUST NOT COMPILE (docs/GUARD.md §1). script/compile-fail.sh asserts solc rejects this with a type error:
// with Usdc6 and Usdc18 as separate types, adding the two views is unrepresentable.
import {Usdc6, Usdc18} from "../../src/guard/Usdc.sol";

contract Mix {
    function refund(Usdc6 paid, Usdc18 balance) external pure returns (Usdc6) {
        return paid + balance;
    }
}
