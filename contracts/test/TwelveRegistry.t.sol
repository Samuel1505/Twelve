// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {TwelveRegistry} from "../src/TwelveRegistry.sol";
import {ITwelveRegistry} from "../src/interfaces/ITwelveRegistry.sol";

/// @dev Local tests (docs/REGISTRY.md §7). No Arc-specific behavior is involved: the registry only reads
///      extcodehash and writes storage, so these run on the plain EVM (I8 does not apply).
contract TwelveRegistryTest is Test {
    TwelveRegistry reg;
    address attesterA = makeAddr("attesterA");
    address attesterB = makeAddr("attesterB");
    address target = makeAddr("target");
    address impl = makeAddr("impl");
    bytes32 constant REPORT = keccak256("report");
    bytes32 constant TOOL = bytes32("twelve/0.1.0+abcdef1");

    function setUp() public {
        reg = new TwelveRegistry();
        vm.etch(target, hex"6001600155");
        vm.etch(impl, hex"6002600255");
    }

    function _attest(address who, uint8 verdict) internal {
        vm.prank(who);
        reg.attest(target, target.codehash, REPORT, verdict, 0, 0, address(0), bytes32(0), 1, TOOL);
    }

    function test_attest_happyPath_andEvent() public {
        vm.expectEmit(true, true, true, true, address(reg));
        emit ITwelveRegistry.Attested(attesterA, target, REPORT, target.codehash, 1, 0, 0, address(0));
        _attest(attesterA, 1);
        ITwelveRegistry.Attestation memory a = reg.get(attesterA, target);
        assertEq(a.codehash, target.codehash);
        assertEq(a.reportHash, REPORT);
        assertEq(a.attestedAt, block.timestamp);
        assertEq(a.verdict, 1);
        assertEq(a.schemaVersion, 1);
        assertEq(a.toolVersion, TOOL);
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.CLEAN));
        assertTrue(reg.isClean(attesterA, target));
    }

    function test_overwrite_replacesAndClearsRevoked() public {
        _attest(attesterA, 1);
        vm.prank(attesterA);
        reg.revoke(target, "UPGRADED");
        vm.prank(attesterA);
        reg.attest(target, target.codehash, keccak256("r2"), 2, 3, 1, address(0), bytes32(0), 1, TOOL);
        ITwelveRegistry.Attestation memory a = reg.get(attesterA, target);
        assertEq(a.reportHash, keccak256("r2"));
        assertEq(a.high, 3);
        assertEq(a.medium, 1);
        assertFalse(a.revoked);
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.FINDINGS));
    }

    function test_revert_targetHasNoCode() public {
        vm.prank(attesterA);
        vm.expectRevert(ITwelveRegistry.TargetHasNoCode.selector);
        reg.attest(makeAddr("eoa"), bytes32(0), REPORT, 1, 0, 0, address(0), bytes32(0), 1, TOOL);
    }

    function test_revert_codehashMismatch_whenCodeChangedBeforeWrite() public {
        bytes32 scanned = target.codehash;
        vm.etch(target, hex"60ff");
        vm.prank(attesterA);
        vm.expectRevert(
            abi.encodeWithSelector(ITwelveRegistry.CodehashMismatch.selector, scanned, target.codehash)
        );
        reg.attest(target, scanned, REPORT, 1, 0, 0, address(0), bytes32(0), 1, TOOL);
    }

    function test_revert_invalidVerdict() public {
        for (uint8 v = 0; v < 6; v++) {
            if (v >= 1 && v <= 3) continue;
            vm.prank(attesterA);
            vm.expectRevert(ITwelveRegistry.InvalidVerdict.selector);
            reg.attest(target, target.codehash, REPORT, v, 0, 0, address(0), bytes32(0), 1, TOOL);
        }
    }

    function test_revert_implCodehashWithoutImplementation() public {
        vm.prank(attesterA);
        vm.expectRevert(
            abi.encodeWithSelector(ITwelveRegistry.CodehashMismatch.selector, bytes32(0), bytes32(uint256(1)))
        );
        reg.attest(target, target.codehash, REPORT, 1, 0, 0, address(0), bytes32(uint256(1)), 1, TOOL);
    }

    function test_stale_afterCodeChange() public {
        _attest(attesterA, 1);
        vm.etch(target, hex"60ee");
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.STALE));
        assertFalse(reg.isClean(attesterA, target));
    }

    function test_proxy_staleWhenImplementationCodeChanges() public {
        vm.prank(attesterA);
        reg.attest(target, target.codehash, REPORT, 1, 0, 0, impl, impl.codehash, 1, TOOL);
        assertTrue(reg.isClean(attesterA, target));
        vm.etch(impl, hex"60dd");
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.STALE));
    }

    function test_proxy_revert_implCodehashMismatch() public {
        vm.prank(attesterA);
        vm.expectRevert(
            abi.encodeWithSelector(ITwelveRegistry.CodehashMismatch.selector, bytes32(uint256(7)), impl.codehash)
        );
        reg.attest(target, target.codehash, REPORT, 1, 0, 0, impl, bytes32(uint256(7)), 1, TOOL);
    }

    function test_revoke() public {
        _attest(attesterA, 1);
        vm.expectEmit(true, true, false, true, address(reg));
        emit ITwelveRegistry.Revoked(attesterA, target, "UPGRADED");
        vm.prank(attesterA);
        reg.revoke(target, "UPGRADED");
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.REVOKED));
        vm.prank(attesterA);
        vm.expectRevert(ITwelveRegistry.NothingToRevoke.selector);
        reg.revoke(target, "AGAIN");
    }

    function test_revoke_nonexistent() public {
        vm.prank(attesterA);
        vm.expectRevert(ITwelveRegistry.NothingToRevoke.selector);
        reg.revoke(target, "X");
    }

    function test_attesterIsolation() public {
        _attest(attesterA, 1);
        assertEq(uint8(reg.status(attesterB, target)), uint8(ITwelveRegistry.Status.NONE));
        _attest(attesterB, 2);
        vm.prank(attesterB);
        reg.revoke(target, "X");
        assertTrue(reg.isClean(attesterA, target));
        assertEq(uint8(reg.status(attesterB, target)), uint8(ITwelveRegistry.Status.REVOKED));
    }

    function test_statusNone() public view {
        assertEq(uint8(reg.status(attesterA, target)), uint8(ITwelveRegistry.Status.NONE));
        assertFalse(reg.isClean(attesterA, target));
    }

    /// fuzz: status never returns CLEAN once the code differs from what was attested
    function testFuzz_neverCleanWhenCodehashDiffers(bytes memory newCode) public {
        vm.assume(newCode.length > 0 && newCode.length < 512);
        vm.assume(newCode[0] != 0xef); // EIP-3541
        _attest(attesterA, 1);
        bytes32 before = target.codehash;
        vm.etch(target, newCode);
        if (target.codehash != before) {
            assertTrue(reg.status(attesterA, target) != ITwelveRegistry.Status.CLEAN);
        }
    }

    /// storage layout: mapping at slot 0; each record is 5 slots with the scalar fields packed in slot 3
    function test_storageLayout() public {
        vm.prank(attesterA);
        reg.attest(target, target.codehash, REPORT, 3, 0x1111, 0x2222, impl, impl.codehash, 7, TOOL);
        bytes32 base = keccak256(abi.encode(target, keccak256(abi.encode(attesterA, uint256(0)))));
        assertEq(vm.load(address(reg), base), target.codehash);
        assertEq(vm.load(address(reg), bytes32(uint256(base) + 1)), REPORT);
        assertEq(vm.load(address(reg), bytes32(uint256(base) + 2)), impl.codehash);
        uint256 packed = uint256(vm.load(address(reg), bytes32(uint256(base) + 3)));
        assertEq(address(uint160(packed)), impl);
        assertEq(uint40(packed >> 160), uint40(block.timestamp));
        assertEq(uint16(packed >> 200), 0x1111);
        assertEq(uint16(packed >> 216), 0x2222);
        assertEq(uint8(packed >> 232), 3);
        assertEq(uint8(packed >> 240), 7);
        assertEq(uint8(packed >> 248), 0); // revoked
        assertEq(vm.load(address(reg), bytes32(uint256(base) + 4)), TOOL);
        assertEq(vm.load(address(reg), bytes32(uint256(base) + 5)), bytes32(0));
    }
}

/// Handler for the invariant test: random attest / revoke / etch sequences.
contract RegistryHandler is Test {
    TwelveRegistry public reg;
    address[3] public attesters = [address(0xA1), address(0xA2), address(0xA3)];
    address[3] public targets = [address(0xB1), address(0xB2), address(0xB3)];
    address public impl = address(0xC1);

    constructor(TwelveRegistry r) {
        reg = r;
        for (uint256 i; i < 3; i++) vm.etch(targets[i], abi.encodePacked(hex"60", uint8(i), hex"00"));
        vm.etch(impl, hex"600900");
    }

    function attest(uint8 a, uint8 t, uint8 verdict, bool withImpl) external {
        verdict = uint8(bound(verdict, 1, 3));
        address tgt = targets[t % 3];
        vm.prank(attesters[a % 3]);
        reg.attest(tgt, tgt.codehash, bytes32(uint256(verdict)), verdict, 0, 0, withImpl ? impl : address(0),
            withImpl ? impl.codehash : bytes32(0), 1, bytes32("t"));
    }

    function revoke(uint8 a, uint8 t) external {
        vm.prank(attesters[a % 3]);
        try reg.revoke(targets[t % 3], "r") {} catch {}
    }

    function etch(uint8 t, uint8 b, bool implToo) external {
        vm.etch(targets[t % 3], abi.encodePacked(hex"60", b, hex"00"));
        if (implToo) vm.etch(impl, abi.encodePacked(hex"61", b, hex"00"));
    }
}

contract TwelveRegistryInvariantTest is StdInvariant, Test {
    TwelveRegistry reg;
    RegistryHandler handler;

    function setUp() public {
        reg = new TwelveRegistry();
        handler = new RegistryHandler(reg);
        targetContract(address(handler));
    }

    /// isClean ⇒ status == CLEAN ⇒ the record is fresh for the code that is there now
    function invariant_isCleanImpliesFreshCleanRecord() public view {
        for (uint256 i; i < 3; i++) {
            for (uint256 j; j < 3; j++) {
                address a = handler.attesters(i);
                address t = handler.targets(j);
                if (!reg.isClean(a, t)) continue;
                assertEq(uint8(reg.status(a, t)), uint8(ITwelveRegistry.Status.CLEAN));
                ITwelveRegistry.Attestation memory r = reg.get(a, t);
                assertEq(r.codehash, t.codehash);
                assertFalse(r.revoked);
                if (r.implementation != address(0)) assertEq(r.implCodehash, r.implementation.codehash);
            }
        }
    }
}
