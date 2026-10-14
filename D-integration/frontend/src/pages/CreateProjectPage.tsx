import { FormEvent, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../services/api'
import { chain } from '../services/blockchain/contracts'
import { useTransaction } from '../hooks/useTransaction'
import type { CreateProjectInput, Role } from '../types/domain'
import { ETH_AMOUNT_PATTERN, hasExactEthTotal, isValidEthAmount } from '../utils/ethAmount'

type Draft = { title: string; description: string; amountEth: string; dueDate: string }
const blank = (): Draft => ({ title: '', description: '', amountEth: '', dueDate: '' })

export function CreateProjectPage() {
  const navigate = useNavigate()
  const { role, session } = useOutletContext<{ role: Role; session: { user?: unknown } }>()
  const [drafts, setDrafts] = useState<Draft[]>([blank()])
  const [error, setError] = useState<string>()
  const tx = useTransaction()
  const update = (index: number, field: keyof Draft, value: string) => setDrafts((current) => current.map((draft, itemIndex) => itemIndex === index ? { ...draft, [field]: value } : draft))

  if (!session.user || role !== 'CLIENT') return <section className="panel empty">Only a signed-in wallet using its Client role can create a project.</section>

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const totalAmountEth = String(form.get('amount'))
    const input: CreateProjectInput = {
      title: String(form.get('title')),
      description: String(form.get('description')),
      freelancerAddress: String(form.get('freelancerAddress')),
      totalAmountEth,
      deadline: String(form.get('deadline')),
      milestones: drafts,
    }

    if (!drafts.every((milestone) => milestone.title && milestone.description && milestone.amountEth && milestone.dueDate)) return setError('Complete every milestone.')
    if (!isValidEthAmount(totalAmountEth) || !drafts.every((milestone) => isValidEthAmount(milestone.amountEth))) {
      return setError('Amounts must use positive standard ETH decimal notation, for example 0.01 or 1.5 (up to 18 decimal places).')
    }
    if (!hasExactEthTotal(totalAmountEth, drafts.map((milestone) => milestone.amountEth))) {
      return setError('Milestone amounts must exactly equal the total payment.')
    }

    setError(undefined)
    const ok = await tx.run(() => chain.createProject(input), (hash) => api.createProject({ ...input, transactionHash: hash }))
    if (ok) {
      const projects = await api.projects()
      const created = projects.find((project) => project.title === input.title && project.deadline === input.deadline)
      navigate(created ? `/projects/${created.id}` : '/projects')
    }
  }

  return <>
    <div className="page-intro"><div><h2>Create project</h2><p>MetaMask creates the project and milestones first; the backend only saves it after receipt verification.</p></div></div>
    {(error || tx.message) && <div className={`notice ${error || tx.stage.includes('FAILED') ? 'error' : ''}`}>{error ?? tx.message}</div>}
    <form className="panel form-grid" onSubmit={(event) => void submit(event)}>
      <label>Project title<input name="title" minLength={2} maxLength={120} required /></label>
      <label>Freelancer wallet address<input name="freelancerAddress" required placeholder="0x…" /></label>
      <label className="wide">Project description<textarea name="description" minLength={5} maxLength={5000} required /></label>
      <label>Total payment (ETH)<input name="amount" inputMode="decimal" pattern={ETH_AMOUNT_PATTERN} required /></label>
      <label>Project deadline<input name="deadline" type="date" required /></label>
      {drafts.map((milestone, index) => <fieldset className="wide" key={index}>
        <legend>Milestone {index + 1}</legend>
        <div className="milestone-form">
          <label>Title<input minLength={2} maxLength={120} value={milestone.title} onChange={(event) => update(index, 'title', event.target.value)} required /></label>
          <label>Amount (ETH)<input inputMode="decimal" pattern={ETH_AMOUNT_PATTERN} value={milestone.amountEth} onChange={(event) => update(index, 'amountEth', event.target.value)} required /></label>
          <label>Due date<input type="date" value={milestone.dueDate} onChange={(event) => update(index, 'dueDate', event.target.value)} required /></label>
          <label className="form-wide">Description<textarea minLength={2} maxLength={2000} value={milestone.description} onChange={(event) => update(index, 'description', event.target.value)} required /></label>
        </div>
        {drafts.length > 1 && <button type="button" className="text-button" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove milestone</button>}
      </fieldset>)}
      <div className="wide form-actions"><button type="button" className="secondary" onClick={() => setDrafts((current) => [...current, blank()])}>+ Add milestone</button><button className="primary" disabled={tx.busy}>{tx.busy ? tx.message : 'Create project with MetaMask'}</button></div>
    </form>
  </>
}
