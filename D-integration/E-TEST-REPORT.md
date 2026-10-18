# SC6113 测试报告（Member E：联调与系统测试）

日期：2026-10-15　环境：Windows 11 / Node v22.14.0 / pnpm 12.11.2 / Hardhat 本地链（chainId 31337）
代码基线：GitHub `Rito520/SC6113` 分支 `D-integration`（commit `a0bcad1`）
测试脚本：`backend/e2e/e2e-integration.mjs`（E 新增，机器可读结果见 `backend/e2e/e2e-results.json`）

## 0. 结论摘要

| 层级 | 结果 |
|---|---|
| B 合约单元测试（`contracts` → `npm test`） | **32/32 通过** |
| C 后端 API 测试（`backend` → `pnpm test`） | **2/2 通过** |
| C 后端真实回执集成测试（`RUN_EVM_INTEGRATION=true`） | **1/1 通过** |
| D 前端生产构建（`frontend` → `npm run build`） | **成功**（194 modules，无类型错误） |
| E 端到端联调（链+后端真实交互，17 用例） | **17/17 通过** |

系统在本机 Hardhat + SQLite + MetaMask 兼容流程下**功能正确、权限正确、回执核验有效**。发现 3 个集成层面问题（§4），均不阻塞本地演示，其中 1 个建议在正式部署前修复。

## 1. 基线测试（复现命令与结果）

```powershell
cd contracts; npm test                      # 32 passing
cd ..\backend; pnpm typecheck; pnpm test    # 2 pass (+1 skipped 集成测试)
$env:RUN_EVM_INTEGRATION='true'; pnpm test  # 3 pass（含真实回执集成测试）
cd ..\frontend; npm run build               # ✓ built
```

真实回执集成测试读取 `RoleManager.rolesOf`、核对 acceptProject 回执的发送钱包/目标合约/函数参数/`ProjectAccepted` 事件，全部通过——证明 B/C 连接在真实链上成立。

## 2. E 端到端联调（17 用例，全通过）

方法：脚本完全复刻 D 前端的调用方式——相同合约函数、相同规范哈希 `keccak256(JSON.stringify(…))`、相同 REST 请求体，在 `CHAIN_MODE=evm` 下对"MetaMask 交易→回执核验→SQLite 记录"全链路验证。权限负例用 `staticCall` 模拟（零 gas、零 nonce、零链上副作用）。

| 用例 | 覆盖点 | 结果 |
|---|---|---|
| ENV-01 | 后端 health=evm、RPC chainId=31337 | PASS |
| AUTH-01 | 三角色 nonce+签名登录、`/api/me` 链上角色正确 | PASS |
| AUTH-02 | 未注册钱包 nonce 阶段 403 | PASS |
| AUTH-03 | 篡改签名 401 | PASS |
| A-01 | Client 链上创建项目→后端回执核验后入库（2 里程碑、金额 0.01 ETH） | PASS |
| A-02 | 未上链哈希被拒（409 TRANSACTION_NOT_MINED） | PASS |
| A-03 | Freelancer 接受→Client 注资→ACTIVE、链上托管余额=0.01 ETH | PASS |
| A-04 | 越权：Freelancer 注资/Freelancer 建项目/Client 开始里程碑 均被拒 | PASS |
| A-05 | 里程碑1：start→submit→approve，状态 APPROVED | PASS |
| A-06 | 里程碑2：submit→approve，项目 COMPLETED、托管清零、Freelancer 余额净增 | PASS |
| A-07 | 审计表：≥8 条交易记录 + ProjectCreated/Accepted/Funded/MilestoneSubmitted/Approved 事件 | PASS |
| NEG-01 | 链上哈希≠REST 正文哈希 → 422 TRANSACTION_ARGUMENT_MISMATCH（不写库） | PASS |
| B-01 | 争议项目 create→accept→fund | PASS |
| B-02 | submit→reject→resubmit→Freelancer raiseDispute，项目 DISPUTED | PASS |
| B-03 | 争议列表、证据提交、Client/外人 resolve 或举证被拒 | PASS |
| B-04 | 非仲裁员会话 403 FORBIDDEN_ROLE；仲裁员 resolve→RESOLVED、项目回 ACTIVE | PASS |
| C-01 | 未开工项目 cancel→CANCELLED、链上状态 7 | PASS |

运行统计：本次干净环境 17/17 通过；过程中后端因区块头缓存滞后返回的时序 409 共 18 次，重试后全部成功（见 §4-E01）。

## 3. 覆盖说明与未覆盖项

已覆盖：正常支付全闭环、拒绝-重提交、争议-证据-裁决、取消退款、角色/签名/未注册/哈希不匹配/未上链哈希等负例、审计与事件落库。
未覆盖（建议后续或现场演示补充）：7 天静默后 Freelancer 自助领取 `claimAfterReview`（需时间旅行，合约单测已覆盖）；pause 管理路径（合约单测已覆盖）；真实浏览器 MetaMask 弹窗交互（由 Demo 录屏/现场演示承担）。

## 4. 集成层发现（E 的测试结论）

**E-01（建议部署前修复）后端确认数校验存在时序窗口。**
`EvmBlockchainGateway.verifyAction` 用默认轮询（约 4s）的 provider 计算确认数；在 Hardhat automine（瞬时出块）下，交易刚挖出即提交核验会返回 `409 INSUFFICIENT_CONFIRMATIONS`，约 2-4 秒后重试即成功。因核验失败发生在任何写库之前，重试安全、无重复记录。影响：前端用户若手速快会偶见一次报错提示。建议：后端对该路径改用 `receipt.waitForConfirmations` 或短轮询等待后再判定。

**E-02（环境操作项，非代码缺陷）仓库内提交的演示 SQLite 必须随新链重置。**
`backend/data/sc6113.db*` 虽在 .gitignore 规则内，但 D 的副本曾被带入工作区：其冒烟测试项目占用 `(chain_id, chain_project_id)` 唯一索引，与新链项目 ID 冲突导致创建项目 500。HANDOFF 的重置流程（停后端→移走/删除 db 三件套→重启）可解决，已验证。

**E-03（文档缺口）README 引用的 `.env.example` 在仓库中不存在。**
`backend/.env.example`、`frontend/.env.example` 均缺失，按 README 执行 `Copy-Item .env.example .env` 会失败。已按 `config.ts` 默认值与文档补建 `backend/.env`（CHAIN_MODE=evm 等）。建议把两份 `.env.example` 提交进仓库。

**E-04（前端缺陷，已在本地修复，需随分支提交）争议链上 ID 解析字段名错误，导致仲裁/举证必然失败。**
`frontend/src/services/api/index.ts` 的 `disputes()` 从 `DisputeRaised` 事件重建 `chainDisputeId` 时读取 `args.milestoneIndex`，而合约该事件的参数名为 `index`（见 `ProjectEscrow.sol:103`），匹配永远失败 → `chainDisputeId` 为空 → `DisputesPage` 以 id=0 调用 `resolveDispute`/`submitEvidence`，合约 revert（`missing revert data`）。现象：争议卡片显示 `CHAIN #` 为空、仲裁点裁决即报错。E 已将 `args.milestoneIndex` 改为 `args.index`，复测全流程（含仲裁 RESOLVED）通过。**该修复必须随分支提交，否则正式演示的争议环节不可用。**

**E-05（前端小缺陷，建议修复）项目详情页整页刷新首次加载 401。**
直接整页刷新进入 `/projects/:id` 时，`ProjectDetailPage` 的数据加载 effect 先于 `SessionProvider` 恢复会话 token 的 effect 执行（React 子组件 effect 先于父组件），首个请求以无 token 发出 → 401 AUTH_REQUIRED，页面停留 Loading/报错，需再次导航才恢复。SPA 内点击导航不受影响。建议：详情页在 `session.user` 就绪后再发起加载。

**说明项（设计使然，非缺陷）**：`GET /api/disputes` 不返回 `chainDisputeId`，前端与本测试脚本均从 `DisputeRaised` 事件/回执解析（与 D 实现一致）；回执核验被拒时链上与库中状态有意保持分叉（链上已发生、库中不记录），由后续业务动作收敛。

## 5. 复现方式

```powershell
# 终端1：contracts → npm run node
# 终端2：contracts → $env:SEED_DEMO='true'; npm run deploy:localhost
# 终端3：backend  → pnpm start（需先有 .env，见 E-03）
# 终端4：backend  → node e2e/e2e-integration.mjs
```

详细步骤与 Sepolia 方案见 `E-DEPLOYMENT.md`；演示操作见 `E-DEMO-GUIDE.md`。
