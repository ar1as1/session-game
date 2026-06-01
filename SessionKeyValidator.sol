// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) external view returns (bool);
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

contract SessionKeyValidator {

    event SessionCreated(address indexed wallet, address indexed sessionKey, uint48 expiry, uint256 spendLimit, bytes32 merkleRoot);
    event SessionRevoked(address indexed wallet, address indexed sessionKey);
    event SessionUsed(address indexed wallet, address indexed sessionKey, uint256 txValue, uint256 remaining);

    error SK_Revoked();
    error SK_SpendExceeded(uint256 requested, uint256 remaining);
    error SK_InvalidZKProof();
    error SK_AlreadyExists();
    error SK_ZeroAddress();
    error SK_InvalidDuration();
    error SK_InvalidSpendLimit();

    struct Session {
        uint48  expiry;
        uint208 spendLimit;
        uint256 spentSoFar;
        bytes32 merkleRoot;
        bool    requireZKProof;
        bool    active;
    }

    mapping(address => mapping(address => Session)) private _sessions;
    mapping(address => address[]) private _sessionIndex;

    IVerifier public immutable verifier;
    uint256 public constant MAX_DURATION = 86400;

    constructor(address _verifier) {
        if (_verifier == address(0)) revert SK_ZeroAddress();
        verifier = IVerifier(_verifier);
    }

    function createSession(
        address sessionKey,
        uint256 durationSec,
        uint256 spendLimit,
        bytes32 merkleRoot,
        bool    requireZKProof
    ) external {
        address wallet = msg.sender;
        if (sessionKey == address(0))                       revert SK_ZeroAddress();
        if (durationSec == 0 || durationSec > MAX_DURATION) revert SK_InvalidDuration();
        if (spendLimit == 0)                                revert SK_InvalidSpendLimit();
        if (_sessions[wallet][sessionKey].active)           revert SK_AlreadyExists();
        uint48 expiry = uint48(block.timestamp + durationSec);
        _sessions[wallet][sessionKey] = Session({
            expiry:         expiry,
            spendLimit:     uint208(spendLimit),
            spentSoFar:     0,
            merkleRoot:     merkleRoot,
            requireZKProof: requireZKProof,
            active:         true
        });
        _sessionIndex[wallet].push(sessionKey);
        emit SessionCreated(wallet, sessionKey, expiry, spendLimit, merkleRoot);
    }

    function revokeSession(address sessionKey) external {
        address wallet = msg.sender;
        Session storage s = _sessions[wallet][sessionKey];
        if (!s.active) revert SK_Revoked();
        s.active = false;
        emit SessionRevoked(wallet, sessionKey);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256
    ) external returns (uint256) {
        bytes calldata sig = userOp.signature;
        if (sig.length < 85) return 1;
        address sessionKey = address(bytes20(sig[0:20]));
        bytes memory ecdsaSig = sig[20:85];
        address wallet = userOp.sender;
        Session storage s = _sessions[wallet][sessionKey];
        if (!s.active)                  return 1;
        if (block.timestamp > s.expiry) return 1;
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        address recovered = _recover(ethHash, ecdsaSig);
        if (recovered != sessionKey)    return 1;
        (, uint256 txValue) = _extractTargetValue(userOp.callData);
        uint256 newSpent = s.spentSoFar + txValue;
        if (newSpent > uint256(s.spendLimit))
            revert SK_SpendExceeded(txValue, uint256(s.spendLimit) - s.spentSoFar);
        if (s.requireZKProof) {
            if (sig.length <= 85) revert SK_InvalidZKProof();
            _verifyZKProof(sig[85:], s.merkleRoot, txValue);
        }
        s.spentSoFar = newSpent;
        emit SessionUsed(wallet, sessionKey, txValue, uint256(s.spendLimit) - newSpent);
        return _packValidation(false, s.expiry, 0);
    }

    function getSession(address wallet, address sessionKey) external view returns (Session memory) {
        return _sessions[wallet][sessionKey];
    }

    function sessionStatus(address wallet, address sessionKey)
        external view
        returns (bool valid, uint256 remainingSec, uint256 remainingWei, uint256 spentWei)
    {
        Session storage s = _sessions[wallet][sessionKey];
        if (!s.active || block.timestamp > s.expiry) return (false, 0, 0, s.spentSoFar);
        valid        = true;
        remainingSec = s.expiry - block.timestamp;
        spentWei     = s.spentSoFar;
        remainingWei = uint256(s.spendLimit) - s.spentSoFar;
    }

    function getWalletSessions(address wallet) external view returns (address[] memory) {
        return _sessionIndex[wallet];
    }

    uint256 private constant _SIG_FAIL = 1;

    function _verifyZKProof(bytes calldata zkData, bytes32 expectedMerkleRoot, uint256 txValue) internal view {
        (uint[2] memory pA, uint[2][2] memory pB, uint[2] memory pC, uint[4] memory pub) =
            abi.decode(zkData, (uint[2], uint[2][2], uint[2], uint[4]));
        if (bytes32(pub[1]) != expectedMerkleRoot)   revert SK_InvalidZKProof();
        if (pub[2] > block.timestamp + 60)           revert SK_InvalidZKProof();
        if (block.timestamp > pub[2] + 60)           revert SK_InvalidZKProof();
        if (pub[3] != txValue)                       revert SK_InvalidZKProof();
        if (!verifier.verifyProof(pA, pB, pC, pub)) revert SK_InvalidZKProof();
    }

    function _extractTargetValue(bytes calldata callData) internal pure returns (address target, uint256 value) {
        if (callData.length >= 68) {
            target = address(uint160(uint256(bytes32(callData[4:36]))));
            value  = uint256(bytes32(callData[36:68]));
        }
    }

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s_; uint8 v;
        assembly {
            r  := mload(add(sig, 32))
            s_ := mload(add(sig, 64))
            v  := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s_);
    }

    function _packValidation(bool sigFailed, uint48 validUntil, uint48 validAfter) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }
}