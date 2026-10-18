# SC6113 部署说明（Member E：部署与最终集成）

本次最终运行环境 = **本地演示环境**（Hardhat 本地链 + 本机后端/前端），已跑通并保持可用；
同时给出 **Sepolia 测试网**的完整部署方案供组内选择。所有步骤已在 2026-10-15 于 Windows 11 / Node 22 实测。

## 1. 当前本地运行环境（最终运行环境）

| 服务 | 地址 | 状态 |
|---|---|---|
| Hardhat 本地链 | http://127.0.0.1:8546（chainId 31337） | 运行中 |
| C 后端 REST API | http://localhost:3001（`CHAIN_MODE=evm`） | 运行中 |
| D 前端 Vite | http://localhost:5173 | 运行中 |
| 合约地址（localhost 首次部署） | RoleManager `0x5FbDB2315678afecb367f032d93F642f64180aa3`；ProjectEscrow `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`；DisputeManager `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | 已播种角色 |

演示角色（仅本地测试，勿用于真实资金）：Hardhat 账户 #1=Client、#2=Freelancer、#3=Arbitrator。

## 2. 从零复现本地环境（四终端）

前置：Node.js ≥ 22（后端用到 `node:sqlite`，README 写 24+ 为保守值，实测 22.14 可用）、npm、pnpm（`npm i -g pnpm`）、MetaMask 扩展。

```powershell
# 终端 1：本地链
cd D-integration\contracts
npm ci
npm run node

# 终端 2：部署 + 播种角色（每次重启链后必须重做）
cd D-integration\contracts
$env:SEED_DEMO='true'
npm run deploy:localhost        # 生成 deployments/localhost.json 与 abi/

# 终端 3：后端
cd D-integration\backend
pnpm install
# 注意：仓库缺 .env.example（见测试报告 E-03）。手工创建 backend\.env：
#   CHAIN_MODE=evm
#   PORT=3001
#   FRONTEND_ORIGIN=http://localhost:5173
#   RPC_URL=http://127.0.0.1:8546
#   CHAIN_ID=31337
#   CHAIN_CONFIRMATIONS=0
#   ROLE_MANAGER_ADDRESS=…  PROJECT_ESCROW_ADDRESS=…  DISPUTE_MANAGER_ADDRESS=…
#   （三个地址取自 deployments/localhost.json；首次部署与上表默认值相同）
pnpm start                      # 演示建议用 start（无 watch）；dev 的 --watch 会在 e2e 文件落盘时自重启打断长流程

# 终端 4：前端
cd D-integration\frontend
npm ci
npm run dev                     # 前端直接 import 仓库内 localhost.json 作为地址默认值，无需 .env
```

验证：`http://localhost:3001/health` 返回 `{"status":"ok","chainMode":"evm"}`；打开 `http://localhost:5173`。

MetaMask 本地网络：RPC `http://127.0.0.1:8546`、Chain ID `31337`、符号 ETH；导入 Hardhat 打印的 #1/#2/#3 私钥（仅本地）。
> 端口说明：仓库默认与 README 原为 8545；因演示机 8545 被其他工具占用，本项目已整体改为 **8546**（`contracts/package.json` 的 `node` 脚本、`hardhat.config.js` 的 localhost URL、`backend/.env`、以及 MetaMask 网络配置均已同步）。在别的机器复现时若 8545 空闲，可保持 8546 或改回 8545，四处保持一致即可。
若重启过链而 MetaMask 活动/nonce 显示异常：清 MetaMask 该网络的活动数据后重连（队友提示已验证有效）。

**重置流程（换干净演示数据时）**：停后端与链 → 重启 `npm run node` → 重新 `SEED_DEMO` 部署 → 核对 `localhost.json` 与 `.env` 地址 → 移走（勿直接删）`backend/data/sc6113.db*` → 启动后端。旧库必须随新链重置，否则 `(chain_id, chain_project_id)` 唯一索引冲突导致创建项目 500（测试报告 E-02）。

## 3. Sepolia 测试网部署方案（组内可选）

hardhat.config.js 已内置 sepolia 网络（需环境变量 `SEPOLIA_RPC_URL`、`PRIVATE_KEY`）：

1. 准备：公开 RPC（Alchemy/Infura 免费档即可）、一个**专用部署钱包**私钥与少量 SepoliaETH（ faucet 领取）、可选 Etherscan key 做验证。
2. 部署：
   ```powershell
   cd contracts
   $env:SEPOLIA_RPC_URL='https://…'; $env:PRIVATE_KEY='0x…'   # 勿提交
   npx hardhat run scripts/deploy.js --network sepolia         # 不要带 SEED_DEMO
   ```
   角色改由真实演示钱包各自调用 `registerAsClient/registerAsFreelancer`，仲裁员由部署钱包 `grantRole`。
3. 配置：把三个新地址写入 `backend/.env`（`RPC_URL` 改公开 RPC、`CHAIN_ID=11155111`、`CHAIN_CONFIRMATIONS` 建议 ≥2）与前端 `VITE_*` 变量或更新 `frontend/src/contracts/localhost.json` 的替代配置；`FRONTEND_ORIGIN` 设为前端公网域名。
4. 后端托管：单机 SQLite 仅适合演示；多实例需换托管数据库（Neon/Supabase/云 SQLite 卷）并补正式 migration。CORS 只放行前端域名。
5. 前端托管：Vercel/Netlify/GitHub Pages 静态托管 `npm run build` 产物。
6. 验收：`/health` 显示 evm 且 chainId 正确；用测试钱包走一遍创建→注资→提交→审批；Etherscan 可见合约与事件。

注意：`.env`、私钥、`deployments/localhost.json` 均不得提交；Sepolia 部署记录如需留存可另存 `deployments/sepolia.json` 并提交（属正式部署记录，区别于 localhost 生成物）。

## 4. 提交规则（沿用仓库 .gitignore）

提交：源码、测试、lockfile、ABI、部署脚本、文档、`.env.example`（建议补）、报告。
不提交：真实 `.env`、node_modules、dist、artifacts/cache、`backend/data/*.db*`、localhost 部署与演示回执、日志与私钥。
