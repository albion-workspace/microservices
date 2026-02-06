/**
 * Wallet normalization for GraphQL and consistent balance handling
 *
 * Ensures balance fields are never null/undefined when returned to API clients.
 * Use for single wallet or for list results: nodes.map(normalizeWalletForGraphQL)
 */

/**
 * Normalize wallet balance fields to numbers (null/undefined → 0).
 * Use for GraphQL responses so clients always receive numeric balances.
 *
 * @param wallet - Wallet-like object (from DB or resolver)
 * @returns New object with balance, bonusBalance, lockedBalance, lifetimeFees as numbers
 */
export function normalizeWalletForGraphQL<T extends Record<string, unknown>>(
  wallet: T
): T & { balance: number; bonusBalance: number; lockedBalance: number; lifetimeFees: number } {
  return {
    ...wallet,
    balance: (wallet.balance as number | null | undefined) ?? 0,
    bonusBalance: (wallet.bonusBalance as number | null | undefined) ?? 0,
    lockedBalance: (wallet.lockedBalance as number | null | undefined) ?? 0,
    lifetimeFees: (wallet.lifetimeFees as number | null | undefined) ?? 0,
  };
}
