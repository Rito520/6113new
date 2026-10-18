/**
 * Member E — formal end-to-end integration test (B contracts + C backend + real local chain).
 *
 * Mirrors exactly what D's frontend sends: same contract functions, same canonical
 * keccak256(JSON.stringify(...)) hashes (see frontend/src/utils/hashJson.ts and
 * frontend/src/services/blockchain/contracts.ts), same REST bodies (see
 * frontend/src/services/api/index.ts), against C's receipt-verified API in CHAIN_MODE=evm.
 *
 * Prerequisites (all local):
 *   1. Hardhat node running            : cd contracts && npm run node
 *   2. Fresh seeded deployment         : cd contracts && $env:SEED_DEMO='true'; npm run deploy:localhost
 *   3. Backend running with .env       : cd backend && pnpm start   (CHAIN_MODE=evm)
 *   4. Fresh backend database          : stop backend, move backend/data/sc6113.db* away, restart
 *
 * Run:  cd backend && node e2e/e2e-integration.mjs
 * Writes a machine-readable summary to backend/e2e/e2e-results.json.
 *
 * Robustness notes (findings E-01/E-02 in the test report):
 *  - The backend provider caches the head block number between polls (~4s), so verifying a
 *    just-mined receipt can transiently answer 409 INSUFFICIENT_CONFIRMATIONS. Every
 *    transaction-recording REST call therefore retries on timing codes (safe: verifyAction
 *    throws before any DB write). Retry counts are reported as timingRetries.
 *  - Under Hardhat automining, ethers' cached pending nonce can lag; this script manages
 *    nonces explicitly per wallet instead.
 *
 * LOCAL DEVELOPMENT ONLY — uses the publicly documented Hardhat test keys, never real funds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Contract, Interface, JsonRpcProvider, Wallet, keccak256, parseEther, toUtf8Bytes } from 'ethers'

const API = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001'
const RPC = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8545'

// --- local chain identities (Hardhat documented test accounts #1..#4) -------------
const KEYS = {
  client: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  freelancer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  arbitrator: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  outsider: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
}
const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true })
const wallets = Object.fromEntries(Object.entries(KEYS).map(([role, key]) => [role, new Wallet(key, provider)]))

// --- contract handles -------------------------------------------------------------
const contractsDir = path.resolve(process.cwd(), '..', 'contracts')
const deployed = JSON.parse(readFileSync(path.join(contractsDir, 'deployments/localhost.json'), 'utf8'))
const abi = (name) => JSON.parse(readFileSync(path.join(contractsDir, 'deployments/abi', `${name}.json`), 'utf8'))
const escrowFor = (wallet) => new Contract(deployed.contracts.ProjectEscrow.address, abi('ProjectEscrow'), wallet)
const disputeFor = (wallet) => new Contract(deployed.contracts.DisputeManager.address, abi('DisputeManager'), wallet)

// --- helpers mirroring the frontend ----------------------------------------------
const hashJson = (value) => keccak256(toUtf8Bytes(JSON.stringify(value)))
const dateToUnix = (date) => BigInt(Date.parse(`${date}T00:00:00Z`) / 1000)
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Explicit per-wallet nonce management: under automining, ethers' cached pending nonce can lag.
const nonces = new Map()
const send = async (wallet, factory) => {
  let nonce = nonces.get(wallet.address)
  if (nonce === undefined) nonce = BigInt(await provider.getTransactionCount(wallet.address, 'latest'))
  const tx = await factory({ nonce })
  const receipt = await tx.wait()
  nonces.set(wallet.address, nonce + 1n) // mined transactions consume the nonce even when reverted
  if (receipt?.status !== 1) throw new Error('contract transaction reverted')
  return receipt
}

const sessions = {}
async function login(role) {
  const wallet = wallets[role]
  const nonceRes = await fetch(`${API}/api/auth/nonce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet.address }) })
  const nonceBody = await nonceRes.json()
  if (!nonceRes.ok) return { status: nonceRes.status, body: nonceBody }
  const signature = await wallet.signMessage(nonceBody.message)
  const verifyRes = await fetch(`${API}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet.address, signature }) })
  const verifyBody = await verifyRes.json()
  if (!verifyRes.ok) return { status: verifyRes.status, body: verifyBody }
  sessions[role] = verifyBody.token
  return { status: verifyRes.status, body: verifyBody }
}
async function rest(role, method, pathname, body) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(sessions[role] ? { Authorization: `Bearer ${sessions[role]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json().catch(() => undefined)
  if (response.status >= 400 && current) {
    current.details.push(`HTTP ${response.status} ${method} ${pathname} -> code=${json?.error?.code} message=${json?.error?.message}`)
    console.log(`       [api] HTTP ${response.status} ${method} ${pathname} -> code=${json?.error?.code} message=${json?.error?.message}`)
  }
  return { status: response.status, body: json }
}
// Transaction-recording calls retry while the backend answers with a pure timing code.
// This is safe: verifyAction throws before any database write, so a retry cannot duplicate state.
const TIMING_CODES = new Set(['TRANSACTION_NOT_MINED', 'INSUFFICIENT_CONFIRMATIONS'])
let timingRetries = 0
async function restRetry(role, method, pathname, body, maxTries = 8) {
  let res = await rest(role, method, pathname, body)
  let tries = 1
  while (tries < maxTries && res.status === 409 && TIMING_CODES.has(res.body?.error?.code)) {
    await sleep(2500)
    res = await rest(role, method, pathname, body)
    tries++
  }
  if (tries > 1) {
    timingRetries += tries - 1
    note(`backend head-block cache lag: retried ${tries - 1}x before HTTP ${res.status} (${res.body?.error?.code ?? 'accepted'})`)
  }
  return res
}

// The GET /api/disputes payload intentionally omits chainDisputeId (mapDispute does not expose it),
// exactly why D's frontend rebuilds it from decoded events. Do the same: parse DisputeRaised off-chain.
const escrowIface = new Interface(abi('ProjectEscrow'))
const disputeIdFromReceipt = (receipt) => {
  for (const log of receipt.logs) {
    try {
      const parsed = escrowIface.parseLog({ topics: [...log.topics], data: log.data })
      if (parsed?.name === 'DisputeRaised') return String(parsed.args.disputeId)
    } catch { /* unrelated contract log */ }
  }
  return undefined
}

// --- tiny test harness ------------------------------------------------------------
const results = []
let current = null
function caseStart(name) { current = { name, status: 'pass', details: [] }; results.push(current); console.log(`\n[RUN ] ${name}`) }
function note(text) { current.details.push(text); console.log(`       ${text}`) }
function check(condition, text) {
  current.details.push(`${condition ? 'PASS' : 'FAIL'} — ${text}`)
  console.log(`       ${condition ? 'PASS' : 'FAIL'} — ${text}`)
  if (!condition) current.status = 'fail'
  return condition
}
async function expectRevert(promise, text) {
  try { await promise; check(false, `${text} (expected revert, but call succeeded)`) } catch { check(true, `${text} (reverted as expected)`) }
}

// ================================================================================
console.log('== SC6113 Member E end-to-end integration test ==')
console.log(`API ${API} | RPC ${RPC} | chain accounts: client=${wallets.client.address}`)

// --- 0. environment & auth ---------------------------------------------------------
caseStart('ENV-01 health endpoint reports evm mode')
{
  const health = await (await fetch(`${API}/health`)).json()
  check(health.status === 'ok' && health.chainMode === 'evm', `health=${health.status}, chainMode=${health.chainMode}`)
  const network = await provider.getNetwork()
  check(Number(network.chainId) === 31337, `RPC chain id = ${network.chainId}`)
}

caseStart('AUTH-01 seeded wallets log in and expose on-chain roles')
{
  for (const role of ['client', 'freelancer', 'arbitrator']) {
    const res = await login(role)
    check(res.status === 200, `${role} nonce+signature login -> HTTP ${res.status}`)
    const me = await rest(role, 'GET', '/api/me')
    const roles = me.body?.roles ?? []
    const expected = role.toUpperCase()
    check(me.status === 200 && roles.includes(expected), `${role} /api/me roles=${JSON.stringify(roles)}`)
  }
}

caseStart('AUTH-02 unregistered wallet is refused at nonce step')
{
  const res = await fetch(`${API}/api/auth/nonce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallets.outsider.address }) })
  check(res.status === 403, `outsider nonce -> HTTP ${res.status} (expected 403)`)
}

caseStart('AUTH-03 tampered signature is rejected')
{
  const nonceRes = await fetch(`${API}/api/auth/nonce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallets.client.address }) })
  const nonceBody = await nonceRes.json()
  const good = await wallets.client.signMessage(nonceBody.message)
  const bad = good.slice(0, -2) + (good.slice(-2) === '1c' ? '1d' : '1c')
  const res = await fetch(`${API}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallets.client.address, signature: bad }) })
  check(res.status === 401 || res.status === 403, `bad signature -> HTTP ${res.status} (expected 401/403)`)
}

// --- 1. Scenario A: normal payment, full Client/Freelancer loop --------------------
const input = {
  title: 'E2E Normal Payment',
  description: 'Member E formal end-to-end scenario A: full milestone payment loop.',
  freelancerAddress: wallets.freelancer.address,
  totalAmountEth: '0.01',
  deadline: isoDate(14),
  milestones: [
    { title: 'Design', description: 'Logo and landing page design', amountEth: '0.004', dueDate: isoDate(7) },
    { title: 'Launch', description: 'Production launch and handover', amountEth: '0.006', dueDate: isoDate(14) },
  ],
}
let project
let chainProjectId
const freelancerBalanceBefore = await provider.getBalance(wallets.freelancer.address)

caseStart('A-01 Client creates project on chain; backend stores it after receipt verification')
{
  const receipt = await send(wallets.client, (o) => escrowFor(wallets.client).createProjectWithMilestones(
    input.freelancerAddress,
    dateToUnix(input.deadline),
    hashJson({ title: input.title, description: input.description }),
    input.milestones.map((m) => parseEther(m.amountEth)),
    input.milestones.map((m) => dateToUnix(m.dueDate)),
    input.milestones.map((m) => hashJson({ title: m.title, description: m.description })),
    o,
  ))
  note(`createProjectWithMilestones mined in block ${receipt.blockNumber} (${receipt.hash})`)
  const res = await restRetry('client', 'POST', '/api/projects', { ...input, transactionHash: receipt.hash })
  check(res.status === 201, `POST /api/projects -> HTTP ${res.status}`)
  project = res.body
  chainProjectId = project?.chainProjectId
  check(Boolean(project?.id) && project.milestones?.length === 2, `stored project ${project?.id} with ${project?.milestones?.length} milestones, chainProjectId=${chainProjectId}`)
  check(project?.status === 'CREATED', `status=${project?.status}`)
}

caseStart('A-02 negative: unmined transaction hash is rejected by receipt verification')
{
  const bogus = `0x${'ab'.repeat(32)}`
  // use the FREELANCER session so the role check passes and we actually exercise receipt verification
  const res = await rest('freelancer', 'POST', `/api/projects/${project.id}/accept`, { transactionHash: bogus })
  check(res.status === 409 && res.body?.error?.code === 'TRANSACTION_NOT_MINED',
    `unmined hash -> HTTP ${res.status} code=${res.body?.error?.code} (expected 409 TRANSACTION_NOT_MINED)`)
}

caseStart('A-03 Freelancer accepts; Client funds escrow; project becomes ACTIVE')
{
  const acceptReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).acceptProject(BigInt(chainProjectId), o))
  const acceptRes = await restRetry('freelancer', 'POST', `/api/projects/${project.id}/accept`, { transactionHash: acceptReceipt.hash })
  check(acceptRes.status === 200, `accept -> HTTP ${acceptRes.status}`)
  const fundReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).fundProject(BigInt(chainProjectId), { value: parseEther(input.totalAmountEth), ...o }))
  const fundRes = await restRetry('client', 'POST', `/api/projects/${project.id}/fund`, { transactionHash: fundReceipt.hash })
  check(fundRes.status === 200, `fund -> HTTP ${fundRes.status}`)
  check(fundRes.body?.project?.status === 'ACTIVE' && fundRes.body?.project?.funded === true, `project status=${fundRes.body?.project?.status}, funded=${fundRes.body?.project?.funded}`)
  const onChain = await escrowFor(wallets.client).getProject(BigInt(chainProjectId))
  check(onChain.escrowBalance === parseEther(input.totalAmountEth), `on-chain escrow holds ${onChain.escrowBalance} wei`)
}

caseStart('A-04 negative: wrong role actions revert on chain and are refused by REST')
{
  // staticCall simulates execution WITHOUT sending a transaction: zero gas, zero nonce
  // consumption, zero chain-state mutation — the correct way to assert access-control reverts.
  const m0id = BigInt(project.milestones[0].chainMilestoneId)
  await expectRevert(escrowFor(wallets.freelancer).fundProject.staticCall(BigInt(chainProjectId), { value: parseEther(input.totalAmountEth) }), 'Freelancer cannot fund (onlyClient)')
  await expectRevert(escrowFor(wallets.client).startMilestone.staticCall(BigInt(chainProjectId), m0id), 'Client cannot start milestone (onlyFreelancer)')
  const createAsFreelancer = await rest('freelancer', 'POST', '/api/projects', { ...input, title: 'Should Be Rejected', transactionHash: '0x' + '0'.repeat(64) })
  check(createAsFreelancer.status === 403 && createAsFreelancer.body?.error?.code === 'FORBIDDEN_ROLE',
    `Freelancer POST /api/projects -> HTTP ${createAsFreelancer.status} code=${createAsFreelancer.body?.error?.code} (expected 403)`)
}

caseStart('A-05 Milestone 1: start, submit, approve releases 0.004 ETH')
{
  const m0 = project.milestones[0]
  const startReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).startMilestone(BigInt(chainProjectId), BigInt(m0.chainMilestoneId), o))
  check((await restRetry('freelancer', 'POST', `/api/milestones/${m0.id}/start`, { transactionHash: startReceipt.hash })).status === 200, 'start recorded')
  const note0 = 'Delivered logo pack and landing page mockups.'
  const submitReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).submitMilestone(BigInt(chainProjectId), BigInt(m0.chainMilestoneId), hashJson({ note: note0, evidenceUrl: null }), o))
  const submitRes = await restRetry('freelancer', 'POST', `/api/milestones/${m0.id}/submissions`, { note: note0, transactionHash: submitReceipt.hash })
  check(submitRes.status === 201, `submit -> HTTP ${submitRes.status}`)
  const approveReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).approveMilestone(BigInt(chainProjectId), BigInt(m0.chainMilestoneId), o))
  const approveRes = await restRetry('client', 'POST', `/api/milestones/${m0.id}/approvals`, { transactionHash: approveReceipt.hash })
  check(approveRes.status === 200, `approve -> HTTP ${approveRes.status}`)
  const milestone = approveRes.body?.project?.milestones?.find((m) => m.id === m0.id)
  check(milestone?.status === 'APPROVED', `milestone status=${milestone?.status}`)
}

caseStart('A-06 Milestone 2: submit, approve; project COMPLETED and freelancer paid in full')
{
  const m1 = project.milestones[1]
  const note1 = 'Launch package delivered.'
  const submitReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).submitMilestone(BigInt(chainProjectId), BigInt(m1.chainMilestoneId), hashJson({ note: note1, evidenceUrl: null }), o))
  check((await restRetry('freelancer', 'POST', `/api/milestones/${m1.id}/submissions`, { note: note1, transactionHash: submitReceipt.hash })).status === 201, 'submit recorded')
  const approveReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).approveMilestone(BigInt(chainProjectId), BigInt(m1.chainMilestoneId), o))
  const approveRes = await restRetry('client', 'POST', `/api/milestones/${m1.id}/approvals`, { transactionHash: approveReceipt.hash })
  check(approveRes.status === 200, `approve -> HTTP ${approveRes.status}`)
  check(approveRes.body?.project?.status === 'COMPLETED', `project status=${approveRes.body?.project?.status}`)
  const onChain = await escrowFor(wallets.client).getProject(BigInt(chainProjectId))
  check(Number(onChain.status) === 6 && onChain.escrowBalance === 0n, `on-chain status=${onChain.status}, escrow drained`)
  const balanceAfter = await provider.getBalance(wallets.freelancer.address)
  check(balanceAfter > freelancerBalanceBefore, `freelancer balance increased by ${balanceAfter - freelancerBalanceBefore} wei (net of gas)`)
}

caseStart('A-07 audit tables record transactions and decoded events')
{
  const txs = await rest('client', 'GET', `/api/transactions?projectId=${project.id}`)
  const events = await rest('client', 'GET', `/api/events?projectId=${project.id}`)
  check(txs.status === 200 && txs.body.length >= 7, `${txs.body?.length} transaction records stored`)
  const names = new Set((events.body ?? []).map((e) => e.eventName))
  for (const expected of ['ProjectCreated', 'ProjectAccepted', 'ProjectFunded', 'MilestoneSubmitted', 'MilestoneApproved']) {
    check(names.has(expected), `event ${expected} recorded`)
  }
}

// Scenario NEG — receipt verification rejects an off-chain/on-chain hash mismatch.
// Isolated on a throwaway project: a mismatched submit succeeds on-chain but the backend
// refuses to record it (422), which deliberately leaves that project's chain/DB states diverged.
caseStart('NEG-01 backend rejects a milestone submit whose on-chain hash mismatches the REST body')
{
  const negInput = {
    title: 'E2E Hash Mismatch Guard',
    description: 'Member E negative scenario: off-chain text must hash-match the on-chain argument.',
    freelancerAddress: wallets.freelancer.address,
    totalAmountEth: '0.003',
    deadline: isoDate(14),
    milestones: [{ title: 'Only', description: 'Single milestone for the mismatch guard', amountEth: '0.003', dueDate: isoDate(14) }],
  }
  const createReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).createProjectWithMilestones(
    negInput.freelancerAddress, dateToUnix(negInput.deadline),
    hashJson({ title: negInput.title, description: negInput.description }),
    [parseEther('0.003')], [dateToUnix(negInput.deadline)],
    [hashJson({ title: 'Only', description: 'Single milestone for the mismatch guard' })],
    o,
  ))
  const created = await restRetry('client', 'POST', '/api/projects', { ...negInput, transactionHash: createReceipt.hash })
  check(created.status === 201, `create -> HTTP ${created.status}`)
  const negProject = created.body
  const negCid = BigInt(negProject.chainProjectId)
  const negMid = BigInt(negProject.milestones[0].chainMilestoneId)
  const acceptReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).acceptProject(negCid, o))
  await restRetry('freelancer', 'POST', `/api/projects/${negProject.id}/accept`, { transactionHash: acceptReceipt.hash })
  const fundReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).fundProject(negCid, { value: parseEther('0.003'), ...o }))
  await restRetry('client', 'POST', `/api/projects/${negProject.id}/fund`, { transactionHash: fundReceipt.hash })
  // on-chain submit carries a DIFFERENT note hash than the REST body claims
  const claimedNote = 'This is the note the REST body claims.'
  const wrongHashReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).submitMilestone(negCid, negMid, hashJson({ note: 'a totally different on-chain note', evidenceUrl: null }), o))
  const res = await restRetry('freelancer', 'POST', `/api/milestones/${negProject.milestones[0].id}/submissions`, { note: claimedNote, transactionHash: wrongHashReceipt.hash })
  check(res.status === 422 && res.body?.error?.code === 'TRANSACTION_ARGUMENT_MISMATCH',
    `mismatched deliverable hash -> HTTP ${res.status} code=${res.body?.error?.code} (expected 422 TRANSACTION_ARGUMENT_MISMATCH)`)
}

// --- 2. Scenario B: dispute flow with arbitrator -----------------------------------
const disputeInput = {
  title: 'E2E Dispute Flow',
  description: 'Member E formal end-to-end scenario B: reject, dispute, evidence, resolution.',
  freelancerAddress: wallets.freelancer.address,
  totalAmountEth: '0.02',
  deadline: isoDate(21),
  milestones: [
    { title: 'Backend', description: 'API implementation milestone', amountEth: '0.008', dueDate: isoDate(10) },
    { title: 'Docs', description: 'Technical documentation milestone', amountEth: '0.012', dueDate: isoDate(21) },
  ],
}
let disputeProject
let disputeChainProjectId
let disputedMilestone
let chainDisputeId
let disputeRecordId

caseStart('B-01 create, accept, fund the disputed project')
{
  const receipt = await send(wallets.client, (o) => escrowFor(wallets.client).createProjectWithMilestones(
    disputeInput.freelancerAddress, dateToUnix(disputeInput.deadline),
    hashJson({ title: disputeInput.title, description: disputeInput.description }),
    disputeInput.milestones.map((m) => parseEther(m.amountEth)),
    disputeInput.milestones.map((m) => dateToUnix(m.dueDate)),
    disputeInput.milestones.map((m) => hashJson({ title: m.title, description: m.description })),
    o,
  ))
  const created = await restRetry('client', 'POST', '/api/projects', { ...disputeInput, transactionHash: receipt.hash })
  check(created.status === 201, `create -> HTTP ${created.status}`)
  disputeProject = created.body
  disputeChainProjectId = disputeProject.chainProjectId
  const acceptReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).acceptProject(BigInt(disputeChainProjectId), o))
  await restRetry('freelancer', 'POST', `/api/projects/${disputeProject.id}/accept`, { transactionHash: acceptReceipt.hash })
  const fundReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).fundProject(BigInt(disputeChainProjectId), { value: parseEther(disputeInput.totalAmountEth), ...o }))
  const fundRes = await restRetry('client', 'POST', `/api/projects/${disputeProject.id}/fund`, { transactionHash: fundReceipt.hash })
  check(fundRes.body?.project?.status === 'ACTIVE', `status=${fundRes.body?.project?.status}`)
}

caseStart('B-02 submit, reject, resubmit, then Freelancer raises a dispute')
{
  disputedMilestone = disputeProject.milestones[0]
  const cid = BigInt(disputeChainProjectId)
  const mid = BigInt(disputedMilestone.chainMilestoneId)
  const submitNote = 'First backend delivery.'
  const submitReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).submitMilestone(cid, mid, hashJson({ note: submitNote, evidenceUrl: null }), o))
  await restRetry('freelancer', 'POST', `/api/milestones/${disputedMilestone.id}/submissions`, { note: submitNote, transactionHash: submitReceipt.hash })
  const reason = 'Missing authentication endpoints.'
  const rejectReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).rejectMilestone(cid, mid, hashJson({ reason }), o))
  const rejectRes = await restRetry('client', 'POST', `/api/milestones/${disputedMilestone.id}/rejections`, { reason, transactionHash: rejectReceipt.hash })
  check(rejectRes.status === 200, `reject -> HTTP ${rejectRes.status}`)
  const resubmitNote = 'Backend delivery v2 with auth.'
  const resubmitReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).resubmitMilestone(cid, mid, hashJson({ note: resubmitNote, evidenceUrl: null }), o))
  await restRetry('freelancer', 'POST', `/api/milestones/${disputedMilestone.id}/submissions`, { note: resubmitNote, transactionHash: resubmitReceipt.hash })
  const description = 'Work was delivered per specification v2.'
  const disputeReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).raiseDispute(cid, mid, hashJson({ description }), o))
  const disputeRes = await restRetry('freelancer', 'POST', '/api/disputes', { projectId: disputeProject.id, milestoneId: disputedMilestone.id, description, transactionHash: disputeReceipt.hash })
  check(disputeRes.status === 201, `raise dispute -> HTTP ${disputeRes.status}`)
  // Neither POST /api/disputes nor GET /api/disputes exposes chainDisputeId (mapDispute omits it),
  // so resolve it from the receipt exactly like the frontend does.
  chainDisputeId = disputeIdFromReceipt(disputeReceipt)
  disputeRecordId = disputeRes.body?.id
  check(Boolean(chainDisputeId), `on-chain disputeId parsed from receipt = ${chainDisputeId}`)
  note(`backend dispute record id=${disputeRecordId}`)
  const projectAfter = await rest('client', 'GET', `/api/projects/${disputeProject.id}`)
  check(projectAfter.body?.status === 'DISPUTED', `project status=${projectAfter.body?.status}`)
}

caseStart('B-03 dispute is listed, evidence submission works, outsiders blocked')
{
  const disputes = await rest('freelancer', 'GET', '/api/disputes')
  const listed = disputes.body?.find((d) => d.id === disputeRecordId)
  check(disputes.status === 200 && Boolean(listed), `GET /api/disputes lists record ${disputeRecordId} with status=${listed?.status}`)
  await expectRevert(disputeFor(wallets.client).resolveDispute.staticCall(BigInt(chainDisputeId), true, hashJson({ resolution: 'RELEASE_TO_FREELANCER' })), 'Client cannot resolve (onlyArbitrator)')
  const evidenceText = 'Screenshot of delivered endpoints and test run.'
  const evidenceReceipt = await send(wallets.freelancer, (o) => disputeFor(wallets.freelancer).submitEvidence(BigInt(chainDisputeId), hashJson({ evidence: evidenceText }), o))
  const evidenceRes = await restRetry('freelancer', 'POST', `/api/disputes/${disputeRecordId}/evidence`, { evidence: evidenceText, transactionHash: evidenceReceipt.hash })
  check(evidenceRes.status === 201, `evidence -> HTTP ${evidenceRes.status}`)
  await expectRevert(disputeFor(wallets.outsider).submitEvidence.staticCall(BigInt(chainDisputeId), hashJson({ evidence: 'nope' })), 'Outsider cannot submit evidence')
}

caseStart('B-04 Arbitrator resolves to freelancer; non-arbitrator session is refused')
{
  // resolution-record is gated by requireRole('ARBITRATOR'): a client session is refused with 403
  // before any receipt verification, even when handed the arbitrator's valid transaction hash.
  const resolveReceipt = await send(wallets.arbitrator, (o) => disputeFor(wallets.arbitrator).resolveDispute(BigInt(chainDisputeId), true, hashJson({ resolution: 'RELEASE_TO_FREELANCER' }), o))
  const wrongRole = await rest('client', 'POST', `/api/disputes/${disputeRecordId}/resolution-record`, { resolution: 'RELEASE_TO_FREELANCER', transactionHash: resolveReceipt.hash })
  check(wrongRole.status === 403 && wrongRole.body?.error?.code === 'FORBIDDEN_ROLE', `client session -> HTTP ${wrongRole.status} code=${wrongRole.body?.error?.code} (expected 403 FORBIDDEN_ROLE)`)
  const resolveRes = await restRetry('arbitrator', 'POST', `/api/disputes/${disputeRecordId}/resolution-record`, { resolution: 'RELEASE_TO_FREELANCER', transactionHash: resolveReceipt.hash })
  check(resolveRes.status === 200, `resolution recorded -> HTTP ${resolveRes.status}`)
  const projectAfter = await rest('client', 'GET', `/api/projects/${disputeProject.id}`)
  const milestone = projectAfter.body?.milestones?.find((m) => m.id === disputedMilestone.id)
  check(['RESOLVED', 'APPROVED'].includes(milestone?.status), `disputed milestone status=${milestone?.status}`)
  check(projectAfter.body?.status === 'ACTIVE', `project returns to ${projectAfter.body?.status}`)
}

// --- 3. Scenario C: cancellation before work begins --------------------------------
caseStart('C-01 Client cancels an unfunded-created project')
{
  const cancelInput = {
    title: 'E2E Cancel Flow',
    description: 'Member E scenario C: cancellation before work begins.',
    freelancerAddress: wallets.freelancer.address,
    totalAmountEth: '0.005',
    deadline: isoDate(30),
    milestones: [{ title: 'Only', description: 'Single milestone project', amountEth: '0.005', dueDate: isoDate(30) }],
  }
  const receipt = await send(wallets.client, (o) => escrowFor(wallets.client).createProjectWithMilestones(
    cancelInput.freelancerAddress, dateToUnix(cancelInput.deadline),
    hashJson({ title: cancelInput.title, description: cancelInput.description }),
    [parseEther('0.005')], [dateToUnix(cancelInput.deadline)],
    [hashJson({ title: 'Only', description: 'Single milestone project' })],
    o,
  ))
  const created = await restRetry('client', 'POST', '/api/projects', { ...cancelInput, transactionHash: receipt.hash })
  check(created.status === 201, `create -> HTTP ${created.status}`)
  const before = await provider.getBalance(wallets.client.address)
  const cancelReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).cancelProject(BigInt(created.body.chainProjectId), o))
  const cancelRes = await restRetry('client', 'POST', `/api/projects/${created.body.id}/cancel`, { transactionHash: cancelReceipt.hash })
  check(cancelRes.status === 200 && cancelRes.body?.project?.status === 'CANCELLED', `cancel -> HTTP ${cancelRes.status}, status=${cancelRes.body?.project?.status}`)
  const onChain = await escrowFor(wallets.client).getProject(BigInt(created.body.chainProjectId))
  // ProjectStatus enum: None0 Created1 Accepted2 Funded3 Active4 Disputed5 Completed6 Cancelled7
  check(Number(onChain.status) === 7, `on-chain status=${onChain.status} (7 = CANCELLED)`)
  const after = await provider.getBalance(wallets.client.address)
  note(`client balance delta after cancel (gas only, nothing was escrowed): ${after - before} wei`)
}

// --- 4. summary ---------------------------------------------------------------------
const passed = results.filter((r) => r.status === 'pass').length
const failed = results.length - passed
console.log('\n== results ==')
for (const r of results) {
  console.log(`${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.name}`)
  for (const d of r.details) console.log(`        ${d}`)
}
console.log(`\n${passed}/${results.length} cases passed, ${failed} failed | backend timing retries: ${timingRetries}`)
writeFileSync(new URL('./e2e-results.json', import.meta.url), JSON.stringify({ ranAt: new Date().toISOString(), api: API, rpc: RPC, passed, failed, timingRetries, results }, null, 2))
process.exitCode = failed === 0 ? 0 : 1
