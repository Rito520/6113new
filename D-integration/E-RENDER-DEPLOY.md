# SC6113 部署到 Render + Sepolia 手把手指南（成员 E）

> 面向对象：完全没部署过 Web 服务的新手。每一步都写了「在哪点 → 填什么 → 看到什么算成功」。
> 目标：把前端和后端部署到 **Render**（公网可访问），把三个合约部署到 **Sepolia 测试网**（真实公链，但用的是免费测试币）。

---

## 0. 先搞懂：为什么本地演示和 Render 部署完全不同

| | 本地演示（你已跑通） | Render 部署（本文） |
|---|---|---|
| 区块链 | 你电脑上的 Hardhat 假链（8546） | **Sepolia 真实测试网**（全网共用） |
| 后端 | 你电脑 3001 端口 | Render 服务器（公网网址） |
| 前端 | 你电脑 5173 端口 | Render 服务器（公网网址） |
| 钱包 | 3 个 Hardhat 测试账户 | **你自己新建的 MetaMask 钱包**（3 个） |
| 数据 | 本地 SQLite 文件 | Render 上的临时 SQLite（重启清空） |

**核心原因**：Render 的服务器在云端，它**连不到你电脑里的本地链**（`127.0.0.1` 在它眼里是它自己）。所以合约必须放到公网上能访问的 Sepolia 测试网。

**部署总顺序（不能乱）**：
```
① 推代码到新 GitHub 仓库  →  ② 合约部署到 Sepolia  →  ③ 设置三个角色
        ↓
④ Render 部署后端（填合约地址）  →  ⑤ Render 部署前端（填后端网址+合约地址）  →  ⑥ 验证
```
后端和前端都需要合约地址，所以合约必须先部署。

---

## 1. 你需要自己准备的四样东西（我无法代劳）

| # | 东西 | 怎么弄 | 用途 |
|---|---|---|---|
| 1 | **Render 账号** | render.com → Sign up → 选 "Sign up with GitHub"（最省事） | 托管前后端 |
| 2 | **Sepolia RPC 地址** | 注册 alchemy.com（免费）→ Create App → 选 Sepolia → 复制 HTTPS 地址 | 让后端/合约工具能连上 Sepolia |
| 3 | **Sepolia 测试币** | 用钱包地址去水龙头领：faucets.chain.link/sepolia、sepoliafaucet.com 等 | 付部署合约和交易的 gas |
| 4 | **一个部署钱包** | MetaMask 里**新建**一个账户（不要用你日常的！），把上面领的测试币转到它 | 部署合约、当管理员授权仲裁员 |

> ⚠️ **安全红线**：第 4 项那个钱包的**私钥**只能你自己填进 `.env` 和 Render 后台。**绝对不要发给任何人（包括我）**，也不要提交到 GitHub。我在文档里凡是需要私钥的地方都写"你自己填"。

> 领测试币建议多领几次、多领几个水龙头。Sepolia 部署三个合约大约需要 **0.01～0.05 ETH** 测试币（gas），后续每笔操作也都要 gas。

---

## 2. 阶段一：把代码推到新的 GitHub 仓库

### 2.1 为什么要重新推

我核对过：**GitHub 上现有的代码是旧的**，缺了两处必要改动：
- 前端 `args.milestoneIndex` → `args.index`（**不修的话，部署后争议仲裁必然报错**，测试报告 E-04）
- 仓库**没有 `.gitignore`**：直接 `git add .` 会把 `node_modules`（几百 MB）和 `.env`（含私钥！）推到公网，属于无法撤销的泄露

我已经在本地为你补齐：`.gitignore`（已验证能挡住 `.env` / `node_modules`）、`backend/.env.example`、`frontend/.env.example`、`contracts/scripts/grant-arbitrator.js`。

### 2.2 在 GitHub 网站上建空仓库

1. 打开 github.com → 右上角 **+** → **New repository**
2. Repository name：`SC6113-deployed`（或你喜欢的名字）
3. 选 **Public**（作业一般要老师能看）
4. **不要勾选** "Add a README"、"Add .gitignore"、"Add a license"（必须完全空仓库，否则推不上去）
5. 点 **Create repository**，页面上会显示仓库地址，形如：
   `https://github.com/你的用户名/SC6113-deployed.git` ← **记下它**

### 2.3 在本地推送（PowerShell 里逐条粘贴执行）

按 `Win 键` → 输入 `powershell` → 回车。然后**逐条**粘贴下面命令（每条回车，等它跑完再下一条）：

```powershell
cd D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113

# 1) 配一次提交身份（换成你自己的名字和 GitHub 邮箱）
git config user.name "你的名字"
git config user.email "你的GitHub邮箱"

# 2) 把"已被旧仓库跟踪、但本不该提交"的文件从版本控制里摘掉（只摘索引，不删你磁盘上的文件）
git rm -r --cached --quiet D-integration/backend/data
git rm -r --cached --quiet D-integration/backend/dist
git rm -r --cached --quiet D-integration/frontend/dist
git rm -r --cached --quiet D-integration/contracts/artifacts
git rm --cached --quiet D-integration/contracts/deployments/localhost.json
git rm --cached --quiet D-integration/contracts/deployments/localhost-demo-transactions.json
git rm --cached --quiet contracts/deployments/localhost.json
git rm --cached --quiet contracts/deployments/localhost-demo-transactions.json

# 3) 暂存所有该提交的内容
git add .gitignore D-integration

# 4) 关键安全检查：确认待提交清单里没有 .env、node_modules、数据库文件
#    这条命令应该【没有任何输出】。有输出就停下来截图问我。
git diff --cached --name-only | Select-String "node_modules|/\.env$|\.db$|artifacts/"

# 5) 提交
git commit -m "Add E deliverables, frontend dispute-id fix, gitignore and env templates"

# 6) 指向你新建的仓库并推送（把 URL 换成 2.2 记下的那个）
git remote add deploy https://github.com/你的用户名/SC6113-deployed.git
git push -u deploy D-integration:main
```

**第 4 步是安全闸门**：它必须无输出。如果打印出了任何文件名，说明忽略规则没生效，**先停下来截图发我**，别继续推。

推送时 GitHub 会弹窗要你登录授权（或让你输用户名 + Personal Access Token）。Token 在 GitHub → Settings → Developer settings → Personal access tokens 生成，勾 `repo` 权限。

**成功标志**：浏览器打开你的新仓库，能看到 `D-integration/` 目录、根目录有 `.gitignore`，且**搜不到任何 `.env` 或 `node_modules` 文件**。

### 2.4 推之前/之后确认「前端 bug 修复」在里面（很重要）

Render 部署的是 GitHub 上的代码，所以必须确认这个修复被推上去了 —— 否则争议仲裁在公网上必然报错。

在 PowerShell 里执行：

```powershell
cd D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113
Select-String -Path "D-integration\frontend\src\services\api\index.ts" -Pattern 'args.index' -SimpleMatch
```

- **有输出**（能看到 `String(args.index)`）= 修复在，可以放心推
- **无输出** = 你的工作区是旧代码，先别推，截图问我

> 顺带说明一个容易自己吓自己的点：如果你在构建产物 `frontend/dist/assets/*.js` 里搜 `milestoneIndex`，**会搜到**——那不是 bug 残留，而是 `frontend/src/contracts/DisputeManager.json` 这个 ABI 文件里本来就有个叫 `milestoneIndex` 的合法事件参数名，打包时会被一起打进去。判断修复是否生效要看**源码** `src/services/api/index.ts` 里是不是 `args.index`，或者在产物里搜 `DisputeRaised` 看它旁边跟的是 `i.index` 还是 `i.milestoneIndex`。

---

## 3. 阶段二：把三个合约部署到 Sepolia

### 3.1 建一个本地私密文件放密钥（不要提交）

用记事本在**仓库外面**建一个文件，比如 `D:\my-secrets.txt`，写三行（值你自己填）：

```
SEPOLIA_RPC_URL=https://sepolia.g.alchemy.com/v2/你的key
PRIVATE_KEY=0x你的部署钱包私钥
DEPLOYER=0x你的部署钱包地址
```

> 放在仓库外 = 永远不会被 git 提交。用完这个文件可以删掉。

### 3.2 执行部署（PowerShell，逐条粘贴）

```powershell
cd D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration\contracts

# 把下面两行的值换成你 my-secrets.txt 里的真实值
$env:SEPOLIA_RPC_URL = "https://sepolia.g.alchemy.com/v2/你的key"
$env:PRIVATE_KEY     = "0x你的部署钱包私钥"

# 部署（不带 SEED_DEMO —— 那个只在本地链有效）
npx hardhat run scripts/deploy.js --network sepolia
```

**成功标志**：打印出三个合约地址，并生成 `deployments/sepolia.json`：

```
RoleManager      0xAAAA...  gas=...
ProjectEscrow    0xBBBB...  gas=...
DisputeManager   0xCCCC...  gas=...
Saved deployments/sepolia.json and deployments/abi/*.json
```

**把这三个地址抄下来**（后面 Render 要填两遍）。也可以打开 `deployments/sepolia.json` 复制。
拿地址去 `https://sepolia.etherscan.io/address/合约地址` 能查到 = 真的上链了。

> 常见报错：
> - `insufficient funds for gas` = 测试币不够，回水龙头再领
> - `nonce too low` = 上一笔还没确认，等 30 秒重试
> - `HH101 chain id` 相关 = `SEPOLIA_RPC_URL` 填的不是 Sepolia 网络的地址

### 3.3 给三个角色钱包设置身份

Sepolia 上**没有** Hardhat 那三个预置账户，所以要用你自己的钱包。建议 MetaMask 里新建 3 个账户（Client / Freelancer / Arbitrator），每个都从水龙头领一点测试币。

**仲裁员必须由管理员授权**（合约规定，前端没有这个入口），所以用我新加的脚本：

```powershell
cd D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration\contracts
# 环境变量还在同一个窗口的话不用重设；否则重设 SEPOLIA_RPC_URL 和 PRIVATE_KEY
$env:ARBITRATOR_ADDRESS = "0x你的仲裁员钱包地址"
npx hardhat run scripts/grant-arbitrator.js --network sepolia
```

成功会打印 `Granted. tx=0x...` 和 `rolesOf -> ... arbitrator=True`。

**甲方和乙方自己注册**（不用命令）：等第 5 阶段前端上线后，用对应钱包登录网站，页面会出现 `Register Client` / `Register Freelancer` 按钮，点它 → MetaMask 确认即可。

---

## 4. 阶段三：Render 部署后端（Web Service）

### 4.1 创建服务

1. 登录 dashboard.render.com → **New +** → **Web Service**
2. 点 **Connect a repository from GitHub**（第一次会要求授权 Render 访问你的 GitHub）→ 找到并选你新建的仓库
3. 填写：

| 字段 | 填什么 |
|---|---|
| Name | `sc6113-backend` |
| Region | 随便（Singapore 或 Oregon） |
| **Root Directory** | `D-integration/backend` ← **关键，填错就构建失败** |
| Runtime | **Node** |
| Build Command | `pnpm install && pnpm build` |
| Start Command | `node dist/src/server.js` |
| Instance Type | **Free** |

4. **先别点 Create**，往下找到 **Environment Variables** 区域，点 **Add Environment Variable** 逐个添加：

| Key | Value |
|---|---|
| `NODE_VERSION` | `22.14.0` |
| `CHAIN_MODE` | `evm` |
| `RPC_URL` | 你的 Sepolia RPC 地址 |
| `CHAIN_ID` | `11155111` |
| `CHAIN_CONFIRMATIONS` | `2` |
| `DATABASE_PATH` | `/tmp/sc6113.db` |
| `CONTRACT_ABI_DIRECTORY` | `../contracts/deployments/abi` |
| `ROLE_MANAGER_ADDRESS` | 阶段二抄的地址 |
| `PROJECT_ESCROW_ADDRESS` | 阶段二抄的地址 |
| `DISPUTE_MANAGER_ADDRESS` | 阶段二抄的地址 |
| `FRONTEND_ORIGIN` | 先填 `http://localhost:5173`（第 5 阶段拿到前端网址后**回来改**） |

> 说明：
> - `NODE_VERSION` 必须 22 以上，因为后端用了 Node 内置的 `node:sqlite`。
> - `DATABASE_PATH=/tmp/...` 是因为 Render 免费层的普通文件系统**只读**，只有 `/tmp` 可写。
> - **不需要**填 `PRIVATE_KEY`！后端从不发交易，只读链上回执核验——这是这个架构的安全设计。

5. 点 **Create Web Service**，等构建（2-5 分钟）。

### 4.2 确认后端成功

构建日志最后应出现：
```
SC6113 backend listening on http://localhost:10000
Blockchain gateway: evm
```
（Render 会自己把 `PORT` 设好，日志里显示什么端口都正常。）

然后打开 Render 给你的网址，例如 `https://sc6113-backend.onrender.com/health`，浏览器应显示：
```json
{"status":"ok","chainMode":"evm",...}
```
**看到 `chainMode":"evm"` = 后端部署成功。把这个网址完整复制下来**（下一步要用）。

> 免费层服务闲置 15 分钟会休眠，第一次访问可能要等 30-60 秒冷启动，属正常。

---

## 5. 阶段四：Render 部署前端（Static Site）

### 5.1 创建服务

1. dashboard.render.com → **New +** → **Static Site**
2. 选同一个仓库
3. 填写：

| 字段 | 填什么 |
|---|---|
| Name | `sc6113-frontend` |
| **Root Directory** | `D-integration/frontend` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

4. **Environment Variables**（Vite 的变量是构建时写死进代码的，所以必须在这里填对）：

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | 第 4.2 步复制的后端网址，如 `https://sc6113-backend.onrender.com` |
| `VITE_CHAIN_ID` | `0xaa36a7` ← Sepolia 的十六进制 chainId |
| `VITE_RPC_URL` | 你的 Sepolia RPC 地址 |
| `VITE_ROLE_MANAGER_ADDRESS` | 合约地址 |
| `VITE_PROJECT_ESCROW_ADDRESS` | 合约地址 |
| `VITE_DISPUTE_MANAGER_ADDRESS` | 合约地址 |

5. 点 **Create Static Site**，等构建完成，会拿到形如 `https://sc6113-frontend.onrender.com` 的网址。

### 5.2 回头改后端的 CORS（**最容易漏的一步**）

后端只允许 `FRONTEND_ORIGIN` 指定的来源跨域访问，不改的话前端会一直报 `backend unavailable`：

1. Render → 你的 **sc6113-backend** 服务 → 左侧 **Environment**
2. 把 `FRONTEND_ORIGIN` 的值改成前端网址，如 `https://sc6113-frontend.onrender.com`（**结尾不要带斜杠**）
3. 点 **Save Changes** → Render 会自动重新部署后端（等 1-2 分钟）

### 5.3 前端连的是哪条链？

前端通过 **MetaMask** 连链，所以你的浏览器 MetaMask 必须**切换到 Sepolia 网络**：
狐狸图标 → 左上角网络名 → 选 **Sepolia**（没有就添加：Chain ID `11155111`、RPC 填你的 Sepolia 地址、符号 `ETH`）。

---

## 6. 阶段五：验证部署成功

1. 打开前端网址 → MetaMask 切到 **Sepolia** → 用**部署钱包**（管理员）登录
   - 第一次会显示 `This wallet must have an on-chain role before login` → 点 **Register Client** → MetaMask 确认
2. 换 **Freelancer** 钱包登录 → 点 **Register Freelancer** → 确认
3. **Arbitrator** 钱包：已在 3.3 用脚本授权，直接登录即可（若提示无角色，重跑一次 3.3）
4. 用 Client 创建一个**小额**测试项目（比如总额 `0.0002` ETH，两个里程碑各 `0.0001`）→ 走完 接受 → 注资 → 提交 → 审批
5. 打开 **Transactions** 和 **Event logs** 页，应能看到真实记录
6. 把交易哈希贴到 `https://sepolia.etherscan.io/tx/哈希`，能看到链上记录 = **真部署成功了**

> **作业交付的"公开 URL"就是前端网址**（如 `https://sc6113-frontend.onrender.com`），把它写进报告第三部分即可。

---

## 7. 必须知道的限制（诚实说明，写进报告更专业）

1. **数据库不持久**：Render 免费层用 `/tmp` 存 SQLite，服务重启或休眠唤醒后数据清空（链上数据不受影响，因为链才是真相源）。重启后需要重新走一遍"创建项目"流程才有数据展示。
   - 要持久化的两个选择：Render 付费加 **Disk**（把 `DATABASE_PATH` 指向挂载路径）；或改用托管 Postgres（**需要改后端代码**，工作量较大，不建议赶作业时做）。
2. **每次操作要花真实测试币 gas**：Sepolia 上每个动作都是一笔真交易，记得给三个钱包都备点测试币。
3. **合约地址一旦部署就固定**：重新部署合约 = 新地址 = 后端和前端的环境变量都要改并重新构建。
4. **前端变量是构建时写死的**：改了 `VITE_*` 变量必须 **Manual Deploy → Deploy latest commit** 重新构建才生效，光改不重建没用。
5. **本地演示和公网部署是两套独立环境**：本地那三个黑窗口和 Render 互不影响，可以并存。

---

## 8. 排错表

| 现象 | 原因 | 解决 |
|---|---|---|
| Render 构建报 `package.json not found` | Root Directory 没填 | 改成 `D-integration/backend` 或 `D-integration/frontend` |
| 后端日志报找不到 ABI 文件 | `CONTRACT_ABI_DIRECTORY` 不对 | 确认填 `../contracts/deployments/abi`，且 Root Directory 是 backend |
| 后端启动报 `node:sqlite` 相关错误 | Node 版本太低 | 确认 `NODE_VERSION=22.14.0`；仍报错就把 Start Command 改成 `node --experimental-sqlite dist/src/server.js` |
| 前端一直 `backend unavailable` | CORS 没配对 | 回 5.2 把 `FRONTEND_ORIGIN` 改成前端网址（结尾无斜杠），等后端重新部署完 |
| 登录提示 `Wrong chain` | MetaMask 不在 Sepolia | 切到 Sepolia 网络 |
| 登录提示 `must have an on-chain role` | 该钱包没注册角色 | 点页面上的 Register 按钮；仲裁员要跑 3.3 的脚本 |
| 交易一直 pending / 报 gas 错 | 测试币不足或网络拥堵 | 补领测试币；Sepolia 拥堵时等几分钟 |
| 争议裁决报错 | 部署的是旧代码（没含 `args.index` 修复） | 确认 2.3 推送的是修复后的代码，Render 上 **Manual Deploy → Deploy latest commit** 重新构建 |
| 后端 500 `could not decode result data` | 环境变量里的合约地址和 RPC 指向的链对不上 | 核对三个地址是 Sepolia 部署产出的、`CHAIN_ID=11155111` |

---

## 9. 一页速查（照着打勾）

- [ ] Render 账号已注册、GitHub 已授权
- [ ] Alchemy Sepolia RPC 地址已拿到
- [ ] 部署钱包已建、已领测试币（≥0.05 ETH 保险）
- [ ] 新 GitHub 空仓库已建
- [ ] 代码已推送，且第 4 步安全检查无输出、仓库里搜不到 `.env`
- [ ] 三个合约已部署到 Sepolia，地址已抄下，Etherscan 能查到
- [ ] 仲裁员已用 `grant-arbitrator.js` 授权
- [ ] 后端 Web Service 已上线，`/health` 显示 `chainMode":"evm"`
- [ ] 前端 Static Site 已上线，6 个 `VITE_*` 变量填对
- [ ] 后端 `FRONTEND_ORIGIN` 已改成前端网址并重新部署
- [ ] MetaMask 切到 Sepolia，三个钱包各自注册/授权完成
- [ ] 走完一次小额完整流程，Etherscan 可查 → 公开 URL 记入报告
