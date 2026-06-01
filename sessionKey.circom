pragma circom 2.2.3;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

template Commitment() {
    signal input masterKey;
    signal input sessionAddr;
    signal input nonce;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== masterKey;
    h.inputs[1] <== sessionAddr;
    h.inputs[2] <== nonce;
    out <== h.out;
}

template SpendCheck(n) {
    signal input spentSoFar;
    signal input txValue;
    signal input spendLimit;
    signal output ok;
    signal total;
    total <== spentSoFar + txValue;
    component lte = LessEqThan(n);
    lte.in[0] <== total;
    lte.in[1] <== spendLimit;
    ok <== lte.out;
}

template ExpiryCheck(n) {
    signal input currentTime;
    signal input expiry;
    signal output ok;
    component lt = LessThan(n);
    lt.in[0] <== currentTime;
    lt.in[1] <== expiry;
    ok <== lt.out;
}

template MerkleProof(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output ok;
    signal nodes[depth + 1];
    signal selL[depth];
    signal selR[depth];
    signal left[depth];
    signal right[depth];
    component hashers[depth];
    nodes[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        selL[i] <== pathIndices[i] * (pathElements[i] - nodes[i]);
        left[i]  <== nodes[i] + selL[i];
        selR[i] <== pathIndices[i] * (nodes[i] - pathElements[i]);
        right[i] <== pathElements[i] + selR[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        nodes[i + 1] <== hashers[i].out;
    }
    component eq = IsEqual();
    eq.in[0] <== nodes[depth];
    eq.in[1] <== root;
    ok <== eq.out;
}

template SessionKeyProof(merkleDepth) {
    signal input commitment;
    signal input merkleRoot;
    signal input currentTime;
    signal input txValue;
    signal input masterKey;
    signal input sessionAddr;
    signal input nonce;
    signal input expiry;
    signal input spendLimit;
    signal input spentSoFar;
    signal input targetLeaf;
    signal input pathElements[merkleDepth];
    signal input pathIndices[merkleDepth];

    component cmt = Commitment();
    cmt.masterKey   <== masterKey;
    cmt.sessionAddr <== sessionAddr;
    cmt.nonce       <== nonce;
    commitment      === cmt.out;

    component exp = ExpiryCheck(64);
    exp.currentTime <== currentTime;
    exp.expiry      <== expiry;
    exp.ok          === 1;

    component spend = SpendCheck(128);
    spend.spentSoFar <== spentSoFar;
    spend.txValue    <== txValue;
    spend.spendLimit <== spendLimit;
    spend.ok         === 1;

    component merkle = MerkleProof(merkleDepth);
    merkle.leaf <== targetLeaf;
    merkle.root <== merkleRoot;
    for (var i = 0; i < merkleDepth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.ok === 1;
}

component main {public [
    commitment,
    merkleRoot,
    currentTime,
    txValue
]} = SessionKeyProof(4);
