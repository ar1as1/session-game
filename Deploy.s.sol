// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";

interface IDeployVerifier {
    function IS_SCRIPT() external pure returns (bool);
}

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Deploy Groth16Verifier
        bytes memory verifierBytecode = vm.getCode("Verifier.sol:Groth16Verifier");
        address verifier;
        assembly { verifier := create(0, add(verifierBytecode, 0x20), mload(verifierBytecode)) }
        require(verifier != address(0), "Verifier deploy failed");

        // 2. Deploy SessionKeyValidator
        bytes memory validatorBytecode = abi.encodePacked(
            vm.getCode("SessionKeyValidator.sol:SessionKeyValidator"),
            abi.encode(verifier)
        );
        address validator;
        assembly { validator := create(0, add(validatorBytecode, 0x20), mload(validatorBytecode)) }
        require(validator != address(0), "Validator deploy failed");

        vm.stopBroadcast();

        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("Groth16Verifier  :", verifier);
        console.log("SessionKeyValidator:", validator);
        console.log("Chain ID         :", block.chainid);
        console.log("Deployer         :", vm.addr(deployerKey));
    }
}
