import localDeployment from '../contracts/localhost.json'

const value = (name: string, fallback: string): string => (import.meta.env[name] as string | undefined) || fallback
export const env = {
  apiBaseUrl: value('VITE_API_BASE_URL', 'http://localhost:3001').replace(/\/$/, ''),
  chainId: value('VITE_CHAIN_ID', `0x${localDeployment.chainId.toString(16)}`).toLowerCase(),
  rpcUrl: value('VITE_RPC_URL', 'http://127.0.0.1:8545'),
  roleManagerAddress: value('VITE_ROLE_MANAGER_ADDRESS', localDeployment.contracts.RoleManager.address),
  projectEscrowAddress: value('VITE_PROJECT_ESCROW_ADDRESS', localDeployment.contracts.ProjectEscrow.address),
  disputeManagerAddress: value('VITE_DISPUTE_MANAGER_ADDRESS', localDeployment.contracts.DisputeManager.address),
}
