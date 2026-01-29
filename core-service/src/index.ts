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

// Ledger system removed - use Wallets + Transactions + Transfers architecture instead
// Use createTransferWithTransactions from transfer-helper for all financial operations

// Transfer Helper (Simplified Architecture: Wallets + Transactions + Transfers)
export {
  createTransferWithTransactions,
  startSession,
  endSession,
  createNewWallet,
  getOrCreateWallet,
  approveTransfer,
  declineTransfer,
  getBalanceField,
} from './common/transfer-helper.js';
export type {
  Transfer,
  Transaction,
  CreateTransferParams,
  CreateTransferResult,
} from './common/transfer-helper.js';

// Wallet Types and Utilities (Type-safe wallet access, validation, helpers)
export {
  getWalletId,
  getWalletBalance,
  getWalletAllowNegative,
  getWalletCreditLimit,
  getWalletUserId,
  getWalletTenantId,
  getWalletCurrency,
  validateBalanceForDebit,
  resolveDatabaseConnection,
  getBalanceFieldName,
  buildWalletUpdate,
  withTransaction,
} from './common/wallet-types.js';
export type {
  Wallet,
  BalanceType as WalletBalanceType,  // Aliased to avoid conflict with types/enums BalanceType
  BalanceValidationOptions,
  BalanceValidationResult,
  DatabaseOptions,
  ResolvedDatabase,
  TransactionOptions,
  WalletUpdateOptions,
} from './common/wallet-types.js';

// Recovery System (Generic - works with transfers, orders, etc.)
export {
  recoverOperation,
  recoverStuckOperations,
  recoverAllStuckOperations,
  registerRecoveryHandler,
  getRecoveryHandler,
  getOperationStateTracker,
  getRecoveryJob,
  OperationStateTracker,
  RecoveryJob,
} from './common/recovery.js';
export type {
  RecoverableOperation,
  RecoveryResult,
  RecoveryHandler,
  OperationState,
} from './common/recovery.js';

// Transfer Recovery Handler (Showcase implementation)
export {
  createTransferRecoveryHandler,
} from './common/transfer-recovery.js';

// Account ID Management (Unified Account ID System)
export {
  getSystemAccountId,
  getProviderAccountId,
  getUserAccountId,
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
  signGenericJWT,
  verifyGenericJWT,
} from './common/jwt.js';

// Pending Operations (Generic temporary data storage)
export {
  createPendingOperationStore,
  createRegistrationStore,
  createCampaignStore,
  createFormStore,
} from './common/pending-operation.js';
export type {
  PendingOperationBackend,
  PendingOperationConfig,
  PendingOperationOptions,
} from './common/pending-operation.js';
export { allow, deny, isAuthenticated, hasRole, hasAnyRole, can, and, or, isOwner, sameTenant, hasPermission, isSystem } from './common/permissions.js';

// Database (optimized)
export { 
  connectDatabase, 
  getDatabase, 
  closeDatabase,
  checkDatabaseHealth,
  getClient,
  getDatabaseStats,
  registerIndexes,
  DEFAULT_MONGO_CONFIG,
} from './databases/mongodb.js';
export type { MongoConfig } from './databases/mongodb.js';

// MongoDB Utilities
export {
  // Re-export MongoDB types
  ObjectId,
  // ObjectId utilities
  isValidObjectId,
  toObjectId,
  objectIdToString,
  generateMongoId,
  // Query builders
  buildIdQuery,
  buildIdQueryWithOr,
  buildUpdateQuery,
  // Document lookup (performance-optimized)
  findById,
  findOneById,
  // Document normalization
  extractDocumentId,
  normalizeDocument,
  normalizeDocuments,
  // Common operations (performance-optimized)
  updateOneById,
  deleteOneById,
  findOneAndUpdateById,
} from './databases/mongodb-utils.js';

// User Utilities
export {
  findUserIdByRole,
  findUserIdsByRole,
} from './databases/user-utils.js';
export type { FindUserByRoleOptions } from './databases/user-utils.js';
export type {
  Collection,
  Filter,
  Document,
  ClientSession,
  Db,
  MongoClient,
} from './databases/mongodb-utils.js';

// MongoDB Error Handling (sharding-optimized)
export {
  isDuplicateKeyError,
  handleDuplicateKeyError,
  executeWithDuplicateHandling,
  type DuplicateKeyErrorOptions,
} from './databases/mongodb-errors.js';

// Pagination Utilities (cursor-based, sharding-optimized)
export {
  paginateCollection,
  convertOffsetToCursor,
  type CursorPaginationOptions,
  type CursorPaginationResult,
} from './databases/pagination.js';

// Configuration Management (unified, multi-source)
export {
  loadConfig as loadServiceConfig,
  createConfigLoader,
  type ConfigLoaderOptions,
} from './common/config-loader.js';

// Dynamic Configuration Store (MongoDB-based, permission-aware)
export {
  createConfigStore,
  createServiceConfigStore,
  getCentralConfigStore,
  clearCentralConfigStore,
  clearServiceConfigStores,
  registerServiceConfigDefaults,
  getConfigWithDefault,
  ensureDefaultConfigsCreated,
  ConfigStore,
} from './common/config-store.js';
export type {
  ConfigEntry,
  ConfigStoreOptions,
  GetConfigOptions,
  GetAllConfigOptions,
  SetConfigOptions,
} from './common/config-store.js';

// Dynamic Configuration GraphQL API
export {
  configGraphQLTypes,
  configResolvers,
} from './common/config-graphql.js';

// NOTE: DatabaseConfigStore (db-config-store.ts) is DEPRECATED
// All database config is now stored in service_configs collection as 'database' key
// Use getConfigWithDefault(service, 'database') instead

// Database Strategy Pattern (Flexible Database Architecture)
export {
  createDatabaseStrategy,
  getDatabaseByStrategy,
  createSharedDatabaseStrategy,
  createPerServiceDatabaseStrategy,
  createPerBrandDatabaseStrategy,
  createPerBrandServiceDatabaseStrategy,
  createPerTenantDatabaseStrategy,
  createPerTenantServiceDatabaseStrategy,
  createPerShardDatabaseStrategy,
  DatabaseStrategyResolver,
} from './databases/strategy.js';
export type {
  DatabaseStrategy,
  DatabaseResolver,
  DatabaseContext,
  DatabaseStrategyConfig,
  DatabaseResolutionOptions,
} from './databases/strategy.js';
export {
  resolveDatabase,
} from './databases/strategy.js';
export {
  // Strategy resolution from config
  resolveDatabaseStrategyFromConfig,
  resolveRedisUrlFromConfig,
  // Centralized database access (simplified API)
  getCentralDatabase,
  getCentralClient,
  getServiceDatabase,
  getServiceStrategy,
  initializeServiceDatabase,
  clearDatabaseCaches,
  type DatabaseConfig,
  type ServiceDatabaseOptions,
} from './databases/strategy-config.js';

// Repository (with caching)
export { createRepository, generateId as generateUUID, bulkInsert, bulkUpdate } from './databases/repository.js';

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
} from './databases/cache.js';

// Redis
export { 
  connectRedis, 
  getRedis, 
  publish, 
  subscribe, 
  closeRedis, 
  checkRedisHealth,
  scanKeysIterator,
  scanKeysArray,
  scanKeysWithCallback,
  batchGetValues,
} from './databases/redis.js';
export type { RedisConfig, ScanOptions } from './databases/redis.js';

// Logger
export { 
  logger, 
  setLogLevel, 
  setLogFormat, 
  configureLogger, 
  createChildLogger,
  setCorrelationId,
  getCorrelationId,
  generateCorrelationId,
  withCorrelationId,
} from './common/logger.js';
export type { LogLevel, LogFormat, LoggerConfig, LogEntry } from './common/logger.js';

// Lifecycle (graceful shutdown)
export { onShutdown, offShutdown, shutdown, setupGracefulShutdown, isShutdownInProgress } from './common/lifecycle.js';
export type { ShutdownOptions } from './common/lifecycle.js';

// Service Lifecycle (cleanup tasks, event listeners)
export { setupCleanupTask, setupCleanupTasks, setupEventListener } from './common/service-lifecycle.js';
export { initializeService, initializeDatabase, initializeRedis, safeInitialize } from './common/startup-helpers.js';
export type { CleanupTask, EventListenerConfig } from './common/service-lifecycle.js';

// Validation
export { validateInput } from './common/validation.js';

// Generic Utilities
export {
  // Date/Time utilities
  addMinutes,
  addHours,
  addDays,
  addSeconds,
  addMonths,
  addYears,
  // Token/Hash utilities
  hashToken,
  generateToken,
  generateOTP,
  generateRefreshToken,
  generateBackupCodes,
  // String/Identifier utilities
  normalizeEmail,
  normalizePhone,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  detectIdentifierType,
  type IdentifierType,
  // Expiry parsing
  parseExpiry,
  // Device/User Agent utilities
  parseUserAgent,
  generateDeviceId,
} from './common/utils.js';

// Error Utilities (unified)
export { 
  getErrorMessage, 
  normalizeError,
  GraphQLError,
  formatGraphQLError,
  registerServiceErrorCodes,
  getAllErrorCodes,
  extractServiceFromCode,
} from './common/errors.js';

// Circuit Breaker & Retry
export { 
  CircuitBreaker, 
  createCircuitBreaker,
  CircuitBreakerOpenError,
} from './common/circuit-breaker.js';
export type { CircuitBreakerConfig } from './common/circuit-breaker.js';

export { 
  retry, 
  createRetryFunction,
  RetryConfigs,
} from './common/retry.js';
export type { 
  RetryConfig, 
  RetryResult, 
  RetryStrategy,
} from './common/retry.js';

// Resolver Utilities
export { requireAuth, getTenantId, getUserId, createObjectModelQueryResolver } from './common/resolvers.js';
export { 
  ValidationHandler,
  AuthValidator,
  RequiredFieldValidator,
  TypeValidator,
  ExtractInputValidator,
  PermissionValidator,
  ValidationChainBuilder,
  createValidationChain,
} from './common/validation-chain.js';
export type { ValidationContext, ValidationResult } from './common/validation-chain.js';
export { 
  ResolverBuilder,
  createResolverBuilder,
} from './common/resolver-builder.js';
export type { ResolverFunction, ServiceResolvers } from './common/resolver-builder.js';

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

// Context Resolution
export {
  resolveContext,
  getBrand,
  getTenantId as getTenantIdFromContext,
} from './common/context-resolver.js';

// Core Database
export {
  CORE_DATABASE_NAME,
} from './databases/core-database.js';

// Brand & Tenant Store
export {
  getBrandById,
  getBrandByCode,
  getAllBrands,
  invalidateBrandCache,
  getTenantById,
  getTenantByCode,
  getTenantsByBrand,
  getAllTenants,
  invalidateTenantCache,
} from './databases/brand-tenant-store.js';
export type {
  Brand,
  Tenant,
} from './databases/brand-tenant-store.js';

// Repository
export type { 
  WriteOptions,
  Repository, 
  FindManyOptions,
  CursorPaginationOptions as RepositoryCursorPaginationOptions,
  CursorPaginationResult as RepositoryCursorPaginationResult,
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

// Note: Event data types should be defined in each service (domain-specific)
// Use IntegrationEvent<T> from integration.ts with your own types:
//   emit('deposit.completed', tenantId, userId, { transactionId, amount, ... });

// References (cross-service linking) - Generic types only
// Domain-specific types should be defined in their respective services
export type {
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
} from './common/integration.js';
export type { IntegrationEvent, EmitOptions, UnifiedEmitOptions } from './common/integration.js';

// Webhooks Engine (generic - services define their own event types)
export {
  // Primary API - plug-and-play service
  createWebhookService,
  createWebhookManager,
  WebhookManager,
  // Generic initialization helper (use in service's main() after DB connection)
  initializeWebhooks,
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
