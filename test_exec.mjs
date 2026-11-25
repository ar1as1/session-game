import { ethers } from "ethers";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
const RPC=process.env.RPC_URL||"https://ethereum-sepolia-rpc.publicnode.com";
const EP="0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const PK=readFileSync(".env","utf8").match(/^PRIVATE_KEY=(.+)$/m)[1].trim();
const provider=new ethers.JsonRpcProvider(RPC);
const owner=new ethers.Wallet(PK,provider);
console.log("owner baki:",ethers.formatEther(await provider.getBalance(owner.address)),"ETH");
const findArt=n=>{for(const d of readdirSync("out")){try{const j=JSON.parse(readFileSync(`out/${d}/${n}.json`,"utf8"));return{abi:j.abi,bytecode:j.bytecode.object};}catch{}}throw new Error(n);};
const deploy=async(n,...a)=>{const art=findArt(n);const c=await(new ethers.ContractFactory(art.abi,art.bytecode,owner)).deploy(...a);await c.waitForDeployment();const ad=await c.getAddress();console.log("   "+n+"=",ad);return ad;};
let VERIFIER,VAL,ACC;
if(existsSync("deployed.json")){({VERIFIER,VAL,ACC}=JSON.parse(readFileSync("deployed.json","utf8")));console.log("REUSE deployed.json");}
else{VERIFIER=await deploy("Groth16Verifier");VAL=await deploy("SessionKeyValidator",VERIFIER,EP);ACC=await deploy("Account",EP,VAL,owner.address);writeFileSync("deployed.json",JSON.stringify({VERIFIER,VAL,ACC},null,2));}
const acc=new ethers.Contract(ACC,findArt("Account").abi,owner);
const pos=await buildPoseidon();const F=pos.F;const ph=x=>F.toObject(pos(x));
const TARGET="0x1111111111111111111111111111111111111111";const WEI=0n;
let lv=[ph([BigInt(TARGET)])];while(lv.length<16)lv.push(0n);
const par=l=>{const n=[];for(let i=0;i<l.length;i+=2)n.push(ph([l[i],l[i+1]]));return n;};
const l0=lv,l1=par(l0),l2=par(l1),l3=par(l2),root=par(l3)[0];
let idx=0;const pe=[],pi=[];for(const x of[l0,l1,l2,l3]){const s=idx^1;pe.push(x[s].toString());pi.push((idx&1).toString());idx>>=1;}
const sk=ethers.Wallet.createRandom();
const mk=BigInt(ethers.keccak256(ethers.toUtf8Bytes(owner.address.toLowerCase())));
const sessionAddr=BigInt(sk.address);const nonce=BigInt(Date.now());
const commitment=ph([mk,sessionAddr,nonce]);
console.log("[*] createSession (gas 1.5M)...");
const cr=await (await acc.createSession(sk.address,7200,ethers.parseEther("0.01"),ethers.zeroPadValue(ethers.toBeHex(root),32),commitment,true,{gasLimit:1500000n})).wait();
console.log("   createSession status",cr.status);
const EP_ABI=["function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)","function getNonce(address,uint192) view returns (uint256)","function depositTo(address) payable","function balanceOf(address) view returns (uint256)","function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)","error FailedOp(uint256 opIndex, string reason)","error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)"];
const ep=new ethers.Contract(EP,EP_ABI,owner);
const need=ethers.parseEther("0.03");const bal=await ep.balanceOf(ACC);
if(bal<need){console.log("[*] depositTo...");await (await ep.depositTo(ACC,{value:need-bal})).wait();}
console.log("   deposit =",ethers.formatEther(await ep.balanceOf(ACC)),"ETH");
const ifc=new ethers.Interface(["function execute(address,uint256,bytes)"]);
const callData=ifc.encodeFunctionData("execute",[TARGET,WEI,"0x"]);
const pk=(x,y)=>ethers.zeroPadValue("0x"+x.toString(16).padStart(32,"0")+y.toString(16).padStart(32,"0"),32);
const op={sender:ACC,nonce:await ep.getNonce(ACC,0),initCode:"0x",callData,accountGasLimits:pk(1500000n,600000n),preVerificationGas:150000n,gasFees:pk(ethers.parseUnits("1","gwei"),ethers.parseUnits("5","gwei")),paymasterAndData:"0x",signature:"0x"};
const toArr=o=>[o.sender,o.nonce,o.initCode,o.callData,o.accountGasLimits,o.preVerificationGas,o.gasFees,o.paymasterAndData,o.signature];
const uoh=await ep.getUserOpHash(toArr(op));
const ecdsa=await sk.signMessage(ethers.getBytes(uoh));
const input={commitment:commitment.toString(),merkleRoot:root.toString(),currentTime:Math.floor(Date.now()/1000).toString(),txValue:WEI.toString(),masterKey:mk.toString(),sessionAddr:sessionAddr.toString(),nonce:nonce.toString(),expiry:(Math.floor(Date.now()/1000)+7200).toString(),spendLimit:ethers.parseEther("0.01").toString(),spentSoFar:"0",targetContract:BigInt(TARGET).toString(),pathElements:pe,pathIndices:pi};
console.log("[*] ZK proof...");
const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,"sessionKey_js/sessionKey.wasm","sessionKey_final.zkey");
const cd=JSON.parse("["+await snarkjs.groth16.exportSolidityCallData(proof,publicSignals)+"]");
const zk=ethers.AbiCoder.defaultAbiCoder().encode(["uint[2]","uint[2][2]","uint[2]","uint[5]"],[cd[0],cd[1],cd[2],cd[3]]);
op.signature=ethers.concat([sk.address,ecdsa,zk]);
console.log("[*] handleOps (EXECUTION on-chain, NO bundler)...");
try{
  const tx=await ep.handleOps([toArr(op)],owner.address,{gasLimit:5000000n});
  console.log("   tx:",tx.hash); const r=await tx.wait();
  writeFileSync("last_tx.txt",tx.hash);
  process.stdout.write("\n\x1b[7m\x1b[1m  https://sepolia.etherscan.io/tx/"+tx.hash+"  \x1b[0m\n\n");
  console.log("   status:",r.status, r.status===1?">>> EXECUTION BERJAYA — execute() on-chain via EntryPoint. ✓✓✓":">>> status 0");
}catch(e){
  console.log("   REVERT:",e.shortMessage||e.message);
  if(e.revert) console.log("   FailedOp:",e.revert.name,JSON.stringify(e.revert.args.map(String)));
  if(e.receipt){writeFileSync("last_tx.txt",e.receipt.hash);process.stdout.write("\n\x1b[7m  https://sepolia.etherscan.io/tx/"+e.receipt.hash+"  \x1b[0m\n");}
}
process.exit(0);
