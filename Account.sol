// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

struct PackedUserOperation {
    address sender; uint256 nonce; bytes initCode; bytes callData;
    bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees;
    bytes paymasterAndData; bytes signature;
}

interface ISessionKeyValidator {
    function createSession(address,uint256,uint256,bytes32,uint256,bool) external;
    function revokeSession(address) external;
    function validateUserOp(PackedUserOperation calldata, bytes32, uint256) external returns (uint256);
}

/// ERC-4337 v0.7 account. Validation delegated to a shared SessionKeyValidator.
contract Account {
    address public immutable entryPoint;
    address public immutable validator;
    address public immutable owner;

    error NotEntryPoint();
    error NotOwner();

    constructor(address _entryPoint, address _validator, address _owner) {
        entryPoint = _entryPoint; validator = _validator; owner = _owner;
    }
    modifier onlyEntryPoint() { if (msg.sender != entryPoint) revert NotEntryPoint(); _; }
    modifier onlyOwner()      { if (msg.sender != owner)      revert NotOwner();      _; }

    /// Called by EntryPoint. Delegate to session validator + pay prefund.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external onlyEntryPoint returns (uint256 validationData)
    {
        validationData = ISessionKeyValidator(validator).validateUserOp(userOp, userOpHash, 0);
        if (missingAccountFunds > 0) {
            (bool ok,) = payable(msg.sender).call{value: missingAccountFunds}("");
            (ok); // EntryPoint enforces; ignore per 4337
        }
    }

    /// Called by EntryPoint via userOp.callData (selector 0xb61d27f6).
    function execute(address target, uint256 value, bytes calldata data) external onlyEntryPoint {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
    }

    /// Owner manages sessions (forwarded so _sessions keyed by THIS account).
    function createSession(address sk, uint256 dur, uint256 limit, bytes32 root, uint256 commit, bool zk) external onlyOwner {
        ISessionKeyValidator(validator).createSession(sk, dur, limit, root, commit, zk);
    }
    function revokeSession(address sk) external onlyOwner {
        ISessionKeyValidator(validator).revokeSession(sk);
    }

    receive() external payable {}
}
