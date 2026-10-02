// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {FixedRefund} from "../../src/demo/FixedRefund.sol";
import {OverpayVault} from "../../src/demo/OverpayVault.sol";

interface IUsdcApprove {
    function approve(address, uint256) external returns (bool);
}

/// @notice Phase 6 demo contracts (docs/GUARD.md §4.2–4.3, BUILD_PLAN Phase 6). Mainnet requires ALLOW_MAINNET=1 and
///         the owner's go-ahead (CLAUDE.md §7).
///   forge script script/arc/Phase6Demo.s.sol --sig "deploy()" --rpc-url arc --broadcast --verify ...
///   forge script script/arc/Phase6Demo.s.sol --sig "deposit(address,uint256)" <vault> <value18> --rpc-url arc --broadcast
/// FixedRefund needs no funding: on Arc the ERC-20 payment and the native refund are the same ledger, so the refund
/// is paid out of the payment just received. OverpayVault's deposit is unrecoverable by design (both withdrawals
/// revert): keep it to dust.
contract Phase6Demo is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant VAULT_CAP6 = 2_000_000; // guarded payout cap: 2 USDC per window, ERC-20 view

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

    function deploy() external returns (FixedRefund shop, OverpayVault vault) {
        _guard();
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        shop = new FixedRefund(0); // sold out from the start: every buy is refunded, converted
        vault = new OverpayVault(VAULT_CAP6, 1 days);
        IUsdcApprove(USDC).approve(address(shop), type(uint256).max);
        vm.stopBroadcast();
        console2.log("FixedRefund", address(shop));
        console2.log("OverpayVault", address(vault));
    }

    function deposit(address vault, uint256 value18) external {
        _guard();
        vm.startBroadcast(_envKey("DEPLOYER_PRIVATE_KEY"));
        OverpayVault(vault).deposit{value: value18}();
        vm.stopBroadcast();
    }
}
