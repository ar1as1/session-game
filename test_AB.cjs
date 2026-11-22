const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
(async () => {
  const poseidon = await buildPoseidon(); const F = poseidon.F;
  const ph = (a) => F.toObject(poseidon(a));
  const allowed = ["0x1111111111111111111111111111111111111111",
                   "0x2222222222222222222222222222222222222222",
                   "0x3333333333333333333333333333333333333333"];
  const targetContract = BigInt(allowed[1]);           // target DALAM allowlist
  let leaves = allowed.map(c => ph([BigInt(c)]));
  while (leaves.length < 16) leaves.push(0n);           // pad 0n (sama prover)
  const parent = (lvl)=>{const n=[];for(let i=0;i<lvl.length;i+=2)n.push(ph([lvl[i],lvl[i+1]]));return n;};
  const l0=leaves,l1=parent(l0),l2=parent(l1),l3=parent(l2),root=parent(l3)[0];
  const levels=[l0,l1,l2,l3]; let idx=1; const pe=[],pi=[];
  for(const lvl of levels){const s=idx^1; pe.push(lvl[s].toString()); pi.push((idx&1).toString()); idx>>=1;}
  const masterKey=12345n,sessionAddr=67890n,nonce=111n;
  const commitment=ph([masterKey,sessionAddr,nonce]);
  const now=Math.floor(Date.now()/1000);
  const input={commitment:commitment.toString(),merkleRoot:root.toString(),currentTime:now.toString(),
    txValue:"1000",masterKey:masterKey.toString(),sessionAddr:sessionAddr.toString(),nonce:nonce.toString(),
    expiry:(now+3600).toString(),spendLimit:"1000000",spentSoFar:"0",targetContract:targetContract.toString(),
    pathElements:pe,pathIndices:pi};
  const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,"sessionKey_js/sessionKey.wasm","sessionKey_final.zkey");
  fs.writeFileSync("proof.json",JSON.stringify(proof));fs.writeFileSync("public.json",JSON.stringify(publicSignals));
  const vkey=JSON.parse(fs.readFileSync("verification_key.json"));
  console.log("publicSignals:",publicSignals);
  console.log("[1] proof SAH        :",await snarkjs.groth16.verify(vkey,publicSignals,proof),"(mesti true)");
  const t4=[...publicSignals]; t4[4]=BigInt("0x9999999999999999999999999999999999999999").toString();
  console.log("[2] tamper pub[4] tgt:",await snarkjs.groth16.verify(vkey,t4,proof),"(mesti false = A')");
  const t0=[...publicSignals]; t0[0]=(BigInt(publicSignals[0])+1n).toString();
  console.log("[3] tamper pub[0] cmt:",await snarkjs.groth16.verify(vkey,t0,proof),"(mesti false = B)");
  process.exit(0);
})();
