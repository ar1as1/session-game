# 🎮 Session Key Validator — ZK-Powered Web3 Gaming

> **Zero popup. Zero friction. Full on-chain security.**
> Sign once. Play forever. No more MetaMask interruptions mid-game.

---

## 🧩 The Problem

Every Web3 game today forces players to sign a transaction for every action —
shoot an enemy, open a chest, buy an item. MetaMask pops up. Game breaks.
Players quit. Developers lose users.

## ✅ The Solution

**Session Keys + Zero-Knowledge Proofs + Account Abstraction (ERC-4337)**

1. **Player signs once** at game start
2. **Session key is minted** with strict rules:
   - ⏱️ Valid for N hours only
   - 💰 Max spend limit enforced on-chain
   - 📋 Whitelisted contracts only — cannot touch other wallets
3. **All in-game actions auto-sign** silently in background
4. **ZK proof validates** each transaction cryptographically
5. **Session expires automatically** — no manual cleanup needed

---

## 🏗️ Architecture
Player Wallet (MetaMask)
│
│ sign once
▼
SessionKeyValidator.sol ◄──── Groth16Verifier.sol (ZK)
│                              │
│                    Circom Circuit (sessionKey.circom)
│
▼
Session Key (ephemeral wallet in browser)
│
│ auto-sign (no popup)
▼
ERC-4337 Bundler → EntryPoint → Game Contract
---

## 📦 Deployed Contracts — Sepolia Testnet

| Contract | Address |
|---|---|
| `Groth16Verifier` | `0x99e61B9dC9C6889Dd2e249CC6183B6fa7A8795E3` |
| `SessionKeyValidator` | `0xc5655348C4E6e77AFF2BBb03A5758CaC205347Cf` |

- **Network:** Ethereum Sepolia Testnet (Chain ID: 11155111)
- **Explorer:** [Sepolia Etherscan](https://sepolia.etherscan.io)

---

## 🔐 Security Model

| Layer | Mechanism |
|---|---|
| Session isolation | Each session = fresh ephemeral keypair |
| Spend enforcement | On-chain `spentSoFar ≤ spendLimit` |
| Contract whitelist | Poseidon Merkle tree, depth 4 |
| Time-bound | `expiry` enforced in EVM `block.timestamp` |
| ZK proof | Groth16 — commitment, merkle root, time, value |
| Key storage | AES-256-GCM encrypted (browser), file-scoped (Node) |

---

## 🚀 Quick Start

### Prerequisites
```bash
node >= 18
foundry >= 1.5.1
```

### Install
```bash
git clone https://github.com/YOUR_USERNAME/session-game
cd session-game
npm install
```

### Generate ZK Proof & Create Session
```javascript
import { Prover } from './prover.js';

const prover = await new Prover(RPC_URL, VALIDATOR_ADDRESS).init();

// Sign ONCE — 1 MetaMask popup
await prover.createSession(
  masterSigner,
  7200,                          // 2 hours
  ethers.parseEther('0.01'),     // max 0.01 ETH spend
  ['0xGameContract...'],         // whitelisted contracts
  true                           // require ZK proof
);

// All subsequent actions — ZERO popup
const userOp = await prover.signAction(
  walletAddress,
  gameContractAddress,
  callData
);
```

---

## 📁 Project Structure
session-game/
├── sessionKey.circom          # ZK circuit definition
├── sessionKey_final.zkey      # Groth16 proving key
├── verification_key.json      # On-chain verification key
├── Verifier.sol               # Groth16 verifier (auto-generated)
├── SessionKeyValidator.sol    # Core session logic
├── prover.js                  # Node.js SDK
├── Deploy.s.sol               # Foundry deploy script
└── DeployValidator.s.sol      # Validator-only deploy script
---

## 🧪 ZK Circuit

**Constraints verified per transaction:**
- `commitment = Poseidon(masterKey, sessionAddr, nonce)`
- `merkleRoot` matches whitelisted contract tree
- `currentTime < expiry`
- `spentSoFar + txValue ≤ spendLimit`
- Merkle inclusion proof (depth 4, 16 leaves)

---

## 📜 License

MIT — Built for the Web3 gaming ecosystem.
