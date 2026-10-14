# Member E Handoff Checklist

## 1. Current Integrated Components

- **Contracts:** Member B's `RoleManager`, `ProjectEscrow`, and `DisputeManager`, with Hardhat tests, deploy script, ABI, and deployment documentation.
- **Backend:** Member C's TypeScript REST API, nonce/signature authentication, receipt verification, event handling, and automatic SQLite schema initialization.
- **Database:** a local SQLite runtime database at `backend/data/sc6113.db`; it is not a committed deliverable.
- **Frontend:** Member D's React/Vite/MetaMask UI using the real REST API and the official contract ABI.

## 2. D Smoke Test Results

The following was manually confirmed locally by D:

- project startup (Hardhat, backend, and frontend), Client wallet login, and on-chain role recognition;
- dashboard reads real backend data;
- Create Project follows MetaMask -> mined receipt -> backend receipt verification -> SQLite;
- decimal ETH values and multiple milestones, including total `0.01` ETH with milestones `0.003` and `0.007` ETH;
- Projects, Transaction History, and Event Logs show the real recorded transaction/event data.

The following still needs formal testing by E:

- Freelancer Accept; Client Fund; Start Milestone; Submit/Resubmit; Approve; Reject; and payment release;
- dispute raising, evidence submission, and Arbitrator resolution;
- role/permission negative cases, wallet connection/transaction rejection, and wrong-network behavior;
- full Client/Freelancer/Arbitrator end-to-end scenarios and formal integration report;
- deployment, public URL, and public-network validation.

## 3. Local Environment Reset

Do this only when a clean local test environment is wanted. It intentionally removes local-chain and/or SQLite test state.

1. Stop the backend and Hardhat node.
2. Start a new Hardhat node in `contracts` with `npm run node`.
3. In another terminal run `$env:SEED_DEMO='true'; npm run deploy:localhost` (CMD: `set SEED_DEMO=true` then `npm run deploy:localhost`). This regenerates `contracts/deployments/localhost.json` and the ABI outputs.
4. Compare its three addresses with `backend/.env` and `frontend/.env`; update both files and restart their processes if needed.
5. For a clean SQLite runtime database, remove only `backend/data/sc6113.db`, `backend/data/sc6113.db-wal`, and `backend/data/sc6113.db-shm`, then start the backend. Never remove a database that contains data you need.

The backend creates/migrates the schema when the database file is absent. Its current startup code also invokes the built-in `seedDemoData` helper when no project exists; therefore a fresh database is free of D's smoke-test transactions but may contain the fixed demo record `P-1001`. It is not evidence of a deployed chain project and should not be used as an end-to-end verification result.

## 4. MetaMask Setup

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337` / `0x7a69`
- Currency: `ETH`
- With `SEED_DEMO=true`: Hardhat account #1 is Client, #2 Freelancer, and #3 Arbitrator.

These are **LOCAL DEVELOPMENT ONLY** accounts. Do not use them, their displayed keys, or local test ETH with real funds.

## 5. Known Local Testing Notes

- A Hardhat restart erases all chain state, so deployment and contract-address checks must be repeated.
- `contracts/deployments/localhost.json` is a generated local receipt/config file. It is ignored by Git and must never be treated as a Sepolia or production deployment.
- After restarting Hardhat on the same Chain ID, MetaMask can retain prior local activity/nonce cache. If displayed activity clearly disagrees with the fresh chain, clear/reset MetaMask's local activity/nonce data, reconnect, then retry before diagnosing the application transaction logic.
- Existing database files in the working directory contain local runtime data. They are ignored, not deleted by this handoff cleanup.

## 6. Commands E Should Run

```powershell
# terminal 1
cd contracts; npm ci; npm run node

# terminal 2
cd <repository-root>\contracts
$env:SEED_DEMO='true'
npm run deploy:localhost

# terminal 3
cd <repository-root>\backend
pnpm install
Copy-Item .env.example .env
pnpm dev

# terminal 4
cd <repository-root>\frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Visit `http://localhost:3001/health`, then open Vite's normal URL `http://localhost:5173`. If Vite uses another port, set `FRONTEND_ORIGIN` in `backend/.env` to exactly that origin and restart the backend.

## 7. Expected Baseline Tests

```powershell
cd contracts; npm test
cd ..\backend; pnpm typecheck; pnpm test
cd ..\frontend; npm run build
```

The recorded baseline is 32 contract tests, 2 backend API tests, and a successful frontend production build. Run the commands in the checked-out environment; do not treat an old report as a substitute for current results.

## 8. Files That Must Not Be Committed

- `**/.env` (keep `**/.env.example`)
- `**/node_modules/`, `backend/dist/`, `frontend/dist/`, `contracts/artifacts/`, `contracts/cache/`, and coverage output
- `backend/data/*.db`, `*.db-wal`, `*.db-shm`
- `contracts/deployments/localhost.json` and `localhost-demo-transactions.json`
- logs, editor/OS files, private keys, keystores, and secrets

The source, tests, ABI files, deploy script, README/docs, requirements, `INTEGRATION_REPORT.md`, and this checklist must remain committed.

## 9. Remaining E Tasks

- Execute formal integration and full scenario testing.
- Test all role/permission and wallet/network error paths.
- Decide the final deployment target, deploy it, update addresses/configuration, and publish the public URL.
- Produce the final test/deployment report.
