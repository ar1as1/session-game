# session-game

ZK session keys for Web3 gaming — gasless, no per-action wallet popup. ERC-4337 Account Abstraction + Groth16 (Circom/snarkjs). A session key acts for the player, bounded by a spend limit and a contract allowlist, every action gated by a zero-knowledge proof.

npm: `@ar1as1/session-key-validator`

## How it works
A player creates a **session**: a temporary key authorized to call a fixed **allowlist** of contracts, up to a **spend limit**, until an **expiry**. Each signed action carries a Groth16 proof attesting, in zero knowledge:
- the target contract is a member of the allowlist (Merkle membership),
- the session commitment `= Poseidon(masterKey, sessionAddr, nonce)` matches the on-chain session,

without revealing the master key. `SessionKeyValidator` verifies the proof on-chain via `Groth16Verifier`, and enforces `onlyEntryPoint`, the allowlist, the spend limit, and the ZK requirement.

## Deployed — Sepolia (chainId 11155111)
| Contract | Address |
|---|---|
| SessionKeyValidator | `0xACE7ca8524434270E5A5A8c8A405F0D309967dFc` |
| Groth16Verifier | `0x5D4925780a7D49768b471c8afD78C894fC2E35F2` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

Deployed from a clean deployer; earlier deployments are superseded.

## Security model
A leaked session key can spend **at most** the session spend limit, **only** to allowlisted contracts — never the player's full wallet (capped blast radius).

Verified by triple-cycle adversarial testing (empirical):
- **Binding** — all 5 public signals (commitment, merkleRoot, time, value, target) bound to the proof; tampering any invalidates it.
- **Soundness** — a prover cannot forge membership for a non-allowlisted target, nor a mismatched commitment; circuit constraints reject both.
- **On-chain** — valid actions verify; a leaked-key redirect to a non-allowlisted target reverts (target binding); a wrong-commitment proof reverts (commitment binding); non-EntryPoint callers are rejected.

See `THREAT_MODEL.md`.

## Build
forge build
circom sessionKey.circom --r1cs --wasm --sym -o .

groth16 trusted setup → sessionKey_final.zkey → Verifier.sol ; proofs via prover.js

---
Testnet deployment. Not audited for mainnet.
