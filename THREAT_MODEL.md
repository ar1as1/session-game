# Threat Model — session-game

> ZK session keys for Web3 gaming. This states what the system guarantees, where the drains that
> hit "audited giants" actually come from, and the architectural choices that remove those surfaces
> here. Every claim marked PROVEN is reproducible with the scripts at the bottom. No attack here is
> hypothetical — findings are real or explicitly stated as not-found.

## Core thesis

Audits verify *code as written*. The daily nine-figure drains do not come from "unaudited code" —
they come from **design assumptions, off-chain keys, and surface that audits don't cover**.
session-game is drain-resistant less because of a clever trick and more because of what it **refuses
to have**: no pooled funds, no admin, no oracle, no governance, no upgradeability. There is
structurally very little to drain.

## Drain taxonomy vs session-game

| # | Attack class (where giants fall) | How the drain works | session-game defense | Status |
|---|---|---|---|---|
| 1 | **Access control / key compromise** | Privileged fn (mint/upgrade/withdraw/setOwner) hijacked via missing check, uninitialized proxy, or leaked admin key. Gonka: BLS key -> mint 22M. | **Ownerless + immutable.** No owner/admin/upgrade/mint/withdraw. `createSession`/`revokeSession` scoped to `msg.sender`. Deployer-key compromise grants nothing. | OK IMMUNE (no privileged fn) · one gap: `validateUserOp` lacks `onlyEntryPoint` -> grief only (see C) |
| 2 | **Concentrated TVL (bridges/vaults)** | One contract holds huge locked value + off-chain trust. zkLink/Ankr/AFX bridges. | **No pooled funds — the validator holds ZERO value.** Each gamer's funds stay in their own account. Fully compromising the validator drains nothing; no honeypot. | OK IMMUNE (no central TVL) |
| 3 | **Oracle manipulation (flash-loan)** | Skew an AMM price the protocol trusts -> borrow/mint on inflated value. KelpDAO/ACryptoS vaults. | **No oracle, no price dependency.** `spendLimit` is a fixed wei amount set by the gamer, not a derived price. Nothing to manipulate. | OK IMMUNE (no price input) |
| 4 | **Governance capture** | Flash-loan votes -> pass malicious proposal -> drain treasury. Term Labs $8.5M. | **No governance, no token, no DAO.** Contract is immutable. Nothing to capture. | OK IMMUNE (no governance) |
| 5 | **Logic / economic math** | Share inflation, rounding, donation, fee-on-transfer assumptions. | **Minimal economic surface.** Validator holds/transfers no tokens; only accounting is `spentSoFar + txValue <= spendLimit` (Solidity 0.8 overflow-safe). | MOSTLY IMMUNE · gaps: `_extractTargetValue` fixed-offset (batch-account evasion, conditional) + `uint208(spendLimit)` no bound-check (LOW) |
| 6 | **Reentrancy** | External call before state update -> re-enter -> double-spend. | **No reentrancy surface.** `validateUserOp` transfers no value; `verifier.verifyProof` is a staticcall. Validate-only. | OK IMMUNE |
| 7 | **Off-chain key exposure** | Leaked/phished keys, compromised frontend/CI. The #1 real-world cause. | **Decentralized keys** (each gamer holds their own — no single key drains all) + **capped blast radius**: a leaked *session* key spends at most `spendLimit` to allowlisted contracts, enforced cryptographically (A'/B). | CAPPED by design (not eliminated) |

## Blast radius — worst case, PROVEN

If a session key is fully stolen from the browser, the attacker still **cannot**:
- redirect spend to their own contract -> blocked by **A'** (`pub[4] == actual target`) -> `SK_InvalidZKProof`
- forge the session's identity -> blocked by **B** (`pub[0] == s.commitment`) -> `SK_InvalidZKProof`
- exceed the cap -> `SK_SpendExceeded`

Maximum loss from a fully-compromised session key = **`spendLimit` to allowlisted game contracts only** —
not the wallet, not an attacker contract. Reproduce: `node test_drain.mjs`

## What the ZK actually enforces

- **A'** — session bound to a merkle allowlist of contracts; the proof's `targetContract` (`pub[4]`) must
  equal the contract the UserOp calls. Cannot be swapped. Proven: `test_AB.cjs` (tamper `pub[4]` -> invalid).
- **B** — `commitment = Poseidon(masterKey, sessionAddr, nonce)` stored at `createSession` and checked
  (`pub[0] == s.commitment`). A leaked session key != the master secret. Proven: `test_AB.cjs` (tamper `pub[0]` -> invalid).

## Known limitations (stated, not hidden)

1. **C [access control, grief]** — `validateUserOp` is `external` with no `onlyEntryPoint` and no per-UserOp
   replay guard. Anyone can replay a captured valid UserOp directly to inflate `spentSoFar` and exhaust a
   gamer's session (denial-of-service). **No funds move.** Fix: `immutable entryPoint` + `onlyEntryPoint`.
   Proven: `test_C.mjs` (spentSoFar 0 -> 0.001 -> 0.002 on replay).
2. **`_extractTargetValue` [conditional]** — reads target/value at fixed calldata offsets assuming
   `execute(address,uint256,bytes)`. A batch-capable account needs an adapter; sound for single-execute.
3. **`uint208(spendLimit)` [LOW]** — truncates `spendLimit` above 2^208 (limit becomes smaller, not larger).
   Add `require(spendLimit <= type(uint208).max)`.
4. **Off-chain** — session keys live in the browser; damage is capped (above) but not eliminated. Master
   keys are the gamer's responsibility; deployer keys rotated before mainnet.

## Reproduce every claim
node test_AB.cjs # circuit binding: tamper pub[4]/pub[0] -> proof invalid
node test_e2e.mjs # on-chain: happy VALID, A’ redirect REVERT, B commitment REVERT
node test_drain.mjs # drain attempts: redirect + over-limit all BLOCKED
node test_C.mjs # grief: non-EntryPoint replay inflates spentSoFar (known gap C)

Validator (Sepolia): 0x5c2736F56506526e76E40D88981E4E41B0FA8807
Verifier (uint[5], Sepolia): run `cast call <validator> "verifier()(address)"`

---
Built by mrZk @ka eGold. Findings are real or stated as not-found — no fabricated attacks.
