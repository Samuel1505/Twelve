// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TwelveGate} from "../../src/TwelveGate.sol";
import {ITwelveRegistry} from "../../src/interfaces/ITwelveRegistry.sol";

/// @notice Broadcast-and-assert on Arc (ADR-017 pattern): forwards a tiny native payment through TwelveGate to a
///         CLEAN-attested target. The FINDINGS refusal is shown with `cast call` (a reverting broadcast only burns gas).
/// env: GATE_ADDRESS, CLEAN_TARGET, FORWARD_VALUE_18 (raw native units), DEPLOYER_PRIVATE_KEY
contract GateE2E is Script {
    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function run() external {
        TwelveGate gate = TwelveGate(vm.envAddress("GATE_ADDRESS"));
        address target = vm.envAddress("CLEAN_TARGET");
        uint256 value = vm.envUint("FORWARD_VALUE_18");
        ITwelveRegistry.Status s = gate.registry().status(gate.attester(), target);
        require(s == ITwelveRegistry.Status.CLEAN, "target is not CLEAN under the gate's attester");
        uint256 before = target.balance;
        uint256 key = _envKey("DEPLOYER_PRIVATE_KEY");
        address user = vm.addr(key);
        vm.startBroadcast(key);
        gate.forward{value: value}(target, abi.encodeWithSignature("cashOut(address)", user));
        vm.stopBroadcast();
        console2.log("forwarded (native, 18-dec raw):", value);
        console2.log("target balance delta (expect 0: cashOut pays it on):", target.balance - before);
    }
}
