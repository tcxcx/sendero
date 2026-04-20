// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades, Options} from "openzeppelin-foundry-upgrades/Upgrades.sol";

import {SenderoGuestEscrow} from "../src/SenderoGuestEscrow.sol";

/// @notice Deploy `SenderoGuestEscrow` behind a UUPS proxy using
///         OpenZeppelin's foundry-upgrades plugin. The plugin validates
///         the implementation's upgrade safety (no selfdestruct, no
///         unsafe delegatecall, no state-variable initializers) before
///         deploying.
///
/// Env vars:
///   ARC_USDC_ADDRESS   (default: Circle USDC on Arc Testnet)
///   ARC_OPERATOR       (required)
///   ARC_OWNER          (required — recommend a Safe multisig)
///   DEPLOYER_PK
contract Deploy is Script {
    address internal constant DEFAULT_USDC_ARC = 0x3600000000000000000000000000000000000000;

    function run() external returns (address proxy, address implementation) {
        address usdc = vm.envOr("ARC_USDC_ADDRESS", DEFAULT_USDC_ARC);
        address operator = vm.envAddress("ARC_OPERATOR");
        address owner = vm.envOr("ARC_OWNER", msg.sender);

        require(usdc != address(0), "USDC required");
        require(operator != address(0), "ARC_OPERATOR required");

        console2.log("=== SenderoGuestEscrow UUPS Deploy (validated) ===");
        console2.log("Chain ID:  ", block.chainid);
        console2.log("USDC:      ", usdc);
        console2.log("Operator:  ", operator);
        console2.log("Owner:     ", owner);
        console2.log("Deployer:  ", msg.sender);

        vm.startBroadcast();

        proxy = Upgrades.deployUUPSProxy(
            "SenderoGuestEscrow.sol",
            abi.encodeCall(SenderoGuestEscrow.initialize, (usdc, operator, owner))
        );

        vm.stopBroadcast();

        implementation = Upgrades.getImplementationAddress(proxy);

        console2.log("Implementation:", implementation);
        console2.log("Proxy:         ", proxy);
        console2.log("");
        console2.log("Save to .env.local:");
        console2.log("  ARC_ESCROW_ADDRESS=", proxy);
        console2.log("  ARC_ESCROW_IMPL=   ", implementation);
    }
}

/// @notice Deploy a new implementation and upgrade an existing proxy.
///         `Upgrades.upgradeProxy` runs a storage-layout compatibility
///         check against the previous implementation — annotate the
///         new contract with the `oz-upgrades-from` custom tag so the
///         plugin knows which predecessor to diff against.
///
/// Env vars:
///   ARC_ESCROW_ADDRESS   — existing proxy
///   NEW_IMPL_NAME        — e.g. "SenderoGuestEscrowV2.sol"
///   DEPLOYER_PK          — must hold owner role on the proxy (or be a
///                          proposer on the Safe)
contract UpgradeImplementation is Script {
    function run() external returns (address newImpl) {
        address proxy = vm.envAddress("ARC_ESCROW_ADDRESS");
        string memory newContract = vm.envOr("NEW_IMPL_NAME", string("SenderoGuestEscrow.sol"));
        require(proxy != address(0), "ARC_ESCROW_ADDRESS required");

        console2.log("=== SenderoGuestEscrow Upgrade (validated) ===");
        console2.log("Proxy:           ", proxy);
        console2.log("New implementation:", newContract);

        vm.startBroadcast();
        Upgrades.upgradeProxy(proxy, newContract, "");
        vm.stopBroadcast();

        newImpl = Upgrades.getImplementationAddress(proxy);
        console2.log("New implementation addr:", newImpl);
    }
}

/// @notice Validate an upgrade candidate without broadcasting. Run in CI
///         before the upgrade tx is submitted to Safe.
///
/// Env vars:
///   NEW_IMPL_NAME          — e.g. "SenderoGuestEscrowV2.sol"
///   REFERENCE_CONTRACT     — e.g. "SenderoGuestEscrow.sol" (optional if
///                            the new impl has the upgrades-from
///                            custom tag annotation)
contract ValidateUpgrade is Script {
    function run() external {
        string memory newContract = vm.envString("NEW_IMPL_NAME");
        string memory ref = vm.envOr("REFERENCE_CONTRACT", string(""));

        Options memory opts;
        if (bytes(ref).length > 0) {
            opts.referenceContract = ref;
        }

        console2.log("=== Validate Upgrade ===");
        console2.log("Candidate:", newContract);
        if (bytes(ref).length > 0) console2.log("Reference:", ref);

        Upgrades.validateUpgrade(newContract, opts);
        console2.log("OK: storage layout + opcode checks passed");
    }
}

/// @notice Transfer proxy ownership to a Safe (or any address). The
///         owner gates both operator rotation and implementation
///         upgrades via `_authorizeUpgrade`.
contract TransferOwnership is Script {
    function run() external {
        address proxy = vm.envAddress("ARC_ESCROW_ADDRESS");
        address newOwner = vm.envAddress("NEW_OWNER");
        require(proxy != address(0) && newOwner != address(0), "env missing");

        SenderoGuestEscrow escrow = SenderoGuestEscrow(proxy);

        console2.log("=== TransferOwnership ===");
        console2.log("Proxy:         ", proxy);
        console2.log("Current owner: ", escrow.owner());
        console2.log("New owner:     ", newOwner);

        vm.startBroadcast();
        escrow.transferOwnership(newOwner);
        vm.stopBroadcast();
    }
}

/// @notice Rotate the operator. Owner only.
contract SetOperator is Script {
    function run() external {
        address proxy = vm.envAddress("ARC_ESCROW_ADDRESS");
        address newOp = vm.envAddress("NEW_OPERATOR");
        require(proxy != address(0) && newOp != address(0), "env missing");

        SenderoGuestEscrow escrow = SenderoGuestEscrow(proxy);

        console2.log("=== SetOperator ===");
        console2.log("Proxy:       ", proxy);
        console2.log("Old operator:", escrow.operator());
        console2.log("New operator:", newOp);

        vm.startBroadcast();
        escrow.setOperator(newOp);
        vm.stopBroadcast();
    }
}
