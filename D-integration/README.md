# SC6113 Freelancer Milestone Payment DApp

This is the integrated B/C/D handoff package for Member E. It contains B's Solidity/Hardhat contracts, C's TypeScript REST API and SQLite verification layer, and D's React/Vite/MetaMask frontend.

The application uses a hybrid architecture: MetaMask sends every financial state change to the contracts; after the transaction is mined, the frontend submits its hash and off-chain text to the backend for receipt verification and SQLite recording. The backend never stores wallet private keys or sends transactions for users.

## Repository contents

```text
SC6113-C-Completed/
├─ contracts/                 Solidity contracts, tests, deploy script, ABI and contract docs
├─ backend/                   TypeScript REST API, SQLite initialization, tests and OpenAPI docs
├─ frontend/                  React/Vite MetaMask application
├─ INTEGRATION_REPORT.md      B/C/D integration record
├─ HANDOFF_CHECKLIST.md       Member E handoff and reset checklist
└─ README.md                  This zero-to-local setup guide
```

## Prerequisites

- Node.js (the backend requires Node.js 24 or later)
- npm (contracts and frontend)
- pnpm (backend)
- MetaMask browser extension

Use four terminals. The commands below assume the current directory is this repository root.

## Local setup (PowerShell)

### 1. Install contract dependencies

```powershell
cd .\contracts
npm ci
```

If a package lock cannot be used in your environment, use `npm install` instead.

### 2. Start a fresh Hardhat local chain

Keep this terminal open:

```powershell
npm run node
```

### 3. Deploy contracts and seed only the local demo roles

Open a second terminal:

```powershell
cd <repository-root>\contracts
$env:SEED_DEMO='true'
npm run deploy:localhost
```

This creates a new `contracts/deployments/localhost.json` and refreshes the ABI files in `contracts/deployments/abi/`. It assigns Hardhat account #1 as Client, #2 as Freelancer, and #3 as Arbitrator. These are local test wallets only; never use them or their keys with real funds.

### 4. Verify and copy the current contract addresses

Read the three addresses from `contracts/deployments/localhost.json`. Copy them into both `backend/.env` and `frontend/.env` if they differ from the local defaults in the example files. A localhost deployment file is generated state, not a Sepolia or production deployment record.

### 5. Install and configure the backend

Open a third terminal:

```powershell
cd <repository-root>\backend
pnpm install
Copy-Item .env.example .env
pnpm dev
```

`CHAIN_MODE=evm` and `FRONTEND_ORIGIN=http://localhost:5173` are already set in the example. The backend creates and migrates `data/sc6113.db` automatically; do not copy a database from another developer.

### 6. Verify the backend

Open [http://localhost:3001/health](http://localhost:3001/health). A healthy response confirms the API is listening.

### 7. Install and configure the frontend

Open a fourth terminal:

```powershell
cd <repository-root>\frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Open the URL Vite prints, normally [http://localhost:5173](http://localhost:5173). If port 5173 is occupied, stop the conflicting process or run Vite on another port and change `FRONTEND_ORIGIN` in `backend/.env` to that exact origin before restarting the backend. The supplied CORS setting and recommended test procedure expect `http://localhost:5173`.

## Windows CMD equivalents

Run the same commands in separate Command Prompt windows, using CMD syntax for environment and file-copy commands:

```cmd
cd contracts
npm ci
npm run node
```

```cmd
cd <repository-root>\contracts
set SEED_DEMO=true
npm run deploy:localhost
```

```cmd
cd <repository-root>\backend
pnpm install
copy .env.example .env
pnpm dev
```

```cmd
cd <repository-root>\frontend
npm ci
copy .env.example .env
npm run dev
```

## MetaMask local setup

Add a network with these values:

| Setting | Value |
|---|---|
| Network RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` (`0x7a69`) |
| Currency symbol | `ETH` |

Import or select the Hardhat accounts printed by `npm run node`:

| Local role after `SEED_DEMO=true` | Hardhat account |
|---|---|
| Client | #1 |
| Freelancer | #2 |
| Arbitrator | #3 |

**LOCAL DEVELOPMENT ONLY — DO NOT USE WITH REAL FUNDS.** The frontend login first requests a backend nonce and then signs that message in MetaMask. The login signature is not a blockchain transaction and uses no gas.

## Hardhat restart and local reset

Hardhat local state disappears when its node is stopped. After every restart, deploy again with `SEED_DEMO=true`, then confirm the newly generated `localhost.json` and update both `.env` files before starting/restarting the backend and frontend. The checked-in ABI files are formal interface files; `contracts/deployments/localhost.json` and demo transaction receipts are intentionally ignored because they are regenerated local state.

To remove only local backend smoke-test data, stop the backend and delete `backend/data/sc6113.db`, `backend/data/sc6113.db-wal`, and `backend/data/sc6113.db-shm`; then restart the backend. Do not run this against any database you need to preserve. The schema is created automatically. See [HANDOFF_CHECKLIST.md](HANDOFF_CHECKLIST.md) for the full safe reset order and the current demo-seed note.

If Hardhat was restarted but MetaMask activity or nonces clearly refer to the prior local chain, clear MetaMask's local activity/nonce data (or reset its account activity for this local network), reconnect, and retry. Do not infer an application transaction bug from stale MetaMask local cache alone.

## Tests and checks

Run these from their respective module folders:

```powershell
cd contracts
npm test

cd ..\backend
pnpm typecheck
pnpm test

cd ..\frontend
npm run build
```

The backend has no separate lint script and the frontend currently has no separate lint or test script. An optional live B/C receipt-verification test is documented in [backend/README.md](backend/README.md); it requires a running local Hardhat node and a newly seeded deployment.

## GitHub handoff rules

Commit source code, tests, lockfiles, ABI files, deployment scripts, documentation, `.env.example` files, `INTEGRATION_REPORT.md`, and `HANDOFF_CHECKLIST.md`. Do not commit real `.env` files, `node_modules`, build output, Hardhat cache/artifacts, the runtime SQLite database/WAL/SHM, logs, private keys, or generated local deployment receipts. The root `.gitignore` enforces these rules.

For exact REST routes, hash shapes, and contract/API mapping, read [backend/docs/B-C-INTEGRATION.md](backend/docs/B-C-INTEGRATION.md) and [backend/docs/openapi.yaml](backend/docs/openapi.yaml). For the prior integration scope and executed checks, read [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md).
