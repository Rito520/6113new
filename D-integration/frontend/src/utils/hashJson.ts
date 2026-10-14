import { keccak256, toUtf8Bytes } from 'ethers'

/** Canonical B/C hash: property declaration order is deliberately preserved. */
export const hashJson = (value: unknown): string => keccak256(toUtf8Bytes(JSON.stringify(value)))
export const dateToUnix = (date: string): bigint => BigInt(Date.parse(`${date}T00:00:00Z`) / 1000)
