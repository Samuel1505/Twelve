// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2, Vm} from "forge-std/Test.sol";
import {SCALE} from "../src/guard/Usdc.sol";

/// @notice Phase 0 spike (CLAUDE.md §5 VERIFY): does `forge test --fork-url $ARC_TESTNET_RPC_URL`
/// exercise the native-coin precompiles behind 0x3600? These tests assert REAL Arc semantics; if they fail
/// under a fork, the answer is "no" and test-arc/ must become broadcast-and-assert scripts (ADR-008).
/// Holder = deployer address (must hold testnet USDC from the faucet).
contract PrecompileForkTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant SYSTEM_EMITTER = 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE;
    bytes32 constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");

    address holder;
    address recipient = address(uint160(uint256(keccak256("twelve.phase0.recipient"))));

    function setUp() public {
        holder = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        require(block.chainid == 5042002, "run with --fork-url $ARC_TESTNET_RPC_URL");
    }

    function test_codeAt0x3600() public view {
        console2.log("code length at 0x3600:", USDC.code.length);
        console2.logBytes(USDC.code);
    }

    function test_balanceOfMatchesNative() public view {
        (bool ok, bytes memory ret) = USDC.staticcall(abi.encodeWithSignature("balanceOf(address)", holder));
        console2.log("balanceOf staticcall ok:", ok, "ret length:", ret.length);
        assertTrue(ok, "balanceOf reverted under fork");
        uint256 b6 = abi.decode(ret, (uint256));
        uint256 b18 = holder.balance;
        console2.log("balanceOf (6):", b6);
        console2.log("native    (18):", b18);
        assertGt(b18, 0, "holder unfunded - use the faucet");
        assertEq(b6, b18 / SCALE, "ERC-20 view != floor(native / SCALE)");
    }

    function test_transferMovesNativeAndEmitsBothLogs() public {
        uint256 amt6 = 1; // 1e-6 USDC
        uint256 hBefore = holder.balance;
        uint256 rBefore = recipient.balance;
        vm.recordLogs();
        vm.prank(holder);
        (bool ok, bytes memory ret) = USDC.call(abi.encodeWithSignature("transfer(address,uint256)", recipient, amt6));
        console2.log("transfer call ok:", ok, "ret length:", ret.length);
        assertTrue(ok, "transfer reverted under fork");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 sys;
        uint256 erc;
        for (uint256 i = 0; i < logs.length; i++) {
            console2.log("log", i, logs[i].emitter);
            if (logs[i].topics.length > 0 && logs[i].topics[0] == TRANSFER_TOPIC) {
                if (logs[i].emitter == SYSTEM_EMITTER) sys++;
                if (logs[i].emitter == USDC) erc++;
            }
        }
        console2.log("recipient native delta:", recipient.balance - rBefore);
        console2.log("holder native delta:", hBefore - holder.balance);
        assertEq(recipient.balance - rBefore, amt6 * SCALE, "native balance did not move by amt6*SCALE");
        assertEq(erc, 1, "expected one 0x3600 Transfer log");
        assertEq(sys, 1, "expected one system-emitter Transfer log");
    }
}
