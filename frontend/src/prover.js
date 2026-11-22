import { ethers } from 'ethers';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';

const WASM_PATH = '/sessionKey.wasm';
const ZKEY_PATH = '/sessionKey_final.zkey';
const SESSION_KEY = 'session-game.active';
const ENTRYPOINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

const VALIDATOR_ABI = [
  'function createSession(address sessionKey, uint256 durationSec, uint256 spendLimit, bytes32 merkleRoot, uint256 commitment, bool requireZKProof)',
  'function revokeSession(address sessionKey)',
  'function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) returns (uint256)',
];

export class Prover {
  #poseidon=null; #F=null; #provider=null; #validator=null; #session=null;
  constructor(provider, validatorAddress){ this.#provider=provider; this.#validator=validatorAddress; }

  async init(){
    this.#poseidon = await buildPoseidon(); this.#F = this.#poseidon.F;
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw){ const s=JSON.parse(raw); if(Date.now()<s.expiresAt) this.#session=s; else localStorage.removeItem(SESSION_KEY); }
    return this;
  }

  async createSession(masterSigner, durationSec, spendLimitWei, allowedContracts, requireZKProof=true){
    const sw = ethers.Wallet.createRandom();
    const masterAddr = await masterSigner.getAddress();
    const masterKey = BigInt(ethers.keccak256(ethers.toUtf8Bytes(masterAddr.toLowerCase())));
    const sessionAddr = BigInt(sw.address); const nonce = BigInt(Date.now());
    const commitment = this.#ph([masterKey, sessionAddr, nonce]);
    const leaves = this.#padLeaves(allowedContracts.map(c=>this.#ph([BigInt(c)])));
    const merkleRoot = this.#buildRoot(leaves);
    const mrB = ethers.zeroPadValue(ethers.toBeHex(merkleRoot),32);
    const cmB = ethers.zeroPadValue(ethers.toBeHex(commitment),32);
    const c = new ethers.Contract(this.#validator, VALIDATOR_ABI, masterSigner);
    const tx = await c.createSession(sw.address, durationSec, spendLimitWei, mrB, cmB, requireZKProof);
    await tx.wait();
    this.#session = { address:sw.address, privateKey:sw.privateKey, masterKey:masterKey.toString(),
      nonce:nonce.toString(), commitment:commitment.toString(), merkleRoot:merkleRoot.toString(),
      merkleRootHex:mrB, allowedContracts, leaves:leaves.map(l=>l.toString()), durationSec,
      spendLimitWei:spendLimitWei.toString(), spentSoFar:'0', expiresAt:Date.now()+durationSec*1000,
      requireZKProof, txHash:tx.hash };
    localStorage.setItem(SESSION_KEY, JSON.stringify(this.#session));
    return this.#session;
  }

  // Fasa 2: jana proof SEBENAR + verify on-chain via staticCall (no bundler/execution)
  async signActionVerify(walletAddress, targetContract, callData='0x', txValue=0n){
    const s = this.#requireSession();
    this.#checkConstraints(s, targetContract, txValue);
    const sw = new ethers.Wallet(s.privateKey);
    const chainId = (await this.#provider.getNetwork()).chainId;
    const op = this.#buildUserOp(walletAddress, targetContract, callData, txValue);
    const h = this.#hashUserOp(op, chainId);
    const ecdsa = await sw.signMessage(ethers.getBytes(h));
    const { proof, publicSignals } = await this.generateProof(targetContract, txValue);
    const cd = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const p = JSON.parse('['+cd+']');
    const zk = ethers.AbiCoder.defaultAbiCoder().encode(['uint[2]','uint[2][2]','uint[2]','uint[5]'],[p[0],p[1],p[2],p[3]]);
    op.signature = ethers.concat([sw.address, ecdsa, zk]);
    const toArr = o => [o.sender,o.nonce,o.initCode,o.callData,o.accountGasLimits,o.preVerificationGas,o.gasFees,o.paymasterAndData,o.signature];
    const v = new ethers.Contract(this.#validator, VALIDATOR_ABI, this.#provider);
    const ret = await v.validateUserOp.staticCall(toArr(op), h, 0, { from: ENTRYPOINT });
    return { valid: (BigInt(ret) & 1n) === 0n, ret: ret.toString() };
  }

  async generateProof(targetContract, txValue=0n){
    const s = this.#requireSession();
    const mp = await this.#buildMerkleProof(s.leaves, s.allowedContracts, targetContract);
    const input = { commitment:s.commitment, merkleRoot:s.merkleRoot,
      currentTime:Math.floor(Date.now()/1000).toString(), txValue:txValue.toString(),
      masterKey:s.masterKey, sessionAddr:BigInt(s.address).toString(), nonce:s.nonce,
      expiry:Math.floor(s.expiresAt/1000).toString(), spendLimit:s.spendLimitWei,
      spentSoFar:s.spentSoFar, targetContract:BigInt(targetContract).toString(),
      pathElements:mp.pathElements.map(x=>x.toString()), pathIndices:mp.pathIndices.map(x=>x.toString()) };
    return await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
  }

  session(){ return this.#session; }
  async revoke(ms){ const s=this.#requireSession(); const c=new ethers.Contract(this.#validator,VALIDATOR_ABI,ms); await (await c.revokeSession(s.address)).wait(); localStorage.removeItem(SESSION_KEY); this.#session=null; }

  #buildUserOp(sender, target, callData, value){
    const iface = new ethers.Interface(['function execute(address,uint256,bytes)']);
    return { sender, nonce:ethers.toBeHex(0), initCode:'0x',
      callData:iface.encodeFunctionData('execute',[target,value,callData]),
      accountGasLimits:ethers.zeroPadValue('0x'+(200000).toString(16).padStart(16,'0')+(100000).toString(16).padStart(16,'0'),32),
      preVerificationGas:ethers.toBeHex(21000),
      gasFees:ethers.zeroPadValue('0x'+ethers.parseUnits('2','gwei').toString(16).padStart(16,'0')+ethers.parseUnits('10','gwei').toString(16).padStart(16,'0'),32),
      paymasterAndData:'0x', signature:'0x' };
  }
  #hashUserOp(op, chainId){
    const packed = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32'],
      [op.sender,op.nonce,ethers.keccak256(op.initCode),ethers.keccak256(op.callData),op.accountGasLimits,op.preVerificationGas,op.gasFees]);
    const oh = ethers.keccak256(packed);
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','address','uint256'],[oh,this.#validator,chainId]));
  }
  #ph(a){ return this.#F.toObject(this.#poseidon(a)); }
  #padLeaves(l){ while(l.length<16) l.push(0n); return l; }
  #buildRoot(leaves){ let x=[...leaves]; while(x.length>1){const n=[];for(let i=0;i<x.length;i+=2)n.push(this.#ph([x[i],x[i+1]]));x=n;} return x[0]; }
  #buildMerkleProof(leavesStr, contracts, target){
    const leaves=leavesStr.map(BigInt); const idx=contracts.findIndex(c=>c.toLowerCase()===target.toLowerCase());
    const pe=[],pi=[]; let x=[...leaves]; let i=idx;
    for(let d=0;d<4;d++){ const sib=i%2===0?x[i+1]:x[i-1]; pi.push(i%2); pe.push(sib);
      const n=[];for(let j=0;j<x.length;j+=2)n.push(this.#ph([x[j],x[j+1]]));x=n;i=Math.floor(i/2);}
    return { pathElements:pe, pathIndices:pi };
  }
  #checkConstraints(s,target,value){
    if(Date.now()>s.expiresAt) throw new Error('Session expired');
    if(!s.allowedContracts.map(c=>c.toLowerCase()).includes(target.toLowerCase())) throw new Error('Target not in allowlist');
    if(BigInt(s.spentSoFar)+value>BigInt(s.spendLimitWei)) throw new Error('Spend limit exceeded');
  }
  #requireSession(){ if(!this.#session) throw new Error('No active session'); return this.#session; }
}
