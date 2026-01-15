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
// Events (cross-service communication)
// ═══════════════════════════════════════════════════════════════════

// Example event data types (services can define their own)
export type {
  DepositCompletedData,
  WithdrawalCompletedData,
  BonusCreditedData,
  BonusConvertedData,
  BonusForfeitedData,
  UserRegisteredData,
  UserVerifiedData,
} from './events.js';

// Legacy event types (deprecated - use emit<T>() with IntegrationEvent<T>)
export type {
  BaseEvent,
  IntegrationEvent,
  DepositCompletedEvent,
  WithdrawalCompletedEvent,
  WithdrawalRequestedEvent,
  BonusCreditedEvent,
  BonusConvertedEvent,
  BonusForfeitedEvent,
  TurnoverCompletedEvent,
  TurnoverProgressEvent,
  WageringCompletedEvent,
  WageringProgressEvent,
  UserRegisteredEvent,
  UserVerifiedEvent,
} from './events.js';
export { createEvent } from './events.js';

// ═══════════════════════════════════════════════════════════════════
// References (cross-service linking)
// ═══════════════════════════════════════════════════════════════════

export type {
  WalletReference,
  WalletBalanceSnapshot,
  BonusReference,
  WalletBonusSummary,
  TransactionReference,
  UserReference,
  ServiceResponse,
} from './references.js';
export { successResponse, errorResponse } from './references.js';

