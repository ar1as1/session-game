// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Account} from "./Account.sol";

/// CREATE2 counterfactual factory. initCode = factory ++ createAccount(owner, salt).
contract AccountFactory {
    address public immutable entryPoint;
    address public immutable validator;

    event AccountCreated(address indexed account, address indexed owner, bytes32 salt);

    constructor(address _entryPoint, address _validator) {
        entryPoint = _entryPoint; validator = _validator;
    }

    function createAccount(address owner, bytes32 salt) external returns (address account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) return predicted;
        account = address(new Account{salt: salt}(entryPoint, validator, owner));
        emit AccountCreated(account, owner, salt);
    }

    function getAddress(address owner, bytes32 salt) public view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt,
            keccak256(abi.encodePacked(type(Account).creationCode, abi.encode(entryPoint, validator, owner)))
        )))));
    }
}
