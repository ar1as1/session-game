import { ethers } from 'ethers';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const WASM_PATH  = './sessionKey_js/sessionKey.wasm';
const ZKEY_PATH  = './sessionKey_final.zkey';
const VKEY_PATH  = './verification_key.json';
const SESSION_FILE = './active_session.json';

const VALIDATOR_ABI = [
  'function createSession(address sessionKey, uint256 durationSec, uint256 spendLimit, bytes32 merkleRoot, uint256 commitment, bool requireZKProof)',
  'function revokeSession(address sessionKey)',
  'function sessionStatus(address wallet, address sessionKey) view returns (bool valid, uint256 remainingSec, uint256 remainingWei, uint256 spentWei)',
];

export class Prover {
  #poseidon = null;
  #F        = null;
  #provider = null;
  #validator= null;
  #session  = null;

  constructor(providerUrl, validatorAddress) {
    this.#provider  = new ethers.JsonRpcProvider(providerUrl);
    this.#validator = validatorAddress;
  }

  async init() {
    this.#poseidon = await buildPoseidon();
    this.#F        = this.#poseidon.F;
    if (existsSync(SESSION_FILE)) {
      const raw = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      if (Date.now() < raw.expiresAt) {
        this.#session = raw;
        console.log('[Prover] Session restored from disk');
      }
    }
    return this;
  }

  // ── CREATE SESSION (1 wallet popup only) ──────────────────

  async createSession(masterSigner, durationSec, spendLimitWei, allowedContracts, requireZKProof = true) {
    const sessionWallet = ethers.Wallet.createRandom();
    const masterAddr    = await masterSigner.getAddress();

    const masterKey   = BigInt(ethers.keccak256(ethers.toUtf8Bytes(masterAddr.toLowerCase())));
    const sessionAddr = BigInt(sessionWallet.address);
    const nonce       = BigInt(Date.now());

    const commitment = this.#ph([masterKey, sessionAddr, nonce]);

    const leaves     = this.#padLeaves(allowedContracts.map(c => this.#ph([BigInt(c)])));
    const merkleRoot = this.#buildRoot(leaves);
    const merkleRootBytes32 = ethers.zeroPadValue(ethers.toBeHex(merkleRoot), 32);
    const commitmentBytes32 = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

    const contract = new ethers.Contract(this.#validator, VALIDATOR_ABI, masterSigner);
    console.log('[Prover] Creating session — 1 popup only...');
    const tx = await contract.createSession(
      sessionWallet.address,
      durationSec,
      spendLimitWei,
      merkleRootBytes32,
      commitmentBytes32,
      requireZKProof
    );
    await tx.wait();
    console.log('[Prover] Session active. Tx:', tx.hash);

    this.#session = {
      address:          sessionWallet.address,
      privateKey:       sessionWallet.privateKey,
      masterKey:        masterKey.toString(),
      nonce:            nonce.toString(),
      commitment:       commitment.toString(),
      merkleRoot:       merkleRoot.toString(),
      merkleRootHex:    merkleRootBytes32,
      allowedContracts,
      leaves:           leaves.map(l => l.toString()),
      durationSec,
      spendLimitWei:    spendLimitWei.toString(),
      spentSoFar:       '0',
      expiresAt:        Date.now() + durationSec * 1000,
      requireZKProof,
    };

    writeFileSync(SESSION_FILE, JSON.stringify(this.#session, null, 2));
    return this.#session;
  }

  // ── SIGN TX (no popup, runs silently) ─────────────────────

  async signAction(walletAddress, targetContract, callData, txValue = 0n) {
    const s = this.#requireSession();
    this.#checkConstraints(s, targetContract, txValue);

    const sessionWallet = new ethers.Wallet(s.privateKey, this.#provider);
    const userOp        = this.#buildUserOp(walletAddress, targetContract, callData, txValue);
    const chainId       = (await this.#provider.getNetwork()).chainId;
    const userOpHash    = this.#hashUserOp(userOp, chainId);

    const ecdsaSig = await sessionWallet.signMessage(ethers.getBytes(userOpHash));

    let zkBytes = '0x';
    if (s.requireZKProof) {
      console.log('[Prover] Generating ZK proof...');
      zkBytes = await this.#generateProof(s, targetContract, txValue);
      console.log('[Prover] Proof ready.');
    }

    const packed = ethers.concat([
      sessionWallet.address,
      ecdsaSig,
      zkBytes === '0x' ? '0x' : zkBytes,
    ]);

    userOp.signature = packed;

    this.#session.spentSoFar = (BigInt(s.spentSoFar) + txValue).toString();
    writeFileSync(SESSION_FILE, JSON.stringify(this.#session, null, 2));

    return userOp;
  }

  // ── SEND TO BUNDLER ───────────────────────────────────────

  async sendUserOp(userOp, bundlerUrl) {
    const res = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method:  'eth_sendUserOperation',
        params:  [userOp, '0x0000000071727De22E5E9d8BAf0edAc6f37da032'],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error('Bundler: ' + data.error.message);
    return data.result;
  }

  // ── STATUS ────────────────────────────────────────────────

  status() {
    const s = this.#session;
    if (!s) return { active: false };
    const now  = Date.now();
    const rem  = Math.max(0, s.expiresAt - now);
    const spent = BigInt(s.spentSoFar);
    const limit = BigInt(s.spendLimitWei);
    return {
      active:           rem > 0,
      sessionKey:       s.address,
      remainingMin:     Math.floor(rem / 60000),
      spentWei:         spent.toString(),
      remainingWei:     (limit - spent).toString(),
      spendPercent:     Number(spent * 100n / limit),
      allowedContracts: s.allowedContracts,
    };
  }

  // ── REVOKE ────────────────────────────────────────────────

  async revoke(masterSigner) {
    const s = this.#requireSession();
    const contract = new ethers.Contract(this.#validator, VALIDATOR_ABI, masterSigner);
    await (await contract.revokeSession(s.address)).wait();
    writeFileSync(SESSION_FILE, '{}');
    this.#session = null;
    console.log('[Prover] Session revoked.');
  }

  // ── INTERNAL ──────────────────────────────────────────────

  async #generateProof(s, targetContract, txValue) {
    const proof = await this.#buildMerkleProof(s.leaves, s.allowedContracts, targetContract);
    const input = {
      commitment:   s.commitment,
      merkleRoot:   s.merkleRoot,
      currentTime:  Math.floor(Date.now() / 1000).toString(),
      txValue:      txValue.toString(),
      masterKey:    s.masterKey,
      sessionAddr:  BigInt(s.address).toString(),
      nonce:        s.nonce,
      expiry:       Math.floor(s.expiresAt / 1000).toString(),
      spendLimit:   s.spendLimitWei,
      spentSoFar:   s.spentSoFar,
      targetContract: BigInt(targetContract).toString(),
      pathElements: proof.pathElements.map(x => x.toString()),
      pathIndices:  proof.pathIndices.map(x => x.toString()),
    };

    const { proof: p, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
    const cd = await snarkjs.groth16.exportSolidityCallData(p, publicSignals);

    const parsed = JSON.parse('[' + cd + ']');
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint[2]', 'uint[2][2]', 'uint[2]', 'uint[5]'],
      [parsed[0], parsed[1], parsed[2], parsed[3]]
    );
    return encoded;
  }

  #buildUserOp(walletAddress, target, callData, value) {
    const iface = new ethers.Interface(['function execute(address,uint256,bytes)']);
    const encoded = iface.encodeFunctionData('execute', [target, value, callData]);
    return {
      sender:               walletAddress,
      nonce:                ethers.toBeHex(0),
      initCode:             '0x',
      callData:             encoded,
      accountGasLimits:     ethers.zeroPadValue('0x' + (200000).toString(16).padStart(16,'0') + (100000).toString(16).padStart(16,'0'), 32),
      preVerificationGas:   ethers.toBeHex(21000),
      gasFees:              ethers.zeroPadValue('0x' + ethers.parseUnits('2','gwei').toString(16).padStart(16,'0') + ethers.parseUnits('10','gwei').toString(16).padStart(16,'0'), 32),
      paymasterAndData:     '0x',
      signature:            '0x',
    };
  }

  #hashUserOp(userOp, chainId) {
    const packed = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32'],
      [
        userOp.sender, userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
      ]
    );
    const opHash = ethers.keccak256(packed);
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32','address','uint256'],
        [opHash, this.#validator, chainId]
      )
    );
  }

  #ph(inputs) {
    return this.#F.toObject(this.#poseidon(inputs));
  }

  #padLeaves(leaves) {
    while (leaves.length < 16) leaves.push(0n);
    return leaves;
  }

  #buildRoot(leaves) {
    let layer = [...leaves];
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2)
        next.push(this.#ph([layer[i], layer[i+1]]));
      layer = next;
    }
    return layer[0];
  }

  #buildMerkleProof(leavesStr, contracts, target) {
    const leaves = leavesStr.map(BigInt);
    const idx    = contracts.findIndex(c => c.toLowerCase() === target.toLowerCase());
    const pathElements = [], pathIndices = [];
    let layer = [...leaves];
    let i = idx;
    for (let d = 0; d < 4; d++) {
      const sib = i % 2 === 0 ? layer[i+1] : layer[i-1];
      pathIndices.push(i % 2);
      pathElements.push(sib);
      const next = [];
      for (let j = 0; j < layer.length; j += 2)
        next.push(this.#ph([layer[j], layer[j+1]]));
      layer = next;
      i = Math.floor(i / 2);
    }
    return { pathElements, pathIndices };
  }

  #checkConstraints(s, target, value) {
    if (Date.now() > s.expiresAt)
      throw new Error('Session expired');
    if (!s.allowedContracts.map(c => c.toLowerCase()).includes(target.toLowerCase()))
      throw new Error('Contract not whitelisted: ' + target);
    if (BigInt(s.spentSoFar) + value > BigInt(s.spendLimitWei))
      throw new Error('Spend limit exceeded');
  }

  #requireSession() {
    if (!this.#session) throw new Error('No active session. Call createSession() first.');
    return this.#session;
  }
}
