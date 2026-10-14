export type Role = 'CLIENT' | 'FREELANCER' | 'ARBITRATOR'
export type ProjectStatus = 'CREATED' | 'ACCEPTED' | 'FUNDED' | 'ACTIVE' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED'
export type MilestoneStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'REJECTED' | 'APPROVED' | 'DISPUTED' | 'RESOLVED'
export type TxStatus = 'CONFIRMED' | 'PENDING' | 'FAILED'

export interface AuthUser { wallet: string; role: Role; roles: Role[]; displayName: string }
export interface Milestone { id: string; projectId: string; chainMilestoneId: string; title: string; description: string; amountEth: string; dueDate: string; status: MilestoneStatus; submissionNote?: string; rejectionReason?: string }
export interface Project { id: string; chainProjectId: string; title: string; description: string; clientAddress: string; clientName?: string; freelancerAddress: string; freelancerName?: string; totalAmountEth: string; deadline: string; status: ProjectStatus; funded: boolean; milestones: Milestone[] }
export interface Dispute { id: string; projectId: string; milestoneId: string; chainDisputeId: string; raisedBy: Role; raisedByAddress: string; description: string; status: 'OPEN' | 'RESOLVED'; createdAt: string; amountEth: string; resolution?: 'RELEASE_TO_FREELANCER' | 'REFUND_TO_CLIENT'; resolutionTransactionHash?: string; resolvedAt?: string }
export interface Transaction { id: string; type: string; projectId: string; user: string; amountEth?: string; timestamp: string; status: TxStatus; hash: string }
export interface ChainEvent { id: string; eventName: string; projectId: string; actor: string; details: string; timestamp: string; txHash: string }
export interface Dashboard { role: Role; roles: Role[]; projectCount: number; activeProjects: number; completedProjects: number; openDisputes: number; submittedMilestones: number; escrowAmountEth: string; releasedAmountEth: string }
export interface CreateProjectInput { title: string; description: string; freelancerAddress: string; totalAmountEth: string; deadline: string; milestones: Array<{ title: string; description: string; amountEth: string; dueDate: string }> }
export type TransactionStage = 'IDLE' | 'WAITING_FOR_SIGNATURE' | 'TRANSACTION_SUBMITTED' | 'WAITING_FOR_CONFIRMATION' | 'BACKEND_RECORDING' | 'SUCCESS' | 'USER_REJECTED' | 'CONTRACT_FAILED' | 'BACKEND_VERIFICATION_FAILED' | 'NETWORK_ERROR'
