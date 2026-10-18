# SC6113 小组作业报告 —— 集成测试、部署与最终整合（成员 E）

项目：Freelancer Milestone Payment DApp（自由职业者里程碑付款系统）
代码仓库：GitHub `Rito520/SC6113`　分支：`D-integration`（基线 commit `a0bcad1`）
报告日期：2026-10-15　撰写：成员 E（负责集成测试、系统测试、部署与最终整合）

**分工背景**：成员 A 负责需求与功能规格，成员 B 负责智能合约，成员 C 负责后端 API 与链上回执核验，成员 D 负责前端与钱包集成，成员 E（本人）负责联调测试、系统测试、部署与最终整合。

---

# 第一部分　系统架构

## 1.1 架构图

![SC6113 系统架构图](docs/E-architecture.png)

图中编号箭头 1-6 的含义见底部 Data flow 图例；右下角红框为集成测试发现的注意点（详见第二部分 §2.4 E-01）。

## 1.2 组件与职责

| 组件 | 技术栈 | 职责 |
|---|---|---|
| 前端（D） | React + TypeScript + Vite + wagmi/viem | 三角色工作台界面；连接 MetaMask；本地组装规范 JSON 并计算哈希；发起链上交易；把交易回执与链下正文提交后端记录 |
| 后端（C） | Node.js + TypeScript + Express + SQLite（`node:sqlite`） | SIWE 风格签名鉴权（链上角色校验）；REST API；对每笔交易做链上回执核验（发送者、目标合约、函数参数哈希、金额、确认数）；核验通过才写入数据库；审计表（交易/事件/证据/争议） |
| 智能合约（B） | Solidity 0.8.24 + Hardhat | `RoleManager`（链上角色注册）、`ProjectEscrow`（项目托管与里程碑付款状态机）、`DisputeManager`（争议裁决与退款），32 项单元测试 |
| 本地区块链 | Hardhat Network（chainId 31337） | 演示与测试环境；instant mining |

## 1.3 核心数据流（一次典型操作）

1. 用户在网页填写表单 → 前端组装规范 JSON 并计算 `keccak256` 哈希；
2. 用户经 MetaMask 签名并把交易发送到链上合约；
3. 前端把「交易哈希 + 链下正文」提交给后端 REST API；
4. 后端到链上取回执，核对发送钱包、目标合约、函数参数、金额与确认数；
5. 核验通过才写入 SQLite（交易表、事件表、项目/里程碑/争议状态）；
6. 前端读取后端数据渲染界面与审计页。

这一「先上链、后核验、再入库」的设计保证数据库中的每条记录都有对应的链上交易支撑。

## 1.4 角色与权限

三个角色（Client / Freelancer / Arbitrator）均须在链上 `RoleManager` 注册后才能登录（后端登录时校验链上角色）。权限矩阵由合约 `requireRole` 与后端 `requireRoles` 双重强制：如仅 Client 可创建项目与注资、仅 Freelancer 可提交里程碑、仅 Arbitrator 可裁决争议。越权操作在合约层 revert，在后端层返回 403。

---

# 第二部分　测试报告

测试环境：Windows 11 / Node v22.14.0 / pnpm 12.11.2 / Hardhat 本地链（chainId 31337）
测试脚本：`backend/e2e/e2e-integration.mjs`（成员 E 编写；机器可读结果 `backend/e2e/e2e-results.json`）

## 2.1 结论摘要

| 层级 | 结果 |
|---|---|
| B 合约单元测试 | **32/32 通过** |
| C 后端 API 测试 | **2/2 通过** |
| C 后端真实回执集成测试（`RUN_EVM_INTEGRATION=true`） | **1/1 通过** |
| D 前端生产构建 | **成功**（194 modules，无类型错误） |
| E 端到端联调测试（真实链 + 真实后端，17 用例） | **17/17 通过** |

系统在本机 Hardhat + SQLite + MetaMask 兼容流程下**功能正确、权限正确、回执核验有效**。共发现 5 个问题（§2.4），其中 1 个前端缺陷（E-04）已由 E 修复并复测通过，1 个建议部署前修复（E-01），其余为环境操作项与文档缺口，均不阻塞本地演示。

## 2.2 基线测试

```powershell
cd contracts; npm test                      # 32 passing
cd ..\backend; pnpm typecheck; pnpm test    # 2 pass（+1 skipped 集成测试）
$env:RUN_EVM_INTEGRATION='true'; pnpm test  # 3 pass（含真实回执集成测试）
cd ..\frontend; npm run build               # ✓ built
```

真实回执集成测试读取 `RoleManager.rolesOf`、核对 acceptProject 回执的发送钱包/目标合约/函数参数/`ProjectAccepted` 事件，全部通过——证明合约与后端在真实链上的连接成立。

## 2.3 端到端联调测试（17 用例，全部通过）

方法：测试脚本完全复刻前端的调用方式——相同合约函数、相同规范哈希 `keccak256(JSON.stringify(…))`、相同 REST 请求体，在 `CHAIN_MODE=evm` 下对「MetaMask 交易 → 回执核验 → SQLite 记录」全链路验证。权限负例用 `staticCall` 模拟（零 gas、零链上副作用）。

| 用例 | 覆盖点 | 结果 |
|---|---|---|
| ENV-01 | 后端 health=evm、RPC chainId=31337 | PASS |
| AUTH-01 | 三角色 nonce+签名登录、`/api/me` 链上角色正确 | PASS |
| AUTH-02 | 未注册钱包 nonce 阶段 403 | PASS |
| AUTH-03 | 篡改签名 401 | PASS |
| A-01 | Client 链上创建项目 → 后端回执核验后入库（2 里程碑、0.01 ETH） | PASS |
| A-02 | 未上链哈希被拒（409 TRANSACTION_NOT_MINED） | PASS |
| A-03 | Freelancer 接受 → Client 注资 → ACTIVE、链上托管余额 = 0.01 ETH | PASS |
| A-04 | 越权操作（乙方注资/乙方建项目/甲方开工）均被合约拒绝 | PASS |
| A-05 | 里程碑 1：start → submit → approve，状态 APPROVED | PASS |
| A-06 | 里程碑 2：submit → approve，项目 COMPLETED、托管清零、乙方余额净增 | PASS |
| A-07 | 审计表：≥8 条交易记录 + 5 类链上事件正确落库 | PASS |
| NEG-01 | 链上哈希 ≠ REST 正文哈希 → 422 拒绝且不写库 | PASS |
| B-01 | 争议项目 create → accept → fund | PASS |
| B-02 | submit → reject → resubmit → 乙方 raiseDispute，项目 DISPUTED | PASS |
| B-03 | 争议列表、证据提交、非当事方操作被拒 | PASS |
| B-04 | 非仲裁员 403；仲裁员 resolve → RESOLVED、项目回 ACTIVE | PASS |
| C-01 | 未开工项目 cancel → CANCELLED、链上状态一致 | PASS |

覆盖说明——已覆盖：正常支付全闭环、拒绝-重提交、争议-证据-裁决、取消退款、角色/签名/哈希等负例、审计与事件落库。未覆盖：7 天静默自助领取 `claimAfterReview` 与 pause 管理路径（需时间旅行，合约单测已覆盖）；真实浏览器 MetaMask 弹窗交互（由 Demo 演示承担，操作指南见 `E-DEMO-GUIDE.md`）。

## 2.4 发现的问题

**E-01（建议部署前修复）后端确认数校验存在时序窗口。** `EvmBlockchainGateway.verifyAction` 用默认轮询（约 4 秒）的 provider 计算确认数；在 Hardhat 瞬时出块下，交易刚挖出即提交核验会返回 `409 INSUFFICIENT_CONFIRMATIONS`，2-4 秒后重试即成功。因核验失败发生在任何写库之前，重试安全、无重复记录（本轮测试共触发 18 次，重试后全部成功）。建议：对该路径改用 `receipt.waitForConfirmations` 或短暂等待后再判定。

**E-02（环境操作项）演示数据库必须随新链重置。** 旧 SQLite 中的项目占用 `(chain_id, chain_project_id)` 唯一索引，与重启后的新链项目 ID 冲突，会导致创建项目 500。重置流程（停后端 → 移走 `backend/data/sc6113.db*` → 重启）已验证有效，见第三部分 §3.2。

**E-03（文档缺口）README 引用的 `.env.example` 在仓库中不存在。** 按 README 执行复制命令会失败。已按 `config.ts` 默认值补建 `backend/.env`；建议把 `.env.example` 提交进仓库。

**E-04（前端缺陷，已修复）争议链上 ID 解析字段名错误，导致仲裁/举证必然失败。** `frontend/src/services/api/index.ts` 从 `DisputeRaised` 事件重建 `chainDisputeId` 时读取 `args.milestoneIndex`，而合约事件参数名为 `index`，匹配永远失败 → 前端以 id=0 调用 `resolveDispute`/`submitEvidence`，合约 revert。已将字段名改为 `args.index`，复测争议全流程（含仲裁 RESOLVED）通过。**该修复需随分支提交。**

**E-05（前端小缺陷，建议修复）项目详情页整页刷新首次加载 401。** 整页刷新直达 `/projects/:id` 时，详情页数据加载先于会话 token 恢复执行，首个请求 401，需再次导航才恢复；SPA 内点击导航不受影响。建议详情页在会话就绪后再发起加载。

**说明项（设计使然，非缺陷）**：`GET /api/disputes` 不返回 `chainDisputeId`，前端从事件解析；回执核验被拒时链上与数据库状态有意保持分叉（链上已发生、库中不记录），由后续业务动作收敛。

## 2.5 复现方式

```powershell
# 终端1：contracts → npm run node
# 终端2：contracts → $env:SEED_DEMO='true'; npm run deploy:localhost
# 终端3：backend  → pnpm start（需先有 .env，见 E-03）
# 终端4：backend  → node e2e/e2e-integration.mjs
```

---

# 第三部分　部署说明

## 3.1 最终运行环境（本地演示环境）

| 服务 | 地址 | 状态 |
|---|---|---|
| Hardhat 本地链 | http://127.0.0.1:8546（chainId 31337） | 运行中 |
| 后端 REST API | http://localhost:3001（`CHAIN_MODE=evm`） | 运行中 |
| 前端（Vite） | http://localhost:5173 | 运行中 |

合约地址（localhost 首次部署的确定性地址）：RoleManager `0x5FbDB2315678afecb367f032d93F642f64180aa3`、ProjectEscrow `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`、DisputeManager `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`。

演示角色（仅本地测试，勿用于真实资金）：Hardhat 账户 #1 = Client、#2 = Freelancer、#3 = Arbitrator（部署时经 `SEED_DEMO=true` 自动在链上注册角色）。

## 3.2 从零复现本地环境（四个终端）

前置：Node.js ≥ 22、npm、pnpm（`npm i -g pnpm`）、MetaMask 扩展。

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
# 仓库缺 .env.example（见 E-03），手工创建 backend\.env：
#   CHAIN_MODE=evm
#   PORT=3001
#   FRONTEND_ORIGIN=http://localhost:5173
#   RPC_URL=http://127.0.0.1:8546
#   CHAIN_ID=31337
#   CHAIN_CONFIRMATIONS=0
#   ROLE_MANAGER_ADDRESS / PROJECT_ESCROW_ADDRESS / DISPUTE_MANAGER_ADDRESS
#   （取自 deployments/localhost.json；首次部署与 §3.1 相同）
pnpm start                      # 演示建议 start（无 watch），避免文件变动触发重启

# 终端 4：前端
cd D-integration\frontend
npm ci
npm run dev                     # 前端直接读仓库内 localhost.json，无需 .env
```

验证：`http://localhost:3001/health` 返回 `{"status":"ok","chainMode":"evm"}`；浏览器打开 `http://localhost:5173`。

MetaMask 配置：添加网络（RPC `http://127.0.0.1:8546`、Chain ID `31337`、符号 ETH）并切换到该网络；导入 Hardhat 启动时打印的 #1/#2/#3 私钥。若重启过链后 MetaMask nonce 异常：清除该网络的活动数据（Settings → Advanced → Clear activity tab data）后重连。
> 端口说明：仓库与 README 原默认 8545；因演示机 8545 被其他工具（Ganache）占用，本项目已整体改为 8546（`contracts/package.json`、`hardhat.config.js`、`backend/.env`、MetaMask 网络配置四处同步）。在其他机器复现时保持四处一致即可。

**重置流程（需要干净演示数据时）**：停后端与链 → 重启 `npm run node` → 重新 `SEED_DEMO` 部署 → 核对 `localhost.json` 与 `.env` 地址一致 → 移走 `backend/data/sc6113.db*`（改名即可，勿直接删除）→ 启动后端。旧库必须随新链重置，否则触发 E-02 的唯一索引冲突。

## 3.3 Sepolia 测试网部署方案（可选）

`hardhat.config.js` 已内置 sepolia 网络（读取环境变量 `SEPOLIA_RPC_URL`、`PRIVATE_KEY`）：

1. **准备**：公开 RPC（Alchemy/Infura 免费档即可）、专用部署钱包私钥、少量 SepoliaETH（faucet 领取）、可选 Etherscan API key（合约验证）。
2. **部署**：
   ```powershell
   cd contracts
   $env:SEPOLIA_RPC_URL='https://…'; $env:PRIVATE_KEY='0x…'   # 勿提交
   npx hardhat run scripts/deploy.js --network sepolia         # 不带 SEED_DEMO
   ```
   角色改由真实演示钱包各自调用 `registerAsClient/registerAsFreelancer`；仲裁员由部署钱包 `grantRole`。
3. **配置**：三个新合约地址写入 `backend/.env`（`RPC_URL` 改公开 RPC、`CHAIN_ID=11155111`、`CHAIN_CONFIRMATIONS` 建议 ≥2）；前端更新地址配置；`FRONTEND_ORIGIN` 设为前端公网域名。
4. **后端托管**：单机 SQLite 仅适合演示；多实例需换托管数据库并补正式 migration；CORS 只放行前端域名。
5. **前端托管**：Vercel/Netlify/GitHub Pages 静态托管 `npm run build` 产物。
6. **验收**：`/health` 显示 evm 且 chainId 正确；用测试钱包走一遍创建→注资→提交→审批；Etherscan 可见合约与事件。

注意：`.env`、私钥、`deployments/localhost.json` 均不得提交；Sepolia 部署记录可另存 `deployments/sepolia.json` 提交（属正式部署记录）。

## 3.4 提交规则（沿用仓库 .gitignore）

提交：源码、测试、lockfile、ABI、部署脚本、文档、`.env.example`（建议补充）、本报告。
不提交：真实 `.env`、node_modules、dist、artifacts/cache、`backend/data/*.db*`、localhost 部署生成物与演示回执、日志与私钥。

---

# 附录　交付物清单（成员 E）

| 交付物 | 文件 |
|---|---|
| 架构图（矢量/位图） | `docs/E-architecture.svg`、`docs/E-architecture.png` |
| 测试报告 | 本报告第二部分（独立版 `E-TEST-REPORT.md`） |
| 部署说明 | 本报告第三部分（独立版 `E-DEPLOYMENT.md`） |
| 端到端联调测试脚本 | `backend/e2e/e2e-integration.mjs`（+ `e2e-results.json`） |
| Demo 操作指南（含 17 张界面截图） | `E-DEMO-GUIDE.md`、`docs/shots/` |
| 本报告 | `E-FINAL-REPORT.md`（中文版）、`E-FINAL-REPORT-EN.md`（英文版） |
