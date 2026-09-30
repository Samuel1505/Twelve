// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {ImmutableCashier as C09Bug, IERC20 as IERC20a} from "../../corpus/c09_immutable_binding/bug.sol";
import {ImmutableCashier as C09Safe, IERC20 as IERC20d} from "../../corpus/c09_immutable_binding/safe.sol";
import {StorageCashier as C10Bug, IERC20 as IERC20b} from "../../corpus/c10_storage_binding/bug.sol";
import {StorageCashier as C10Safe, IERC20 as IERC20c} from "../../corpus/c10_storage_binding/safe.sol";
import {RefundVaultImpl as C11BugImpl, SimpleProxy as C11BugProxy} from "../../corpus/c11_proxy_impl/bug.sol";
import {RefundVaultImpl as C11SafeImpl, SimpleProxy as C11SafeProxy} from "../../corpus/c11_proxy_impl/safe.sol";

/// @notice Deploys corpus cases c09–c11 to Arc testnet for deployed-mode analyzer tests (CORPUS_AND_TESTING §2).
/// forge script script/DeployCorpusDeployed.s.sol --rpc-url arc_testnet --broadcast --verify \
///   --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
contract DeployCorpusDeployed is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function run() external {
        require(block.chainid == 5042002, "testnet only");
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        C09Bug c09b = new C09Bug(IERC20a(USDC));
        C09Safe c09s = new C09Safe(IERC20d(USDC));
        C10Bug c10b = new C10Bug();
        c10b.setToken(IERC20b(USDC));
        C10Safe c10s = new C10Safe();
        c10s.setToken(IERC20c(USDC));
        C11BugImpl c11bi = new C11BugImpl();
        C11BugProxy c11bp = new C11BugProxy(address(c11bi));
        C11SafeImpl c11si = new C11SafeImpl();
        C11SafeProxy c11sp = new C11SafeProxy(address(c11si));
        vm.stopBroadcast();
        console2.log("c09 bug", address(c09b));
        console2.log("c09 safe", address(c09s));
        console2.log("c10 bug", address(c10b));
        console2.log("c10 safe", address(c10s));
        console2.log("c11 bug proxy", address(c11bp));
        console2.log("c11 bug impl", address(c11bi));
        console2.log("c11 safe proxy", address(c11sp));
        console2.log("c11 safe impl", address(c11si));
    }
}
