// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TwelveRegistry} from "../src/TwelveRegistry.sol";
import {TwelveGate} from "../src/TwelveGate.sol";
import {ITwelveRegistry} from "../src/interfaces/ITwelveRegistry.sol";

/// @notice Deploys TwelveRegistry and TwelveGate via the CREATE2 factory with fixed salts, so the registry has the
///         same address on testnet and mainnet (docs/REGISTRY.md §8). The gate trusts the attester derived from
///         ATTESTER_PRIVATE_KEY; the deployer key only deploys (I12).
/// forge script script/DeployRegistry.s.sol --rpc-url arc_testnet --broadcast --verify \
///   --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
/// Mainnet additionally requires ALLOW_MAINNET=1 (CLAUDE.md §7: ask before deploying to mainnet).
contract DeployRegistry is Script {
    bytes32 constant REGISTRY_SALT = keccak256("twelve.registry.v1");
    bytes32 constant GATE_SALT = keccak256("twelve.gate.v1");

    function _envKey(string memory name) internal view returns (uint256) {
        string memory k = vm.envString(name);
        bytes memory b = bytes(k);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(k);
        return vm.parseUint(string.concat("0x", k));
    }

    function run() external returns (TwelveRegistry reg, TwelveGate gate) {
        require(block.chainid == 5042002 || (block.chainid == 5042 && vm.envOr("ALLOW_MAINNET", uint256(0)) == 1),
            "testnet, or mainnet with ALLOW_MAINNET=1");
        uint256 deployerKey = _envKey("DEPLOYER_PRIVATE_KEY");
        address attester = vm.addr(_envKey("ATTESTER_PRIVATE_KEY"));
        require(attester != vm.addr(deployerKey), "I12: attester and deployer keys must differ");

        vm.startBroadcast(deployerKey);
        address predicted = vm.computeCreate2Address(REGISTRY_SALT, keccak256(type(TwelveRegistry).creationCode));
        reg = predicted.code.length > 0 ? TwelveRegistry(predicted) : new TwelveRegistry{salt: REGISTRY_SALT}();
        gate = new TwelveGate{salt: GATE_SALT}(ITwelveRegistry(address(reg)), attester);
        vm.stopBroadcast();

        console2.log("chainId", block.chainid);
        console2.log("TwelveRegistry", address(reg));
        console2.log("TwelveGate", address(gate));
        console2.log("attester", attester);
    }
}
