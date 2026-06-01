// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import "forge-std/Script.sol";

contract DeployValidator is Script {
    address constant VERIFIER = 0x99e61B9dC9C6889Dd2e249CC6183B6fa7A8795E3;

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        bytes memory code = abi.encodePacked(
            vm.getCode("SessionKeyValidator.sol:SessionKeyValidator"),
            abi.encode(VERIFIER)
        );
        address validator;
        assembly { validator := create(0, add(code, 0x20), mload(code)) }
        require(validator != address(0), "Deploy failed");
        vm.stopBroadcast();
        console.log("SessionKeyValidator:", validator);
    }
}
