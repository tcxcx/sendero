/**
 * Address case canonicalization. EVM addresses are case-insensitive
 * hex — convention is lowercase. Solana base58 addresses are
 * case-sensitive — lowercasing breaks `CircleWallet.address` lookups
 * because the row is stored case-preserved.
 *
 * Use this everywhere a hex-or-base58 address flows through a DB query
 * or URL param. Don't `.toLowerCase()` raw.
 */

export function canonicalizeAddress(address: string): string {
  return address.startsWith('0x') ? address.toLowerCase() : address;
}
