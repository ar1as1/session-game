# 🎮 Session Key Validator — ZK-Powered Web3 Gaming

**ZK-powered session keys for Web3 gaming — sign once, play forever. No MetaMask popups. ERC-4337 Account Abstraction.**

## ✅ The Solution: Session Keys + Zero-Knowledge Proofs + Account Abstraction (ERC-4337)

1. **Player signs once** at game start
2. **Session key minted** with strict rules — valid N hours, max spend limit, whitelisted contracts only
3. **All in-game actions auto-sign** silently (no popup)
4. **Every action ZK-validated** — a Groth16 proof gates each UserOperation
5. **Session expires automatically**

## 🔐 Zero-Knowledge Proof

Each action is validated by a **Groth16 proof** (Circom circuit) proving, in zero-knowledge:
- `commitment == Poseidon(masterKey, sessionAddr, nonce)`
- target contract ∈ **Merkle allowlist** (depth-4)
- `currentTime < expiry`
- `spentSoFar + txValue ≤ spendLimit`

The policy is **enforced inside the circuit** and verified on-chain inside the ERC-4337 validator — the master key is never revealed.

## 🏗 Architecture (execution proven, no bundler required)
Player Wallet ──sign once──> Account (ERC-4337 v0.7)
│ validateUserOp ─────> SessionKeyValidator ──> Groth16Verifier (ZK)
│ ▲ ▲
│ Circom circuit (sessionKey.circom)
Session Key (ephemeral) ──auto-sign──> UserOperation
│
EntryPoint.handleOps ──> Account.execute(target)

- **Account.sol** — ERC-4337 v0.7 smart account; delegates validation to the validator, executes the action.
- **SessionKeyValidator.sol** — validates each UserOp: ECDSA(session key) + Groth16 ZK policy proof.
- **AccountFactory.sol** — CREATE2 counterfactual deployment.
- Execution works by calling `EntryPoint.handleOps` directly — a **bundler is a UX layer (gasless relay), not required for correctness**.

## 📦 Deployed Contracts — Sepolia Testnet

| Contract | Address |
| --- | --- |
| Groth16Verifier | `0xe87F7f6932dF02F2516CB9351Ed6B21ffcE8E0A5` |
| SessionKeyValidator | `0x4ce3EC439fDEF053f3de664E9358708Dce6B8869` |
| Account | `0xdBFfC9E026bb4FEa373e36437ca09f17f1fDAd9D` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

## ✅ On-chain Execution Proof

Full flow executed on Sepolia, **status 1**, no bundler:
`EntryPoint.handleOps → Account.validateUserOp (Groth16 ZK verify) → Account.execute(target)`

- handleOps tx: [`0x86ccf8efcf87e713d6d82ece3017376f71c8e3793d49fa634b19a53f8f3a24d2`](https://sepolia.etherscan.io/tx/0x86ccf8efcf87e713d6d82ece3017376f71c8e3793d49fa634b19a53f8f3a24d2)

## 🧪 Counter-Examples (empirical — bugs we broke in our own build, then fixed)

Found by attacking our own design until it failed, then proving the exact cause on-chain. Concrete values, not theory.

**CE-1 — Gas starvation (the key evidence).** `createSession` at `gasLimit = 400000` reverts with **empty data** and `gasUsed < gasLimit` — so it is *not* a top-level out-of-gas. The identical call via `eth_call` / `provider.call` (full gas) and a `cast run` replay return **no revert** → the logic is valid; gas is the cause. The inner validator call is starved by the EVM 63/64 rule. **Fix:** `createSession` ≥ 1.5M gas; `handleOps` `verificationGasLimit` ≥ 1.5M (the on-chain Groth16 verify is heavy). **Proof:** the same call fails at 400k (status 0, "execution reverted") and succeeds at 1.5M (status 1, tx above).

**CE-2 — Phantom verifier.** A verifier address from a stale deploy broadcast had **no bytecode on-chain** (`cast code` = `0x`). The validator's `verifyProof` hit an empty address → empty revert → EntryPoint `AA23 reverted` with inner `0x`. **Fix:** deploy the verifier fresh from `out/`; `verifyProof → true` after.

**CE-3 — Selector drift.** A validator from a stale broadcast did not expose the current `createSession` selector `0x6178dabf` → the account called a non-existent function → empty revert. **Fix:** deploy the validator fresh from the current source.

## 🆕 How this differs from existing work

The building blocks each exist already — ERC-4337 session keys (ZeroDev, Biconomy, Safe — ECDSA-based), ZK-as-validator-module (research), and Poseidon-commitment + Merkle + Groth16 (Tornado/zkFi/credential systems). This project is a **novel integration**: enforcing the full **session-key policy** (commitment + Merkle allowlist + spend limit + expiry) *inside a Groth16 circuit* as an ERC-4337 validator for gaming, with the master key hidden. It is a novel engineering synthesis, not new cryptography.

## ⚙️ Notes

- Session actions need adequate gas on real chains (createSession ≈ 1.5M; handleOps verificationGasLimit ≈ 1.5M for the on-chain Groth16 verify). Low limits revert with empty data.
- Testnet demo only. Mainnet needs a dependency audit, a fresh deployer key, and hardening of the master-key commitment (currently derived from the public owner address → weak as a second factor; the allowlist + spend binding still hold).

## 🧰 Built with

Circom · snarkjs · Groth16 · Poseidon · Foundry · ethers.js · ERC-4337 v0.7

## 📜 License

MIT — Built for the Web3 gaming ecosystem.
