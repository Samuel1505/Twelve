// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TwelveRegistry} from "../src/TwelveRegistry.sol";
import {TwelveGate} from "../src/TwelveGate.sol";
import {ITwelveRegistry} from "../src/interfaces/ITwelveRegistry.sol";

/// @dev Local (plain EVM) tests. Native value here is the local EVM balance, not Arc's ledger (labeled per I8).
contract Sink {
    uint256 public received;
    error Nope(uint256 code);

    function pay() external payable returns (uint256) {
        received += msg.value;
        return 42;
    }

    function fail() external payable {
        revert Nope(7);
    }
}

contract Reenter {
    TwelveGate public gate;

    function set(TwelveGate g) external {
        gate = g;
    }

    function poke() external payable {
        gate.forward(address(this), abi.encodeCall(this.noop, ()));
    }

    function noop() external payable {}
}

contract TwelveGateTest is Test {
    TwelveRegistry reg;
    TwelveGate gate;
    Sink clean;
    Sink dirty;
    address attester = makeAddr("attester");
    address user = makeAddr("user");

    function setUp() public {
        reg = new TwelveRegistry();
        gate = new TwelveGate(reg, attester);
        clean = new Sink();
        dirty = new Sink();
        vm.startPrank(attester);
        reg.attest(address(clean), address(clean).codehash, bytes32("r1"), 1, 0, 0, address(0), 0, 1, "t");
        reg.attest(address(dirty), address(dirty).codehash, bytes32("r2"), 2, 1, 0, address(0), 0, 1, "t");
        vm.stopPrank();
        vm.deal(user, 10 ether);
    }

    function test_forwardsToCleanTarget() public {
        vm.expectEmit(true, true, false, true, address(gate));
        emit TwelveGate.Forwarded(user, address(clean), 1 ether, Sink.pay.selector);
        vm.prank(user);
        bytes memory ret = gate.forward{value: 1 ether}(address(clean), abi.encodeCall(Sink.pay, ()));
        assertEq(abi.decode(ret, (uint256)), 42);
        assertEq(clean.received(), 1 ether);
        assertEq(address(clean).balance, 1 ether);
    }

    function test_revertsForFindingsTarget() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(TwelveGate.TargetNotClean.selector, address(dirty), ITwelveRegistry.Status.FINDINGS)
        );
        gate.forward{value: 1 ether}(address(dirty), abi.encodeCall(Sink.pay, ()));
    }

    function test_revertsForUnattestedStaleAndRevoked() public {
        Sink other = new Sink();
        vm.expectRevert(
            abi.encodeWithSelector(TwelveGate.TargetNotClean.selector, address(other), ITwelveRegistry.Status.NONE)
        );
        gate.forward(address(other), "");

        vm.etch(address(clean), hex"6000");
        vm.expectRevert(
            abi.encodeWithSelector(TwelveGate.TargetNotClean.selector, address(clean), ITwelveRegistry.Status.STALE)
        );
        gate.forward(address(clean), "");
    }

    function test_revokedTargetIsRefused() public {
        vm.prank(attester);
        reg.revoke(address(clean), "UPGRADED");
        vm.expectRevert(
            abi.encodeWithSelector(TwelveGate.TargetNotClean.selector, address(clean), ITwelveRegistry.Status.REVOKED)
        );
        gate.forward(address(clean), "");
    }

    function test_bubblesTargetRevert() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Sink.Nope.selector, 7));
        gate.forward{value: 1}(address(clean), abi.encodeCall(Sink.fail, ()));
    }

    function test_onlyTrustsItsAttester() public {
        Sink s = new Sink();
        vm.prank(makeAddr("someoneElse"));
        reg.attest(address(s), address(s).codehash, bytes32("r"), 1, 0, 0, address(0), 0, 1, "t");
        vm.expectRevert(
            abi.encodeWithSelector(TwelveGate.TargetNotClean.selector, address(s), ITwelveRegistry.Status.NONE)
        );
        gate.forward(address(s), "");
    }

    function test_nonReentrant() public {
        Reenter r = new Reenter();
        r.set(gate);
        vm.prank(attester);
        reg.attest(address(r), address(r).codehash, bytes32("r"), 1, 0, 0, address(0), 0, 1, "t");
        vm.expectRevert(TwelveGate.Reentrancy.selector);
        gate.forward(address(r), abi.encodeCall(Reenter.poke, ()));
    }
}
