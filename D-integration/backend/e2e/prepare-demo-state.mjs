/**
 * Member E — one-command demo state preparation.
 *
 * Creates exactly the two projects the 5-minute live demo needs, so nothing has to be
 * typed on stage:
 *   P1 "Demo Website"         -> ACTIVE, funded 0.01 ETH, both milestones PENDING
 *                                (demo: Freelancer submits -> Client approves -> paid)
 *   P2 "Demo Dispute Project" -> ACTIVE, funded 0.005 ETH, milestone REJECTED with a reason
 *                                (demo: Freelancer raises dispute -> Arbitrator resolves)
 *
 * Prerequisites: Hardhat node running, contracts deployed with SEED_DEMO=true,
 * backend running with CHAIN_MODE=evm, and a FRESH database (see the reset procedure).
 *
 * Run:  cd backend && node e2e/prepare-demo-state.mjs
 *
 * LOCAL DEVELOPMENT ONLY — uses the publicly documented Hardhat test keys, never real funds.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Contract, JsonRpcProvider, Wallet, keccak256, parseEther, toUtf8Bytes } from 'ethers'

const API = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001'
const RPC = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8546'

const KEYS = {
  client: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  freelancer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
}
const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true })
const wallets = Object.fromEntries(Object.entries(KEYS).map(([r, k]) => [r, new Wallet(k, provider)]))

const contractsDir = path.resolve(process.cwd(), '..', 'contracts')
const deployed = JSON.parse(readFileSync(path.join(contractsDir, 'deployments/localhost.json'), 'utf8'))
const abi = (name) => JSON.parse(readFileSync(path.join(contractsDir, 'deployments/abi', `${name}.json`), 'utf8'))
const escrowFor = (w) => new Contract(deployed.contracts.ProjectEscrow.address, abi('ProjectEscrow'), w)

const hashJson = (v) => keccak256(toUtf8Bytes(JSON.stringify(v)))
const dateToUnix = (d) => BigInt(Date.parse(`${d}T00:00:00Z`) / 1000)
const isoDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const nonces = new Map()
const send = async (wallet, factory) => {
  let nonce = nonces.get(wallet.address)
  if (nonce === undefined) nonce = BigInt(await provider.getTransactionCount(wallet.address, 'latest'))
  const tx = await factory({ nonce })
  const receipt = await tx.wait()
  nonces.set(wallet.address, nonce + 1n)
  if (receipt?.status !== 1) throw new Error('contract transaction reverted')
  return receipt
}

const sessions = {}
async function login(role) {
  const wallet = wallets[role]
  const nonceRes = await fetch(`${API}/api/auth/nonce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet.address }) })
  const nonceBody = await nonceRes.json()
  if (!nonceRes.ok) throw new Error(`nonce failed for ${role}: ${nonceRes.status} ${JSON.stringify(nonceBody)}`)
  const signature = await wallet.signMessage(nonceBody.message)
  const verifyRes = await fetch(`${API}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: wallet.address, signature }) })
  const verifyBody = await verifyRes.json()
  if (!verifyRes.ok) throw new Error(`verify failed for ${role}: ${verifyRes.status}`)
  sessions[role] = verifyBody.token
}
async function rest(role, method, pathname, body) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(sessions[role] ? { Authorization: `Bearer ${sessions[role]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json().catch(() => undefined)
  return { status: response.status, body: json }
}
// Retry while the backend answers with a pure timing code (safe: it throws before any DB write).
const TIMING = new Set(['TRANSACTION_NOT_MINED', 'INSUFFICIENT_CONFIRMATIONS'])
async function record(role, method, pathname, body, what) {
  let res = await rest(role, method, pathname, body)
  for (let i = 0; i < 8 && res.status === 409 && TIMING.has(res.body?.error?.code); i++) {
    await sleep(2500)
    res = await rest(role, method, pathname, body)
  }
  if (res.status >= 400) throw new Error(`${what} failed: HTTP ${res.status} ${JSON.stringify(res.body?.error ?? res.body)}`)
  console.log(`  ok  ${what} -> ${res.status}`)
  return res.body
}

async function createProject(input) {
  const receipt = await send(wallets.client, (o) => escrowFor(wallets.client).createProjectWithMilestones(
    input.freelancerAddress, dateToUnix(input.deadline),
    hashJson({ title: input.title, description: input.description }),
    input.milestones.map((m) => parseEther(m.amountEth)),
    input.milestones.map((m) => dateToUnix(m.dueDate)),
    input.milestones.map((m) => hashJson({ title: m.title, description: m.description })),
    o,
  ))
  const created = await record('client', 'POST', '/api/projects', { ...input, transactionHash: receipt.hash }, `create "${input.title}"`)
  return created
}
async function acceptAndFund(project) {
  const cid = BigInt(project.chainProjectId)
  const acceptReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).acceptProject(cid, o))
  await record('freelancer', 'POST', `/api/projects/${project.id}/accept`, { transactionHash: acceptReceipt.hash }, 'accept')
  const fundReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).fundProject(cid, { value: parseEther(project.totalAmountEth), ...o }))
  const funded = await record('client', 'POST', `/api/projects/${project.id}/fund`, { transactionHash: fundReceipt.hash }, 'fund')
  return funded.project
}

console.log('== preparing demo state ==')
console.log(`API ${API} | RPC ${RPC}`)
const health = await (await fetch(`${API}/health`)).json()
if (health.chainMode !== 'evm') throw new Error(`backend is in "${health.chainMode}" mode; CHAIN_MODE=evm is required`)

await login('client')
await login('freelancer')
console.log('  ok  both demo wallets logged in')

// ---- Project 1: ready for submit -> approve -----------------------------------------
console.log('\n[P1] Demo Website (ACTIVE, milestones PENDING)')
const p1Input = {
  title: 'Demo Website',
  description: 'Landing page and logo for the demo store.',
  freelancerAddress: wallets.freelancer.address,
  totalAmountEth: '0.01',
  deadline: isoDate(14),
  milestones: [
    { title: 'Design', description: 'Logo and landing page design', amountEth: '0.004', dueDate: isoDate(7) },
    { title: 'Launch', description: 'Production launch and handover', amountEth: '0.006', dueDate: isoDate(14) },
  ],
}
const p1 = await acceptAndFund(await createProject(p1Input))
console.log(`  -> ${p1.id} chain #${p1.chainProjectId} status=${p1.status}`)

// ---- Project 2: ready for raise dispute ---------------------------------------------
console.log('\n[P2] Demo Dispute Project (ACTIVE, milestone REJECTED)')
const p2Input = {
  title: 'Demo Dispute Project',
  description: 'Second project used to demonstrate the dispute flow.',
  freelancerAddress: wallets.freelancer.address,
  totalAmountEth: '0.005',
  deadline: isoDate(21),
  milestones: [{ title: 'Backend API', description: 'API implementation milestone', amountEth: '0.005', dueDate: isoDate(21) }],
}
const p2 = await acceptAndFund(await createProject(p2Input))
const p2m = p2.milestones[0]
const cid2 = BigInt(p2.chainProjectId)
const mid2 = BigInt(p2m.chainMilestoneId)
const submitNote = 'First backend delivery.'
const submitReceipt = await send(wallets.freelancer, (o) => escrowFor(wallets.freelancer).submitMilestone(cid2, mid2, hashJson({ note: submitNote, evidenceUrl: null }), o))
await record('freelancer', 'POST', `/api/milestones/${p2m.id}/submissions`, { note: submitNote, transactionHash: submitReceipt.hash }, 'submit')
const reason = 'Missing authentication endpoints.'
const rejectReceipt = await send(wallets.client, (o) => escrowFor(wallets.client).rejectMilestone(cid2, mid2, hashJson({ reason }), o))
await record('client', 'POST', `/api/milestones/${p2m.id}/rejections`, { reason, transactionHash: rejectReceipt.hash }, 'reject')
const p2Final = (await rest('client', 'GET', `/api/projects/${p2.id}`)).body
console.log(`  -> ${p2Final.id} chain #${p2Final.chainProjectId} status=${p2Final.status} milestone=${p2Final.milestones[0].status}`)

console.log('\n== demo state ready ==')
console.log(`P1 ${p1.id} "Demo Website"          -> open it as Freelancer and click "Submit milestone"`)
console.log(`P2 ${p2Final.id} "Demo Dispute Project" -> open it as Freelancer and click "Raise dispute"`)
console.log('Do NOT restart the Hardhat node or reset the database before the demo.')
