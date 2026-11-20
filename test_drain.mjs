import { ethers } from "ethers";
import { Prover } from "./prover.js";
import { readFileSync } from "fs";
const RPC="https://ethereum-sepolia-rpc.publicnode.com";
const VALIDATOR=process.env.VALIDATOR||"0x5c2736F56506526e76E40D88981E4E41B0FA8807";
const MASTER_PK=readFileSync(".env","utf8").match(/^PRIVATE_KEY=(.+)$/m)[1].trim();
const provider=new ethers.JsonRpcProvider(RPC);
const master=new ethers.Wallet(MASTER_PK,provider);
const masterAddr=await master.getAddress();
const chainId=(await provider.getNetwork()).chainId;
const X="0x1111111111111111111111111111111111111111";
const Y="0x9999999999999999999999999999999999999999";
const ABI=["error SK_Revoked()","error SK_SpendExceeded(uint256,uint256)","error SK_InvalidZKProof()","error SK_AlreadyExists()","error SK_ZeroAddress()","error SK_InvalidDuration()","error SK_InvalidSpendLimit()","function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) returns (uint256)"];
const validator=new ethers.Contract(VALIDATOR,ABI,provider);
function why(e){ if(e.revert?.name) return e.revert.name; const d=e.data||e.info?.error?.data; try{if(d){const p=validator.interface.parseError(d); if(p)return p.name;}}catch{} return e.shortMessage||"revert"; }
function hUO(op){const pk=ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32'],[op.sender,op.nonce,ethers.keccak256(op.initCode),ethers.keccak256(op.callData),op.accountGasLimits,op.preVerificationGas,op.gasFees]);const oh=ethers.keccak256(pk);return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','address','uint256'],[oh,VALIDATOR,chainId]));}
function bUO(w,t,v){const i=new ethers.Interface(['function execute(address,uint256,bytes)']);return{sender:w,nonce:ethers.toBeHex(0),initCode:'0x',callData:i.encodeFunctionData('execute',[t,v,'0x']),accountGasLimits:ethers.zeroPadValue('0x'+(200000).toString(16).padStart(16,'0')+(100000).toString(16).padStart(16,'0'),32),preVerificationGas:ethers.toBeHex(21000),gasFees:ethers.zeroPadValue('0x'+ethers.parseUnits('2','gwei').toString(16).padStart(16,'0')+ethers.parseUnits('10','gwei').toString(16).padStart(16,'0'),32),paymasterAndData:'0x',signature:'0x'};}
const toArr=(o)=>[o.sender,o.nonce,o.initCode,o.callData,o.accountGasLimits,o.preVerificationGas,o.gasFees,o.paymasterAndData,o.signature];
const prover=new Prover(RPC,VALIDATOR); await prover.init();
const sess=JSON.parse(readFileSync("active_session.json","utf8"));
const sk=new ethers.Wallet(sess.privateKey);
console.log("DRAIN TEST — wallet gamer:",masterAddr);
console.log("spendLimit:",ethers.formatEther(sess.spendLimitWei),"ETH | sessionKey:",sk.address,"(DIANGGAP BOCOR, attacker pegang)\n");
const opX=await prover.signAction(masterAddr,X,"0x",ethers.parseEther("0.001"));
const zkX="0x"+opX.signature.slice(2).slice((20+65)*2);
async function drain(label,t,ve){const op=bUO(masterAddr,t,ethers.parseEther(ve));const h=hUO(op);op.signature=ethers.concat([sk.address,await sk.signMessage(ethers.getBytes(h)),zkX]);try{const r=await validator.validateUserOp.staticCall(toArr(op),h,0);console.log(`  ${label}: \u26A0 LULUS = DRAIN BERJAYA!`);}catch(e){console.log(`  ${label}: BLOCKED \u2713 -> ${why(e)}`);}}
console.log("Cubaan drain:");
await drain("1. Pesong ke attacker Y (0.001 ETH)", Y, "0.001");
await drain("2. Spend LEBIH limit ke X (1 ETH)", X, "1.0");
await drain("3. Pesong Y + over-limit (1 ETH)", Y, "1.0");
console.log("\nKesimpulan: max exposure = spendLimit ke kontrak allowlist SAHAJA. Wallet penuh TAK boleh di-drain.");
process.exit(0);
