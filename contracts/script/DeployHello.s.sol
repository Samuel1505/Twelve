// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Hello} from "../src/Hello.sol";

/// @notice Phase 0 spike: deploy Hello to Arc testnet to prove solc/evm_version acceptance.
/// forge script script/DeployHello.s.sol --rpc-url $ARC_TESTNET_RPC_URL --broadcast [--evm-version osaka]
contract DeployHello is Script {
    function run() external returns (Hello h) {
        require(block.chainid == 5042002, "testnet only in Phase 0");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        h = new Hello();
        vm.stopBroadcast();
        console2.log("Hello deployed at", address(h));
        console2.log("hello() =", h.hello());
    }
}
