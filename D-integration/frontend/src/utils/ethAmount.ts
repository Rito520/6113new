import { parseEther } from 'ethers'

// Standard positive decimal notation: at most 18 fractional digits is enforced by parseEther.
export const ETH_AMOUNT_PATTERN = '^(?:0\\.(?:[0-9]*[1-9][0-9]*)|[1-9][0-9]*(?:\\.[0-9]+)?)$'

export const isValidEthAmount = (value: string): boolean => {
  if (!new RegExp(ETH_AMOUNT_PATTERN).test(value)) return false
  try {
    return parseEther(value) > 0n
  } catch {
    return false
  }
}

export const hasExactEthTotal = (total: string, amounts: string[]): boolean => {
  try {
    return parseEther(total) === amounts.reduce((sum, amount) => sum + parseEther(amount), 0n)
  } catch {
    return false
  }
}
