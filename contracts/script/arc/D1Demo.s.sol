// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {LeakyRefund} from "../../src/demo/LeakyRefund.sol";

interface IUsdc {
    function approve(address, uint256) external returns (bool);
}

/// @notice Monitor D1 exit run (docs/BUILD_PLAN.md Phase 4). Two steps so the monitor is watching before the buy:
///   forge script script/arc/D1Demo.s.sol --sig "deploy()"   --rpc-url arc_testnet --broadcast
///   forge script script/arc/D1Demo.s.sol --sig "buy(address,uint256)" <shop> <paid6> --rpc-url arc_testnet --broadcast
/// Mainnet additionally requires ALLOW_MAINNET=1 (ask first: CLAUDE.md §7).
contract D1Demo is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function _guard() internal view {
        require(block.chainid == 5042002 || (block.chainid == 5042 && vm.envOr("ALLOW_MAINNET", uint256(0)) == 1),
            "testnet, or mainnet with ALLOW_MAINNET=1");
    }

    function deploy() external returns (LeakyRefund shop) {
        _guard();
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        shop = new LeakyRefund(0); // sold out from the start: every buy is refunded (natively, unscaled)
        IUsdc(USDC).approve(address(shop), type(uint256).max);
        vm.stopBroadcast();
        console2.log("LeakyRefund", address(shop));
    }

    /// @notice Fund a throwaway buyer natively. The buy itself must go through `cast send`: forge simulates locally and
    ///         the local EVM cannot execute the 0x1800 native-coin precompile behind transferFrom (ADR-017).
    function fund(address buyer, uint256 value18) external {
        _guard();
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        payable(buyer).transfer(value18);
        vm.stopBroadcast();
    }

    function buy(address shop, uint256 paid6) external {
        _guard();
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        LeakyRefund(shop).buy(paid6);
        vm.stopBroadcast();
        console2.log("bought, paid6 =", paid6);
    }
}
