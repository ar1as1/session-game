# ZK_SPEC.md -- session-game ZK layer (STAGED -- to build)

> Status: OFF sekarang, STAGED untuk dibina. Vision (19 Nov): ZK = lapisan sekuriti merentas stack, lebih selamat untuk user.
> RULE: jangan hidupkan requireZKProof sebelum SEMUA gate hijau. Chain = kebenaran.
> AUDIT DIBETULKAN 19 Nov: Finding A lama ("commitment===targetLeaf") = SALAH (hallucinate tanpa prover.js). prover.js dedah leaf=Poseidon(allowedContract)=ALLOWLIST, bukan enrolment commitment. Ganti dgn A'+B.

## 0. KEADAAN SEKARANG
- App.jsx: merkleRoot=0x01 dummy, requireZKProof=false. _verifyZKProof tak pernah jalan.
- Circuit + Verifier.sol (0x99e..5E3 LIVE, wired validator 0xc5c..47cf) + prover.js = deployed, kod mati.
- Live security = ECDSA + spend/expiry on-chain.

## 1. REKA BENTUK SEBENAR (dari prover.js)
- commitment=Poseidon(masterKey,sessionAddr,nonce) = identiti session (pub[0]).
- merkle tree = ALLOWLIST kontrak: leaf=Poseidon(contractAddr), root=s.merkleRoot (set masa createSession).
- Proof buktikan: (a) tahu preimage commitment, (b) targetContract dalam allowlist, (c) currentTime<expiry, (d) spentSoFar+txValue<=spendLimit.
- Public=[commitment,merkleRoot,currentTime,txValue] uint[4].

## 2. SOALAN TERAS (dijawab) = J-2FA
Session key bocor != akaun bocor. Proof = bukti tahu master-secret enrolled + kontrak sasaran dibenarkan.
AMARAN: ZK tambah sekuriti HANYA kalau binding betul. Binding pecah = rasa selamat palsu = LEBIH teruk dari ECDSA jujur.

## 3. PRASYARAT FIX (sebelum enable)
### A' [CRITICAL] -- kontrak sasaran TAK terikat panggilan sebenar
targetLeaf = private, BUKAN public. _verifyZKProof tak check target; validateUserOp:108 BUANG target.
Prover buktikan "kontrak A dalam allowlist" sementara userOp panggil kontrak B. Allowlist = hiasan.
FIX:
- Circuit: tukar `signal input targetLeaf` -> `signal input targetContract`; kira leaf=Poseidon(targetContract) DALAM circuit; jadikan targetContract PUBLIC. Public -> uint[5]: [commitment,merkleRoot,currentTime,txValue,targetContract].
- Contract: _verifyZKProof check pub[4]==uint256(uint160(target sebenar dari callData)). validateUserOp hantar target (jangan buang).

### B [HIGH] -- commitment TAK terikat session
pub[0]=commitment tak disemak on-chain. 2FA tak kuat-kuasa; sesiapa jana commitment sendiri.
FIX:
- Contract: Session struct tambah commitment (uint256/bytes32); createSession terima + simpan; _verifyZKProof check pub[0]==s.commitment.
- (Opsyen hardening) ikat sessionAddr==sessionKey.

### Dead-crypto [MED]
expiry/spendLimit/spentSoFar circuit PRIVATE, prover kawal penuh -> check circuit vacuous (on-chain re-enforce selamatkan tapi menipu). Pilih: ikat ke state on-chain ATAU buang dari circuit.
_extractTargetValue offset tetap callData[36:68] -> executeBatch boleh sorok txValue. Sahkan jenis account.

## 4. KESAN TEKNIKAL
Public uint[4] -> uint[5] => Verifier BARU (regenerate), IVerifier uint[5], _verifyZKProof decode uint[5], redeploy Verifier+Validator (Session+commitment). Trusted setup BARU (circuit berubah). prover.js: hantar targetContract raw (bukan targetLeaf pre-hash).

## 5. GATE ENABLE (semua WAJIB hijau -- bukti terminal)
1. snarkjs r1cs info: constraint <= kapasiti ptau. Guna pot12_hez_final.ptau (pot12_final=INVALID alpha1 per master).
2. Triple-cycle R2 bersih circuit baru.
3. CARA UJI A': proof untuk targetContract X, userOp panggil Y!=X -> on-chain REVERT (pub[4]!=target).
4. CARA UJI B: proof commitment lain dari s.commitment -> REVERT.
5. Frontend: bina merkleRoot SEBENAR dari allowedContracts (bukan 0x01), requireZKProof=true, hantar commitment+targetContract.
6. e2e on-chain: create -> action sah lulus -> action luar-allowlist/proof-curi DITOLAK.
7. Dep ZK toolchain: npm audit high dikunci (R6).

## 6. KAIT STACK
session-game = L3 grovenace. ZK_SPEC milik session-game SAHAJA. Jangan campur circuit CLP/zkBounty.
