# SC6113 Group Project Report — Integration Testing, Deployment & Final Integration (Member E)

Project: Freelancer Milestone Payment DApp
Repository: GitHub `Rito520/SC6113`　Branch: `D-integration` (baseline commit `a0bcad1`)
Report date: 2026-10-15　Author: Member E (responsible for integration testing, system testing, deployment and final integration)

**Team split**: Member A — requirements & functional specification; Member B — smart contracts; Member C — backend API & on-chain receipt verification; Member D — frontend & wallet integration; Member E (author) — integration testing, system testing, deployment and final integration.

---

# Part 1　System Architecture

## 1.1 Architecture Diagram

![SC6113 system architecture](docs/E-architecture.png)

The numbered arrows 1–6 follow the "Data flow" legend at the bottom of the diagram; the red box at the bottom right marks the integration-test findings (see Part 2, §2.4, E-01).

## 1.2 Components & Responsibilities

| Component | Stack | Responsibility |
|---|---|---|
| Frontend (D) | React + TypeScript + Vite + wagmi/viem | Workspaces for the three roles; MetaMask connection; builds the canonical JSON locally and computes its hash; sends on-chain transactions; submits the transaction receipt plus the off-chain payload to the backend for recording |
| Backend (C) | Node.js + TypeScript + Express + SQLite (`node:sqlite`) | SIWE-style signature auth with on-chain role checks; REST API; verifies every transaction against its on-chain receipt (sender, target contract, function arguments, value, confirmations); writes to the database only after verification passes; audit tables (transactions / events / evidence / disputes) |
| Smart contracts (B) | Solidity 0.8.24 + Hardhat | `RoleManager` (on-chain role registration), `ProjectEscrow` (escrow & milestone-payment state machine), `DisputeManager` (dispute resolution & refunds); 32 unit tests |
| Local blockchain | Hardhat Network (chainId 31337) | Demo & test environment; instant mining |

## 1.3 Core Data Flow (one typical operation)

1. The user fills in a web form → the frontend assembles the canonical JSON and computes its `keccak256` hash;
2. The user signs via MetaMask and the transaction is sent to the on-chain contract;
3. The frontend submits "transaction hash + off-chain payload" to the backend REST API;
4. The backend fetches the on-chain receipt and verifies sender wallet, target contract, function arguments, value and confirmations;
5. Only after verification passes does it write to SQLite (transaction table, event table, project/milestone/dispute state);
6. The frontend reads backend data to render the UI and audit pages.

This "on-chain first, verify, then persist" design guarantees that every database record is backed by a corresponding on-chain transaction.

## 1.4 Roles & Permissions

The three roles (Client / Freelancer / Arbitrator) must each be registered in the on-chain `RoleManager` before they can log in (the backend checks on-chain roles at login). The permission matrix is enforced twice — by contract `requireRole` and by backend `requireRoles`: e.g. only a Client can create and fund a project, only a Freelancer can submit a milestone, only an Arbitrator can resolve a dispute. Unauthorized actions revert at the contract level and return 403 at the backend level.

---

# Part 2　Test Report

Test environment: Windows 11 / Node v22.14.0 / pnpm 12.11.2 / Hardhat local chain (chainId 31337)
Test script: `backend/e2e/e2e-integration.mjs` (written by Member E; machine-readable results in `backend/e2e/e2e-results.json`)

## 2.1 Summary of Results

| Level | Result |
|---|---|
| B — contract unit tests | **32/32 passed** |
| C — backend API tests | **2/2 passed** |
| C — backend real-receipt integration test (`RUN_EVM_INTEGRATION=true`) | **1/1 passed** |
| D — frontend production build | **Success** (194 modules, no type errors) |
| E — end-to-end integration tests (real chain + real backend, 17 cases) | **17/17 passed** |

On the local Hardhat + SQLite + MetaMask-compatible flow the system is **functionally correct, permission-correct, and receipt verification works**. Five issues were found (§2.4): one frontend defect (E-04) was fixed by E and re-tested to green, one is recommended to fix before deployment (E-01), and the rest are environment-operation items and a documentation gap — none blocks the local demo.

## 2.2 Baseline Tests

```powershell
cd contracts; npm test                      # 32 passing
cd ..\backend; pnpm typecheck; pnpm test    # 2 pass (+1 skipped integration test)
$env:RUN_EVM_INTEGRATION='true'; pnpm test  # 3 pass (incl. real-receipt integration test)
cd ..\frontend; npm run build               # ✓ built
```

The real-receipt integration test reads `RoleManager.rolesOf` and checks the acceptProject receipt for sender wallet / target contract / function arguments / `ProjectAccepted` event — all pass, proving the contract-to-backend connection holds on a real chain.

## 2.3 End-to-End Integration Tests (17 cases, all passed)

Method: the test script replicates exactly how the frontend calls the system — same contract functions, same canonical hash `keccak256(JSON.stringify(…))`, same REST request bodies — and verifies the full "MetaMask transaction → receipt verification → SQLite record" chain under `CHAIN_MODE=evm`. Permission negative cases use `staticCall` simulation (zero gas, zero on-chain side effects).

| Case | Coverage | Result |
|---|---|---|
| ENV-01 | Backend health=evm, RPC chainId=31337 | PASS |
| AUTH-01 | All three roles log in via nonce+signature; `/api/me` returns correct on-chain roles | PASS |
| AUTH-02 | Unregistered wallet rejected at nonce stage (403) | PASS |
| AUTH-03 | Tampered signature rejected (401) | PASS |
| A-01 | Client creates project on-chain → backend verifies receipt and persists (2 milestones, 0.01 ETH) | PASS |
| A-02 | Non-mined hash rejected (409 TRANSACTION_NOT_MINED) | PASS |
| A-03 | Freelancer accepts → Client funds → ACTIVE; on-chain escrow balance = 0.01 ETH | PASS |
| A-04 | Unauthorized actions (freelancer funds / freelancer creates / client starts milestone) all rejected | PASS |
| A-05 | Milestone 1: start → submit → approve, status APPROVED | PASS |
| A-06 | Milestone 2: submit → approve, project COMPLETED, escrow drained to zero, freelancer balance increased | PASS |
| A-07 | Audit tables: ≥8 transaction records + 5 event types persisted correctly | PASS |
| NEG-01 | On-chain hash ≠ REST payload hash → 422 rejection, nothing written to DB | PASS |
| B-01 | Dispute project: create → accept → fund | PASS |
| B-02 | submit → reject → resubmit → freelancer raiseDispute, project DISPUTED | PASS |
| B-03 | Dispute listing, evidence submission, non-party operations rejected | PASS |
| B-04 | Non-arbitrator gets 403; arbitrator resolve → RESOLVED, project back to ACTIVE | PASS |
| C-01 | Cancel a not-yet-started project → CANCELLED, on-chain state consistent | PASS |

Coverage notes — covered: full payment happy path, reject-resubmit, dispute-evidence-resolution, cancel-refund, negative cases for roles/signatures/hashes, audit and event persistence. Not covered: the 7-day silent-period self-claim `claimAfterReview` and pause administration paths (require time travel; covered by contract unit tests); real-browser MetaMask pop-up interaction (covered by the demo presentation; step-by-step guide in `E-DEMO-GUIDE.md`).

## 2.4 Findings

**E-01 (fix recommended before deployment) Timing window in backend confirmation check.** `EvmBlockchainGateway.verifyAction` computes confirmations with a default-polling (~4 s) provider; under Hardhat instant mining, a receipt submitted immediately after mining returns `409 INSUFFICIENT_CONFIRMATIONS`, and succeeds on retry 2–4 s later. Because verification failure happens before any DB write, retrying is safe with no duplicate records (triggered 18 times in this run; all retries succeeded). Recommendation: use `receipt.waitForConfirmations` or a short wait before deciding.

**E-02 (environment operation) The demo database must be reset with every new chain.** Projects in an old SQLite file occupy the `(chain_id, chain_project_id)` unique index and collide with project IDs on a restarted chain, causing 500 on project creation. The reset procedure (stop backend → move `backend/data/sc6113.db*` away → restart) is verified; see Part 3, §3.2.

**E-03 (documentation gap) The `.env.example` files referenced by the README do not exist in the repo.** Following the README's copy command fails. `backend/.env` was recreated from `config.ts` defaults; committing `.env.example` is recommended.

**E-04 (frontend defect, fixed) Wrong event field name breaks dispute resolution and evidence submission.** In `frontend/src/services/api/index.ts`, `chainDisputeId` is rebuilt from the `DisputeRaised` event by reading `args.milestoneIndex`, while the contract's event parameter is named `index` — the match always fails, `chainDisputeId` stays empty, and the Disputes page calls `resolveDispute`/`submitEvidence` with id=0, which reverts. Fixed by changing the field to `args.index`; the full dispute flow (including arbitrator RESOLVED) was re-tested and passes. **This fix must be committed with the branch.**

**E-05 (minor frontend defect, fix recommended) First load after a full page refresh on the project detail page returns 401.** When `/projects/:id` is loaded via a hard refresh, the page's data-loading effect runs before the session provider restores the token (React child effects run before parent effects), so the first request is sent without a token → 401; a second navigation recovers. In-SPA click navigation is unaffected. Recommendation: defer detail-page loading until the session is ready.

**Design notes (not defects)**: `GET /api/disputes` does not return `chainDisputeId`; the frontend and this test script both parse it from the `DisputeRaised` event/receipt (consistent with D's implementation). When receipt verification rejects a record, the on-chain and database states intentionally diverge (the chain event happened; the DB does not record it), converging via subsequent business actions.

## 2.5 Reproduction

```powershell
# Terminal 1: contracts → npm run node
# Terminal 2: contracts → $env:SEED_DEMO='true'; npm run deploy:localhost
# Terminal 3: backend  → pnpm start (requires .env first, see E-03)
# Terminal 4: backend  → node e2e/e2e-integration.mjs
```

---

# Part 3　Deployment Guide

## 3.1 Final Runtime Environment (local demo)

| Service | Address | Status |
|---|---|---|
| Hardhat local chain | http://127.0.0.1:8546 (chainId 31337) | Running |
| Backend REST API | http://localhost:3001 (`CHAIN_MODE=evm`) | Running |
| Frontend (Vite) | http://localhost:5173 | Running |

Contract addresses (deterministic first deployment on localhost): RoleManager `0x5FbDB2315678afecb367f032d93F642f64180aa3`, ProjectEscrow `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, DisputeManager `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`.

Demo roles (local testing only — never use with real funds): Hardhat accounts #1 = Client, #2 = Freelancer, #3 = Arbitrator (roles registered on-chain automatically when deploying with `SEED_DEMO=true`).

## 3.2 Reproducing the Local Environment from Scratch (four terminals)

Prerequisites: Node.js ≥ 22, npm, pnpm (`npm i -g pnpm`), MetaMask extension.

```powershell
# Terminal 1: local chain
cd D-integration\contracts
npm ci
npm run node

# Terminal 2: deploy + seed roles (must redo after every chain restart)
cd D-integration\contracts
$env:SEED_DEMO='true'
npm run deploy:localhost        # generates deployments/localhost.json and abi/

# Terminal 3: backend
cd D-integration\backend
pnpm install
# The repo lacks .env.example (see E-03); create backend\.env manually:
#   CHAIN_MODE=evm
#   PORT=3001
#   FRONTEND_ORIGIN=http://localhost:5173
#   RPC_URL=http://127.0.0.1:8546
#   CHAIN_ID=31337
#   CHAIN_CONFIRMATIONS=0
#   ROLE_MANAGER_ADDRESS / PROJECT_ESCROW_ADDRESS / DISPUTE_MANAGER_ADDRESS
#   (from deployments/localhost.json; identical to §3.1 for the first deployment)
pnpm start                      # prefer start (no watch) for demos; watch restarts interrupt long flows

# Terminal 4: frontend
cd D-integration\frontend
npm ci
npm run dev                     # frontend reads the committed localhost.json; no .env needed
```

Verify: `http://localhost:3001/health` returns `{"status":"ok","chainMode":"evm"}`; open `http://localhost:5173` in a browser.

MetaMask setup: add a network (RPC `http://127.0.0.1:8546`, Chain ID `31337`, symbol ETH) and switch to it; import the #1/#2/#3 private keys printed by Hardhat on startup. If MetaMask shows nonce issues after a chain restart: clear activity data for the network (Settings → Advanced → Clear activity tab data) and reconnect.
> Port note: the repo and README originally defaulted to 8545; because port 8545 on the demo machine is occupied by another tool (Ganache), the project now uses 8546 everywhere (`contracts/package.json`, `hardhat.config.js`, `backend/.env`, MetaMask network config). On other machines keep all four places consistent.

**Reset procedure (for clean demo data)**: stop backend and chain → restart `npm run node` → redeploy with `SEED_DEMO` → confirm `localhost.json` and `.env` addresses match → move `backend/data/sc6113.db*` away (rename; do not delete) → start the backend. The old database must be reset with every new chain, otherwise the E-02 unique-index conflict occurs.

## 3.3 Sepolia Testnet Deployment Plan (optional)

`hardhat.config.js` already includes a sepolia network (reads env vars `SEPOLIA_RPC_URL`, `PRIVATE_KEY`):

1. **Prepare**: a public RPC (Alchemy/Infura free tier is fine), a dedicated deployer wallet private key, some SepoliaETH (from a faucet), optionally an Etherscan API key for contract verification.
2. **Deploy**:
   ```powershell
   cd contracts
   $env:SEPOLIA_RPC_URL='https://…'; $env:PRIVATE_KEY='0x…'   # never commit
   npx hardhat run scripts/deploy.js --network sepolia         # without SEED_DEMO
   ```
   Roles are then registered by the real demo wallets themselves via `registerAsClient/registerAsFreelancer`; the arbitrator role is granted by the deployer via `grantRole`.
3. **Configure**: write the three new contract addresses into `backend/.env` (`RPC_URL` → public RPC, `CHAIN_ID=11155111`, `CHAIN_CONFIRMATIONS` ≥ 2 recommended); update the frontend address configuration; set `FRONTEND_ORIGIN` to the frontend's public domain.
4. **Backend hosting**: single-node SQLite suits demos only; multi-instance deployments need a hosted database plus formal migrations; restrict CORS to the frontend domain.
5. **Frontend hosting**: static hosting of the `npm run build` output on Vercel/Netlify/GitHub Pages.
6. **Acceptance**: `/health` shows evm with the correct chainId; run create→fund→submit→approve with test wallets; contracts and events visible on Etherscan.

Note: `.env`, private keys and `deployments/localhost.json` must never be committed; a Sepolia deployment record may be saved separately as `deployments/sepolia.json` and committed (it is a formal deployment record, unlike localhost artifacts).

## 3.4 Commit Rules (following the repo .gitignore)

Commit: source code, tests, lockfiles, ABIs, deployment scripts, docs, `.env.example` (recommended), this report.
Do not commit: real `.env`, node_modules, dist, artifacts/cache, `backend/data/*.db*`, localhost deployment artifacts and demo receipts, logs and private keys.

---

# Appendix　Deliverables Checklist (Member E)

| Deliverable | File |
|---|---|
| Architecture diagram (vector / bitmap) | `docs/E-architecture.svg`, `docs/E-architecture.png` |
| Test report | Part 2 of this report (standalone: `E-TEST-REPORT.md`) |
| Deployment guide | Part 3 of this report (standalone: `E-DEPLOYMENT.md`) |
| End-to-end integration test script | `backend/e2e/e2e-integration.mjs` (+ `e2e-results.json`) |
| Demo operation guide (with 17 UI screenshots) | `E-DEMO-GUIDE.md`, `docs/shots/` |
| This report | `E-FINAL-REPORT.md` (Chinese), `E-FINAL-REPORT-EN.md` (English) |
