# ZK_SPEC.md — session-game ZK layer (STAGED — to build)

> Status: OFF sekarang, tapi STAGED untuk dibina (BUKAN park selamanya).
> Vision black (19 Nov): ZK = lapisan sekuriti merentas stack grovenace, lebih selamat untuk user.
> Simpan di /root/session-game/. Spec niat + gate sebelum ZK boleh dihidupkan.
> RULE: jangan hidupkan requireZKProof sebelum SEMUA gate bawah hijau. Chain = kebenaran.

## 0. KEADAAN SEKARANG (confirmed 19 Nov)
- App.jsx: merkleRoot=0x01 dummy, requireZKProof=false. _verifyZKProof TAK PERNAH jalan di prod.
- Circuit sessionKey.circom + Verifier.sol (0x99e..5E3 LIVE, wired ke validator 0xc5c..47cf) + prover.js
  = deployed tapi kod mati. Live security = ECDSA + spend/expiry on-chain.

## 1. SOALAN TERAS (dijawab 19 Nov)
**ZK proof jamin invariant APA atas ECDSA + spend/expiry on-chain?**
→ **J-2FA (DIPILIH):** "Session key bocor != keseluruhan akaun bocor". Proof = bukti tahu preimage
  master-secret yang di-enrol dalam merkle tree wallet. Penyerang curi sessionKey ECDSA SAHAJA tak
  boleh execute sebab tak tahu master-secret. Ini nilai ZK sebenar untuk gaming (vision merentas stack).
> AMARAN: ZK tambah sekuriti HANYA kalau circuit betul ikat (Finding A). Circuit pecah = rasa selamat
> palsu = LEBIH teruk dari ECDSA jujur. Jangan hidupkan atas circuit under-constrained.

## 2. PRASYARAT FIX (sebelum enable)
### A [CRITICAL] — targetLeaf tak terikat commitment
Circuit buktikan "commitment=Poseidon(masterKey,sessionAddr,nonce)" DAN "targetLeaf in tree" sebagai
dua fakta TERPISAH — tiada constraint sambung. Proof lulus walau commitment & leaf zero kaitan.
- FIX R1: tambah selepas `commitment === cmt.out;` (baris ~90):
  `commitment === targetLeaf;`
- Kesan: recompile -> trusted setup BARU (ptau -> final.zkey ke /root/web3-data, bukan / ketat)
  -> redeploy Groth16Verifier (uint[4]) -> kemas validator.verifier.

### B [HIGH] — proof tak terikat actor/tx
_verifyZKProof semak pub[1]=merkleRoot, pub[2]=time, pub[3]=txValue; pub[0]=commitment TAK disemak.
Proof mudah-alih merentas session kongsi merkleRoot+txValue.
- FIX: (a) dengan A, merkle membership ikat commitment ke root enrolled; (b) tambah binding ke
  wallet/sessionKey/userOpHash sebagai public signal + require on-chain (R2 Cycle 2/3).

### Dead-crypto [MED]
expiry/spendLimit/spentSoFar circuit PRIVATE, prover kawal penuh -> check circuit vacuous (on-chain
re-enforce selamatkan tapi menipu pembaca). Pilih: ikat ke state on-chain, ATAU buang dari circuit.
_extractTargetValue offset tetap callData[36:68] -> executeBatch boleh sorok txValue. Sahkan jenis account.

## 3. GATE ENABLE (semua WAJIB hijau — bukti terminal)
1. Fix A + CARA UJI empirik: jana 2 proof SAMA (merkleRoot,targetLeaf,path,currentTime,txValue), BEZA
   (masterKey,sessionAddr,nonce). Lepas fix, proof kedua mesti DITOLAK (sebelum fix kedua lulus = bug).
2. Triple-cycle R2 bersih atas circuit baru.
3. Frontend bina merkleRoot SEBENAR dari commitment enrolled (bukan 0x01) + requireZKProof=true.
4. e2e on-chain: create(ZK on) -> action proof sah lulus -> action proof palsu/curi DITOLAK.
5. Dep ZK toolchain: npm audit high ditangani/dikunci (R6 supply-chain).

## 4. KAIT STACK (scope)
session-game = L3 grovenace. ZK_SPEC ni milik session-game SAHAJA. Jangan campur circuit CLP
(identity_kyc) atau zkBounty (exploit_knowledge) — tiga stack, tiga circuit, tiga model.
