/**
 * Shared GraphQL SDL fragments for reuse across services.
 * Single source of truth for common field patterns (spec-aligned, no duplication).
 *
 * CODING_STANDARDS § GraphQL: "use timestampFieldsSDL() / timestampFieldsRequiredSDL() from core
 * so SDL is a single source of truth."
 *
 * Usage:
 *   type X { id: ID! ... ${timestampFieldsSDL()} }
 *   type Y { ... ${buildSagaResultTypeSDL('CreateWalletResult', 'wallet', 'Wallet')} }
 *   extend type Query { items(${paginationArgsSDL()}): ItemConnection! }
 */

// ═══════════════════════════════════════════════════════════════════
// Timestamp Fields
// ═══════════════════════════════════════════════════════════════════

const TIMESTAMP_SDL = {
  default: 'createdAt: String!\n    updatedAt: String',
  required: 'createdAt: String!\n    updatedAt: String!',
  optional: 'createdAt: String\n    updatedAt: String',
} as const;

/** createdAt required, updatedAt optional (default pattern for most entities). */
export function timestampFieldsSDL(): string {
  return TIMESTAMP_SDL.default;
}

/** Both createdAt and updatedAt required (e.g. User, ConfigEntry, Webhook). */
export function timestampFieldsRequiredSDL(): string {
  return TIMESTAMP_SDL.required;
}

/** Both createdAt and updatedAt optional (e.g. KYC profiles/documents, bonus templates). */
export function timestampFieldsOptionalSDL(): string {
  return TIMESTAMP_SDL.optional;
}

// ═══════════════════════════════════════════════════════════════════
// Saga Result Type
// ═══════════════════════════════════════════════════════════════════

/**
 * Build SDL for a standard saga result type.
 *
 * Base fields: success, sagaId, errors, executionTimeMs.
 * The entity field is named after entityFieldName with type entityTypeName.
 *
 * @param resultName   - e.g. "CreateWalletResult"
 * @param entityField  - e.g. "wallet" (lowercase entity name in result)
 * @param entityType   - e.g. "Wallet" (GraphQL type name)
 * @param extraFields  - optional extra SDL fields (e.g. "debitTransaction: Transaction")
 * @returns SDL string  e.g. "type CreateWalletResult { success: Boolean! wallet: Wallet sagaId: ID! ... }"
 */
export function buildSagaResultTypeSDL(
  resultName: string,
  entityField: string,
  entityType: string,
  extraFields?: string
): string {
  const extra = extraFields ? ` ${extraFields}` : '';
  return `type ${resultName} { success: Boolean! ${entityField}: ${entityType}${extra} sagaId: ID! errors: [String!] executionTimeMs: Int }`;
}

// ═══════════════════════════════════════════════════════════════════
// Pagination Args
// ═══════════════════════════════════════════════════════════════════

/** Standard cursor-based pagination arguments for GraphQL queries. */
export function paginationArgsSDL(): string {
  return 'first: Int, after: String, last: Int, before: String';
}

// ═══════════════════════════════════════════════════════════════════
// Connection Type
// ═══════════════════════════════════════════════════════════════════

/**
 * Build SDL for a cursor-style connection type (nodes + totalCount + pageInfo).
 * PageInfo is defined in the gateway base schema.
 *
 * @param connectionName - e.g. "WalletConnection"
 * @param nodeTypeName - e.g. "Wallet"
 * @returns SDL string  e.g. "type WalletConnection { nodes: [Wallet!]! totalCount: Int! pageInfo: PageInfo! }"
 */
export function buildConnectionTypeSDL(connectionName: string, nodeTypeName: string): string {
  return `type ${connectionName} { nodes: [${nodeTypeName}!]! totalCount: Int! pageInfo: PageInfo! }`;
}
