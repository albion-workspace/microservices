/**
 * GraphQL Connection type SDL builder
 *
 * Produces the standard connection type SDL used across services:
 * type {connectionName} { nodes: [{nodeTypeName}!]! totalCount: Int! pageInfo: PageInfo! }
 * PageInfo is defined in the gateway base schema.
 */

/**
 * Build SDL for a cursor-style connection type (nodes + totalCount + pageInfo).
 *
 * @param connectionName - e.g. "WalletConnection"
 * @param nodeTypeName - e.g. "Wallet"
 * @returns SDL string to append to schema (e.g. "type WalletConnection { nodes: [Wallet!]! totalCount: Int! pageInfo: PageInfo! }")
 */
export function buildConnectionTypeSDL(connectionName: string, nodeTypeName: string): string {
  return `type ${connectionName} { nodes: [${nodeTypeName}!]! totalCount: Int! pageInfo: PageInfo! }`;
}
