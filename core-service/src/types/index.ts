/**
 * Shared Types
 * 
 * All types used across the core-service library and microservices
 * Import from 'core-service'
 */

// ═══════════════════════════════════════════════════════════════════
// Common Types (shared across all services)
// ═══════════════════════════════════════════════════════════════════

export type {
  BaseEntity,
  UserEntity,
  VerificationLevel,
  TriggeredBy,
  BasicStatus,
  OperationStatus,
  StatusHistoryEntry,
  Domain,
  DomainConfig,
  Category,
  ValueType,
  BalanceType,
  TransactionDirection,
  TimePeriod,
  TimePeriodConfig,
  LimitConfig,
  PageInfo,
  Connection,
} from './common.js';
export { CATEGORIES } from './common.js';

// ═══════════════════════════════════════════════════════════════════
// Auth & Permissions
// ═══════════════════════════════════════════════════════════════════

export type {
  UserContext,
  JwtConfig,
  TokenPair,
  Permission,
  PermissionRule,
  PermissionMap,
} from './auth.js';

// ═══════════════════════════════════════════════════════════════════
// Repository
// ═══════════════════════════════════════════════════════════════════

export type {
  WriteOptions,
  Repository,
  FindManyOptions,
  CursorPaginationOptions,
  CursorPaginationResult,
  IndexConfig,
  CacheTTLConfig,
  RepositoryOptions,
  TimestampConfig,
} from './repository.js';

// ═══════════════════════════════════════════════════════════════════
// Resolvers (GraphQL)
// ═══════════════════════════════════════════════════════════════════

export type {
  ResolverContext,
  Resolver,
  Resolvers,
  SubscriptionResolver,
} from './resolvers.js';

// ═══════════════════════════════════════════════════════════════════
// Currency (configurable registry)
// ═══════════════════════════════════════════════════════════════════

export type { Currency, BuiltInCurrency, CurrencyConfig } from './currency.js';
export {
  // Registry functions
  registerCurrency,
  registerCurrencies,
  unregisterCurrency,
  clearCurrencies,
  initializeDefaultCurrencies,
  // Query functions
  getCurrency,
  getAllCurrencies,
  getCurrencyCodes,
  getFiatCurrencies,
  getCryptoCurrencies,
  // Validation
  isCurrencyRegistered,
  isValidCurrency,
  isCrypto,
  isFiat,
  // Amount helpers
  toSmallestUnit,
  fromSmallestUnit,
  formatCurrency,
} from './currency.js';

// ═══════════════════════════════════════════════════════════════════
// References (cross-service linking) - Generic types only
// Domain-specific types (WalletReference, BonusReference, etc.) 
// should be defined in their respective services
// ═══════════════════════════════════════════════════════════════════

export type {
  UserReference,
  ServiceResponse,
} from './references.js';
export { successResponse, errorResponse } from './references.js';

