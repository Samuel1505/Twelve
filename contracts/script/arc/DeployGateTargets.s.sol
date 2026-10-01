// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StorageCashier as Bug, IERC20 as IERC20b} from "../../../corpus/c10_storage_binding/bug.sol";
import {StorageCashier as Safe, IERC20 as IERC20s} from "../../../corpus/c10_storage_binding/safe.sol";

/// @notice Deploys Twelve's own FINDINGS/CLEAN target pair (corpus c10) for the Phase 3 gate exit run. Never point the
///         exit run at third-party contracts: attesting FINDINGS publicly would disclose a finding (CORPUS §7).
///         The bug variant cannot lose funds: its cashOut asks the ERC-20 view for 10^12x what it holds and reverts.
/// Mainnet requires ALLOW_MAINNET=1.
contract DeployGateTargets is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function run() external returns (Bug bug, Safe safe) {
        require(block.chainid == 5042002 || (block.chainid == 5042 && vm.envOr("ALLOW_MAINNET", uint256(0)) == 1),
            "testnet, or mainnet with ALLOW_MAINNET=1");
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        bug = new Bug();
        bug.setToken(IERC20b(USDC));
        safe = new Safe();
        safe.setToken(IERC20s(USDC));
        vm.stopBroadcast();
        console2.log("findings target", address(bug));
        console2.log("clean target", address(safe));
    }
}
