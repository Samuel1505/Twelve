// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {DemoImplV1, DemoImplV2, DemoUpgradeableProxy} from "../../src/demo/DemoUpgradeableProxy.sol";

/// @notice Monitor D4 exit run on testnet (docs/BUILD_PLAN.md Phase 4): attest a proxy, upgrade it, the monitor revokes.
///   forge script script/arc/D4Demo.s.sol --sig "deploy()" --rpc-url arc_testnet --broadcast
///   forge script script/arc/D4Demo.s.sol --sig "upgrade(address,address)" <proxy> <v2> --rpc-url arc_testnet --broadcast
contract D4Demo is Script {
    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function deploy() external {
        require(block.chainid == 5042002, "testnet only");
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        DemoImplV1 v1 = new DemoImplV1();
        DemoImplV2 v2 = new DemoImplV2();
        DemoUpgradeableProxy proxy = new DemoUpgradeableProxy(address(v1));
        vm.stopBroadcast();
        console2.log("v1", address(v1));
        console2.log("v2", address(v2));
        console2.log("proxy", address(proxy));
    }

    function upgrade(address proxy, address v2) external {
        require(block.chainid == 5042002, "testnet only");
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        DemoUpgradeableProxy(payable(proxy)).upgradeTo(v2);
        vm.stopBroadcast();
    }
}
