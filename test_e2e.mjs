import { ethers } from "ethers";
import { Prover } from "./prover.js";
import { readFileSync } from "fs";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

const RPC = process.env.RPC || "https://ethereum-sepolia-rpc.publicnode.com";
let VALIDATOR = process.env.VALIDATOR;
if (!VALIDATOR) { try { VALIDATOR = readFileSync("/tmp/val.log","utf8").match(/Deployed to: (0x[a-fA-F0-9]{40})/)[1]; } catch {} }
if (!VALIDATOR) throw new Error("set VALIDATOR=0x..807");
const MASTER_PK = readFileSync(".env","utf8").match(/^PRIVATE_KEY=(.+)$/m)[1].trim();

const provider = new ethers.JsonRpcProvider(RPC);
const master = new ethers.Wallet(MASTER_PK, provider);
const masterAddr = await master.getAddress();
const chainId = (await provider.getNetwork()).chainId;

const X = "0x1111111111111111111111111111111111111111"; // allowlisted
const Y = "0x9999999999999999999999999999999999999999"; // attacker, BUKAN allowlist
const WEI = ethers.parseEther("0.001");

function hashUserOp(op){
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32'],
    [op.sender,op.nonce,ethers.keccak256(op.initCode),ethers.keccak256(op.callData),op.accountGasLimits,op.preVerificationGas,op.gasFees]);
  const oh = ethers.keccak256(packed);
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','address','uint256'],[oh,VALIDATOR,chainId]));
}
function buildUserOp(wallet,target,value){
  const iface=new ethers.Interface(['function execute(address,uint256,bytes)']);
  return { sender:wallet, nonce:ethers.toBeHex(0), initCode:'0x',
    callData:iface.encodeFunctionData('execute',[target,value,'0x']),
    accountGasLimits:ethers.zeroPadValue('0x'+(200000).toString(16).padStart(16,'0')+(100000).toString(16).padStart(16,'0'),32),
    preVerificationGas:ethers.toBeHex(21000),
    gasFees:ethers.zeroPadValue('0x'+ethers.parseUnits('2','gwei').toString(16).padStart(16,'0')+ethers.parseUnits('10','gwei').toString(16).padStart(16,'0'),32),
    paymasterAndData:'0x', signature:'0x' };
}
const toArr=(o)=>[o.sender,o.nonce,o.initCode,o.callData,o.accountGasLimits,o.preVerificationGas,o.gasFees,o.paymasterAndData,o.signature];
const ABI=["error SK_InvalidZKProof()","error SK_SpendExceeded(uint256,uint256)","function createSession(address,uint256,uint256,bytes32,uint256,bool)","function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) returns (uint256)"];
const validator=new ethers.Contract(VALIDATOR,ABI,provider);

console.log("VALIDATOR:",VALIDATOR,"chainId:",chainId.toString());

// 1) CREATE SESSION (ZK on)
const prover=new Prover(RPC,VALIDATOR); await prover.init();
console.log("[*] createSession ZK-on (allowlist=[X])... (tx on-chain, tunggu)");
await prover.createSession(master,7200,WEI*10n,[X],true);
const sess=JSON.parse(readFileSync("active_session.json","utf8"));
const sk=new ethers.Wallet(sess.privateKey);
console.log("    sessionKey:",sk.address);

// 2) HAPPY PATH
console.log("\n[1] HAPPY PATH — target X (allowlisted):");
const opX=await prover.signAction(masterAddr,X,"0x",WEI);
const hX=hashUserOp(opX);
try{ const r=await validator.validateUserOp.staticCall(toArr(opX),hX,0);
  console.log("    =>", ((BigInt(r)&1n)===0n)?"VALID \u2713 (mesti VALID)":"INVALID \u2717 (patut lulus)");
}catch(e){ console.log("    REVERT \u2717 (patut lulus):", e.shortMessage||e.message); }
const zkX="0x"+opX.signature.slice(2).slice((20+65)*2); // zkData utk X

// 3) ATTACK A': proof-X tapi panggil Y
console.log("\n[2] ATTACK A' — sessionKey bocor, pesong ke Y + lampir proof-X:");
const opY=buildUserOp(masterAddr,Y,WEI);
const hY=hashUserOp(opY);
opY.signature=ethers.concat([sk.address, await sk.signMessage(ethers.getBytes(hY)), zkX]);
try{ await validator.validateUserOp.staticCall(toArr(opY),hY,0);
  console.log("    \u26A0 TAK REVERT = CE DRAIN! pub[4]=X diterima utk Y. A' GAGAL.");
}catch(e){ console.log("    REVERT \u2713 (A' tahan, pub[4]=X != Y):", e.shortMessage||e.reason||"SK_InvalidZKProof"); }

// 4) ATTACK B: commitment salah
console.log("\n[3] ATTACK B — proof commitment salah (masterKey lain):");
const poseidon=await buildPoseidon(); const F=poseidon.F; const ph=(a)=>F.toObject(poseidon(a));
let leaves=sess.allowedContracts.map(c=>ph([BigInt(c)])); while(leaves.length<16) leaves.push(0n);
const par=(l)=>{const n=[];for(let i=0;i<l.length;i+=2)n.push(ph([l[i],l[i+1]]));return n;};
const l0=leaves,l1=par(l0),l2=par(l1),l3=par(l2),root=par(l3)[0];
console.log("    merkleRoot padan sess?", root.toString()===BigInt(sess.merkleRoot).toString());
let idx=sess.allowedContracts.findIndex(c=>c.toLowerCase()===X.toLowerCase()); const pe=[],pi=[];
for(const lv of [l0,l1,l2,l3]){const s=idx^1; pe.push(lv[s].toString()); pi.push((idx&1).toString()); idx>>=1;}
const badMaster=999999n, badCommit=ph([badMaster,BigInt(sk.address),BigInt(sess.nonce)]);
const now=Math.floor(Date.now()/1000);
const inp={commitment:badCommit.toString(),merkleRoot:root.toString(),currentTime:now.toString(),txValue:WEI.toString(),masterKey:badMaster.toString(),sessionAddr:BigInt(sk.address).toString(),nonce:sess.nonce,expiry:Math.floor(sess.expiresAt/1000).toString(),spendLimit:sess.spendLimitWei,spentSoFar:"0",targetContract:BigInt(X).toString(),pathElements:pe,pathIndices:pi};
const {proof:bp,publicSignals:bpub}=await snarkjs.groth16.fullProve(inp,"sessionKey_js/sessionKey.wasm","sessionKey_final.zkey");
const bparsed=JSON.parse('['+await snarkjs.groth16.exportSolidityCallData(bp,bpub)+']');
const zkBad=ethers.AbiCoder.defaultAbiCoder().encode(['uint[2]','uint[2][2]','uint[2]','uint[5]'],[bparsed[0],bparsed[1],bparsed[2],bparsed[3]]);
const opB=buildUserOp(masterAddr,X,WEI); const hB=hashUserOp(opB);
opB.signature=ethers.concat([sk.address, await sk.signMessage(ethers.getBytes(hB)), zkBad]);
try{ await validator.validateUserOp.staticCall(toArr(opB),hB,0);
  console.log("    \u26A0 TAK REVERT = CE! commitment salah diterima. B GAGAL.");
}catch(e){ console.log("    REVERT \u2713 (B tahan, pub[0] != s.commitment):", e.shortMessage||e.reason||"SK_InvalidZKProof"); }

console.log("\n=== e2e + audit selesai ===");
process.exit(0);
