/**
 * Service-Core
 * 
 * Single-process microservice architecture library
 * Optimized for 100K+ users
 * 
 * Features: Saga pattern, API Gateway, GraphQL, Infrastructure Generator
 */

// Saga
export { createService, generateId, executeSaga } from './saga/index.js';
export type { ServiceConfig, EntityConfig, SagaContext, SagaStep, SagaResult, SagaOptions } from './saga/index.js';

// Gateway
export { 
  createGateway, 
  createPermissionMiddleware,
  createHealthSubscription,
} from './gateway/index.js';
export type { 
  GatewayConfig, 
  GatewayPermissions, 
  GatewayPermissionRule,
  SubscriptionConfig,
  GatewayInstance,
  BroadcastHelpers,
  SSEHelpers,
} from './gateway/server.js';

// Ledger (Double-Entry Bookkeeping)
export { 
  Ledger,
  createLedger,
} from './common/ledger.js';
export type {
  LedgerConfig,
  LedgerAccount,
  LedgerTransaction,
  LedgerEntry,
  CreateTransactionInput,
  AccountType,
  AccountSubtype,
  TransactionType,
  TransactionStatus,
  BalanceCalculator,
} from './common/ledger.js';

// Account ID Management (Unified Account ID System)
export {
  getSystemAccountId,
  getProviderAccountId,
  getUserAccountId,
  resolveAccountId,
  parseAccountId,
} from './common/account-ids.js';
export type {
  AccountIdOptions,
} from './common/account-ids.js';

// Auth & Permissions
export { 
  createToken, 
  createRefreshToken,
  createTokenPair,
  verifyToken, 
  verifyRefreshToken,
  refreshTokens,
  extractToken,
  decodeToken,
  isTokenExpired,
  getTokenExpiration,
} from './common/jwt.js';
export { allow, deny, isAuthenticated, hasRole, hasAnyRole, can, and, or, isOwner, sameTenant, hasPermission } from './common/permissions.js';

// Database (optimized)
export { 
  connectDatabase, 
  getDatabase, 
  closeDatabase,
  checkDatabaseHealth,
  getDatabaseStats,
  getClient,
  registerIndexes,
  DEFAULT_MONGO_CONFIG,
} from './common/database.js';
export type { MongoConfig } from './common/database.js';

// Repository (with caching)
export { createRepository, generateId as generateUUID, bulkInsert, bulkUpdate } from './common/repository.js';

// Cache
export { 
  cached, 
  getCache, 
  setCache, 
  deleteCache, 
  deleteCachePattern, 
  clearCache,
  getCacheStats,
  createCacheKeys,
  CacheKeys,
} from './common/cache.js';

// Redis
export { connectRedis, getRedis, publish, subscribe, closeRedis, checkRedisHealth } from './common/redis.js';
export type { RedisConfig } from './common/redis.js';

// Logger
export { logger, setLogLevel, setLogFormat, configureLogger, createChildLogger } from './common/logger.js';
export type { LogLevel, LogFormat, LoggerConfig } from './common/logger.js';

// Lifecycle (graceful shutdown)
export { onShutdown, offShutdown, shutdown, setupGracefulShutdown, isShutdownInProgress } from './common/lifecycle.js';
export type { ShutdownOptions } from './common/lifecycle.js';

// Service Lifecycle (cleanup tasks, event listeners)
export { setupCleanupTask, setupCleanupTasks, setupEventListener } from './common/service-lifecycle.js';
export { initializeService, initializeDatabase, initializeRedis, safeInitialize } from './common/startup-helpers.js';
export type { CleanupTask, EventListenerConfig } from './common/service-lifecycle.js';

// Validation
export { validateInput } from './common/validation.js';

// Error Utilities
export { getErrorMessage, normalizeError } from './common/errors.js';

// Resolver Utilities
export { requireAuth, getTenantId, getUserId } from './common/resolvers.js';

// ═══════════════════════════════════════════════════════════════════
// Types (from src/types/)
// ═══════════════════════════════════════════════════════════════════

// Common (shared across all services)
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
} from './types/index.js';
export { CATEGORIES } from './types/index.js';

// Auth & Permissions
export type { 
  UserContext, 
  JwtConfig, 
  TokenPair,
  Permission,
  PermissionRule, 
  PermissionMap,
} from './types/index.js';

// Repository
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
} from './types/index.js';

// Resolvers
export type {
  Resolver,
  Resolvers, 
  ResolverContext,
  SubscriptionResolver,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════
// Shared Types (use across microservices) - from src/types/
// ═══════════════════════════════════════════════════════════════════

// Currency (configurable registry)
export type { Currency, BuiltInCurrency, CurrencyConfig } from './types/index.js';
export {
  registerCurrency,
  registerCurrencies,
  unregisterCurrency,
  clearCurrencies,
  initializeDefaultCurrencies,
  getCurrency,
  getAllCurrencies,
  getCurrencyCodes,
  getFiatCurrencies,
  getCryptoCurrencies,
  isCurrencyRegistered,
  isValidCurrency,
  isCrypto,
  isFiat,
  toSmallestUnit,
  fromSmallestUnit,
  formatCurrency,
} from './types/index.js';

// Event Data Types (example structures for common events)
export type {
  // Example data types (services can define their own)
  DepositCompletedData,
  WithdrawalCompletedData,
  BonusCreditedData,
  BonusConvertedData,
  BonusForfeitedData,
  UserRegisteredData,
  UserVerifiedData,
} from './types/index.js';

// Legacy Event Types (deprecated - use emit<T>() with your own types)
export type {
  BaseEvent,
  IntegrationEvent as LegacyIntegrationEvent,
  DepositCompletedEvent,
  WithdrawalCompletedEvent,
  WithdrawalRequestedEvent,
  BonusCreditedEvent,
  BonusConvertedEvent,
  BonusForfeitedEvent,
  TurnoverCompletedEvent,
  TurnoverProgressEvent,
  UserRegisteredEvent,
  UserVerifiedEvent,
  WageringCompletedEvent,
  WageringProgressEvent,
} from './types/index.js';
/** @deprecated Use emit() or buildEvent() instead */
export { createEvent } from './types/index.js';

// References (cross-service linking)
export type {
  WalletReference,
  WalletBalanceSnapshot,
  BonusReference,
  WalletBonusSummary,
  TransactionReference,
  UserReference,
  ServiceResponse,
} from './types/index.js';
export { successResponse, errorResponse } from './types/index.js';

// Cross-Service Integration (generic pub/sub)
export {
  // Core API
  emit,
  emitEvent,
  on,
  onPattern,
  startListening,
  startGlobalListener,
  // Unified Event + Webhook Dispatcher
  createUnifiedEmitter,
  createTypedUnifiedEmitter,
  // Utilities
  createEmitter,
  createHandler,
  buildEvent,
  // Deprecated (backward compatibility)
  publishEvent,
  subscribeToEvents,
  startEventListener,
} from './common/integration.js';
export type { IntegrationEvent, EmitOptions, UnifiedEmitOptions } from './common/integration.js';

// Webhooks Engine (generic - services define their own event types)
export {
  // Primary API - plug-and-play service
  createWebhookService,
  createWebhookManager,
  WebhookManager,
  // Signature utilities (for webhook receivers)
  generateSignature,
  verifySignature,
  // GraphQL types (for reference only - createWebhookService handles this)
  webhookGraphQLTypes,
} from './common/webhooks.js';
export type {
  WebhookConfig,
  WebhookDelivery,
  WebhookPayload,
  RegisterWebhookInput,
  WebhookStats,
  WebhookDispatchInput,
  WebhookManagerConfig,
  WebhookTestResult,
  WebhookServiceConfig,
} from './common/webhooks.js';

// Infrastructure Generator
export { generateInfra, loadConfig, generateSampleConfig, createDefaultConfig } from './infra/index.js';
export { generateDockerfile, generateDockerCompose, generateNginxConf, generateK8sManifests } from './infra/index.js';
export type { 
  ServiceConfig as InfraServiceConfig, 
  DockerConfig, 
  DockerComposeConfig, 
  NginxConfig, 
  K8sConfig, 
  FullInfraConfig, 
  GeneratorOptions 
} from './infra/index.js';

// ArkType
export { type } from 'arktype';

// ═══════════════════════════════════════════════════════════════════
// Access Control (RBAC/ACL with URN - Native Implementation)
// ═══════════════════════════════════════════════════════════════════

export {
  // Main factory
  createAccessControl,
  
  // Engine
  AccessEngine,
  createAccessEngine,
  
  // Store & Cache
  AccessStore,
  AccessCache,
  
  // Note: URN utilities are exported directly from access-engine
  // Import them from 'access-engine' package instead
  
  // GraphQL
  accessGraphQLTypes,
  createAccessResolvers,
  ACCESS_CONTROL_URNS,
} from './access/index.js';

export type {
  // Access Control
  AccessControlConfig,
  AccessControl,
  
  // Core types
  URN,
  URNContext,
  URNMatcher,
  
  // RBAC types
  Role,
  Policy,
  PolicyEffect,
  PolicySubject,
  PolicyCondition,
  SubjectType,
  ConditionOperator,
  
  // ACL types
  ACLGrant,
  
  // Input types
  CreateRoleInput,
  UpdateRoleInput,
  CreatePolicyInput,
  CreateACLGrantInput,
  
  // Result types
  CompiledPermissions,
  AccessCheckResult,
  AccessContext,
  UserContextInput,
  
  // Config types
  AccessEngineConfig,
  ResolvedAccessConfig,
  
  // Cache types
  CacheStats,
  CacheInvalidationEvent,
  
  // Audit types
  AuditLogEntry,
} from './access/index.js';
