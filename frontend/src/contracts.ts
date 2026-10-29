import { Contract, ethers } from 'ethers'

const zeroAddress = '0x0000000000000000000000000000000000000000'

export const addresses = {
  savingCore: import.meta.env.VITE_SAVING_CORE_ADDRESS || zeroAddress,
  mockUSDC: import.meta.env.VITE_MOCK_USDC_ADDRESS || zeroAddress,
  vaultManager: import.meta.env.VITE_VAULT_MANAGER_ADDRESS || zeroAddress,
}

export const savingCoreAbi = [
  'function getActivePlans() view returns (uint256[])',
  'function getUserDeposits(address user) view returns (uint256[])',
  'function plans(uint256) view returns (uint256 aprBps, uint256 penaltyBps, uint256 tenorDays, uint256 minDeposit, uint256 maxDeposit, bool isEnabled)',
  'function deposits(uint256) view returns (address owner, uint256 planId, uint256 principal, uint256 aprBpsAtOpen, uint256 penaltyBpsAtOpen, uint256 openTimestamp, uint256 maturityAt, uint8 status)',
  'function calculateInterest(uint256 depositId) view returns (uint256)',
  'function openDeposit(uint256 planId, uint256 amount)',
  'function withdrawAtMaturity(uint256 depositId)',
  'function earlyWithdraw(uint256 depositId)',
  'function renewDeposit(uint256 depositId, uint256 newPlanId) returns (uint256)',
] as const

export const mockUsdcAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

export type SavingCoreContract = Contract & {
  getActivePlans(): Promise<bigint[]>
  getUserDeposits(user: string): Promise<bigint[]>
}

export const usdcUnit = 10n ** 6n

export function savingCoreContract(provider: ethers.Provider | ethers.Signer) {
  return new Contract(addresses.savingCore, savingCoreAbi, provider) as SavingCoreContract
}

export function mockUsdcContract(provider: ethers.Provider | ethers.Signer) {
  return new Contract(addresses.mockUSDC, mockUsdcAbi, provider)
}

export function formatUsdc(value: bigint) {
  return ethers.formatUnits(value, 6)
}

export function parseUsdc(value: string) {
  return ethers.parseUnits(value || '0', 6)
}

export function formatAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function formatApr(value: bigint) {
  return `${(Number(value) / 100).toFixed(2)}%`
}
