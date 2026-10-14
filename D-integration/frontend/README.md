# SC6113 Freelancer Milestone Payment Frontend

This is the integrated Member D Vite/React frontend. It is a real EVM client: users sign in through C's nonce/signature API, send all financial state changes through MetaMask to B's contracts, then submit the mined transaction hash to C for verification and off-chain recording.

## Start

1. Start the local Hardhat node and deploy contracts with `SEED_DEMO=true` from `../contracts`.
2. Start C's backend in EVM mode from `../backend`.
3. Copy `.env.example` to `.env` and refresh the contract addresses from `../contracts/deployments/localhost.json` if they changed.
4. Run `npm ci` and `npm run dev`.
5. Open the displayed Vite URL (normally `http://localhost:5173`).

MetaMask must use `http://127.0.0.1:8545`, chain `31337` (`0x7a69`). With the seeded deployment, Hardhat account #1 is Client, #2 Freelancer, and #3 Arbitrator.

## Safety and data rules

- ETH input values remain strings and are converted through `ethers.parseEther`.
- All content hashes use `keccak256(toUtf8Bytes(JSON.stringify(value)))` with C's required property order.
- Dates are converted to Unix seconds at UTC midnight.
- Local REST IDs (`P-*`, `M-*`, `D-*`) are never used as contract IDs. The backend-provided `chainProjectId`, `chainMilestoneId` and `chainDisputeId` are used for contract calls.
- Switching MetaMask account or network clears the saved Bearer token.
- A rejected/reverted transaction never triggers a REST write. Confirmation and backend verification are displayed as separate transaction stages.

Run `npm run build` for the production compile.
