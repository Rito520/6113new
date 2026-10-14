import { env } from '../../config/env'
import type { AuthUser, ChainEvent, CreateProjectInput, Dashboard, Dispute, Project, Transaction } from '../../types/domain'

export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) } }
let token: string | undefined
export const setSessionToken = (next?: string) => { token = next; if (next) sessionStorage.setItem('sc6113-token', next); else sessionStorage.removeItem('sc6113-token') }
export const restoreSessionToken = () => { token = sessionStorage.getItem('sc6113-token') ?? undefined; return token }
const validationMessage = (message: string, details: unknown): string => {
  const issue = Array.isArray(details) ? details[0] as { path?: unknown[]; message?: string } : undefined
  return issue?.path && issue.message ? `${message} Field ${issue.path.join('.')}: ${issue.message}` : message
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`${env.apiBaseUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) {
      const code = body?.error?.code ?? `HTTP_${response.status}`
      const details = body?.error?.details
      const message = validationMessage(body?.error?.message ?? `Request failed (${response.status}).`, details)
      // Development-only diagnostic context; no Bearer token is logged.
      console.error('[SC6113 API request failed]', { path, method: options.method ?? 'GET', status: response.status, code, message, details, requestBody: options.body })
      throw new ApiError(response.status, code, message, details)
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'The backend is unavailable. Check that it is running and CORS is configured for this frontend.')
  }
}
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const api = {
  health: () => request<{ status: string; chainMode: string }>('/health'), nonce: (wallet: string) => post<{ wallet: string; message: string; expiresAt: string }>('/api/auth/nonce', { wallet }), verify: (wallet: string, signature: string) => post<{ token: string; expiresAt: string; user: AuthUser }>('/api/auth/verify', { wallet, signature }), me: () => request<AuthUser>('/api/me'), dashboard: () => request<Dashboard>('/api/dashboard'),
  projects: () => request<Project[]>('/api/projects'), project: (id: string) => request<Project>(`/api/projects/${id}`), createProject: (data: CreateProjectInput & { transactionHash: string }) => post<Project>('/api/projects', data), accept: (id: string, transactionHash: string) => post<{ project: Project }>(`/api/projects/${id}/accept`, { transactionHash }), fund: (id: string, transactionHash: string) => post<{ project: Project }>(`/api/projects/${id}/fund`, { transactionHash }), cancel: (id: string, transactionHash: string) => post<{ project: Project }>(`/api/projects/${id}/cancel`, { transactionHash }), start: (id: string, transactionHash: string) => post<{ project: Project }>(`/api/milestones/${id}/start`, { transactionHash }), submit: (id: string, note: string, evidenceUrl: string | null, transactionHash: string) => post<{ project: Project }>(`/api/milestones/${id}/submissions`, { note, ...(evidenceUrl ? { evidenceUrl } : {}), transactionHash }), reject: (id: string, reason: string, transactionHash: string) => post<{ project: Project }>(`/api/milestones/${id}/rejections`, { reason, transactionHash }), approve: (id: string, transactionHash: string) => post<{ project: Project }>(`/api/milestones/${id}/approvals`, { transactionHash }),
  disputes: async () => { const [raw, projects, events] = await Promise.all([request<Array<Omit<Dispute, 'chainDisputeId'> & { chainDisputeId?: string }>>('/api/disputes'), request<Project[]>('/api/projects'), request<ChainEvent[]>('/api/events')]); return raw.map((dispute) => { const milestone = projects.find((project) => project.id === dispute.projectId)?.milestones.find((item) => item.id === dispute.milestoneId); const matchingEvent = events.find((event) => { try { const args = JSON.parse(event.details).args; return event.eventName === 'DisputeRaised' && String(args.projectId) === projects.find((project) => project.id === dispute.projectId)?.chainProjectId && String(args.milestoneIndex) === milestone?.chainMilestoneId } catch { return false } }); let chainDisputeId = dispute.chainDisputeId; try { chainDisputeId ??= String(JSON.parse(matchingEvent?.details ?? '{}').args?.disputeId ?? '') } catch { /* backend will prevent a malformed record from being resolved */ } return { ...dispute, chainDisputeId: chainDisputeId || '' } }) }, raiseDispute: (projectId: string, milestoneId: string, description: string, transactionHash: string) => post<Dispute>('/api/disputes', { projectId, milestoneId, description, transactionHash }), evidence: (id: string, evidence: string, transactionHash: string) => post(`/api/disputes/${id}/evidence`, { evidence, transactionHash }), resolve: (id: string, resolution: 'RELEASE_TO_FREELANCER' | 'REFUND_TO_CLIENT', transactionHash: string) => post<Dispute>(`/api/disputes/${id}/resolution-record`, { resolution, transactionHash }), transactions: (projectId?: string) => request<Transaction[]>(`/api/transactions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`), events: (projectId?: string) => request<ChainEvent[]>(`/api/events${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
}
