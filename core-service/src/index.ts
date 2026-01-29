/**
 * Service-Core
 * 
 * Single-process microservice architecture library
 * Optimized for 100K+ users
 * 
 * Features: Saga pattern, API Gateway, GraphQL, Infrastructure Generator
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * API ORGANIZATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PUBLIC API (use in microservices):
 *   - Service Database Access: createServiceDatabaseAccess()
 *   - Transfer/Wallet Operations: createTransferWithTransactions, etc.
 *   - Configuration: getConfigWithDefault, createConfigStore
 *   - Authentication: createToken, verifyToken, etc.
 *   - Utilities: logger, retry, CircuitBreaker, etc.
 * 
 * INTERNAL/ADVANCED API (special cases only):
 *   - Database Strategy: createDatabaseStrategy, resolveDatabase
 *   - Low-level MongoDB: getDatabase, getClient, connectDatabase
 *   - Raw Collections: direct MongoDB operations
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║                           PUBLIC API                                       ║
// ║  Use these in your microservices - stable, documented, recommended        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════
// Service Database Access (RECOMMENDED - use this in microservices)
// ═══════════════════════════════════════════════════════════════════
// 
// Standard pattern for all microservices:
//   1. Create accessor: export const db = createServiceDatabaseAccess('my-service');
//   2. Initialize at startup: await db.initialize();
//   3. Use anywhere: const database = await db.getDb();
//
export {
  createServiceDatabaseAccess,
} from './databases/mongodb/service-accessor.js';
export type {
  ServiceDatabaseAccessor,
  DatabaseIndexConfig,
  HealthCheckResult,
  DatabaseStats,
} from './databases/mongodb/service-accessor.js';

// ═══════════════════════════════════════════════════════════════════
// Service Redis Access (RECOMMENDED - use this in microservices)
// ═══════════════════════════════════════════════════════════════════
// 
// Standard pattern for all microservices:
//   1. Create accessor: export const redis = createServiceRedisAccess('my-service');
//   2. Initialize at startup: await redis.initialize({ brand });
//   3. Use anywhere: await redis.set('key', value, ttl);
//
// Keys are automatically prefixed: {brand}:{service}:{key}
//
export {
  createServiceRedisAccess,
  configureRedisStrategy,
  closeAllRedisConnections,
} from './databases/redis/service-accessor.js';
export type {
  ServiceRedisAccessor,
  RedisStrategyConfig,
  ServiceRedisOptions,
  RedisHealthResult,
  RedisStats,
} from './databases/redis/service-accessor.js';

// ═══════════════════════════════════════════════════════════════════
// Saga Pattern (Business Logic)
// ═══════════════════════════════════════════════════════════════════
export { createService, generateId, executeSaga } from './saga/index.js';
export type { ServiceConfig, EntityConfig, SagaContext, SagaStep, SagaResult, SagaOptions } from './saga/index.js';

// ═══════════════════════════════════════════════════════════════════
// API Gateway
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// Transfer & Wallet Operations (Wallets + Transactions + Transfers)
// ═══════════════════════════════════════════════════════════════════
export {
  createTransferWithTransactions,
  startSession,
  endSession,
  createNewWallet,
  getOrCreateWallet,
  approveTransfer,
  declineTransfer,
} from './common/wallet/transfer.js';
export type {
  Transfer,
  Transaction,
  CreateTransferParams,
  CreateTransferResult,
} from './common/wallet/transfer.js';

// Wallet Types and Utilities (Type-safe wallet access)
export {
  // Collection constants and getters
  COLLECTION_NAMES,
  getWalletsCollection,
  getTransfersCollection,
  getTransactionsCollection,
  // Transaction options
  DEFAULT_TRANSACTION_OPTIONS,
  // Wallet utilities
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
  buildWalletActivityUpdate,
  buildWalletUpdate,
  withTransaction,
} from './common/wallet/wallet.js';
export type {
  Wallet,
  BalanceType as WalletBalanceType,
  BalanceValidationOptions,
  BalanceValidationResult,
  DatabaseOptions,
  ResolvedDatabase,
  TransactionOptions,
  WalletUpdateOptions,
  CollectionName,
} from './common/wallet/wallet.js';

// ═══════════════════════════════════════════════════════════════════
// Recovery System (Generic - transfers, orders, etc.)
// ═══════════════════════════════════════════════════════════════════
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
} from './common/resilience/recovery.js';
export type {
  RecoverableOperation,
  RecoveryResult,
  RecoveryHandler,
  OperationState,
} from './common/resilience/recovery.js';

export {
  createTransferRecoveryHandler,
} from './common/wallet/transfer-recovery.js';

// ═══════════════════════════════════════════════════════════════════
// Account ID Management (Unified Account ID System)
// ═══════════════════════════════════════════════════════════════════
export {
  getSystemAccountId,
  getProviderAccountId,
  getUserAccountId,
  parseAccountId,
} from './common/wallet/account-ids.js';
export type {
  AccountIdOptions,
} from './common/wallet/account-ids.js';

// ═══════════════════════════════════════════════════════════════════
// Authentication & JWT
// ═══════════════════════════════════════════════════════════════════
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
} from './common/auth/jwt.js';

// Permissions & Authorization
export { allow, deny, isAuthenticated, hasRole, hasAnyRole, can, and, or, isOwner, sameTenant, hasPermission, isSystem } from './common/auth/permissions.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration Management
// ═══════════════════════════════════════════════════════════════════
export {
  loadConfig as loadServiceConfig,
  createConfigLoader,
  type ConfigLoaderOptions,
} from './common/config/loader.js';

// Dynamic Configuration Store (MongoDB-based)
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
} from './common/config/store.js';
export type {
  ConfigEntry,
  ConfigStoreOptions,
  GetConfigOptions,
  GetAllConfigOptions,
  SetConfigOptions,
} from './common/config/store.js';

export {
  configGraphQLTypes,
  configResolvers,
} from './common/config/graphql.js';

// ═══════════════════════════════════════════════════════════════════
// Pending Operations (Temporary data storage)
// ═══════════════════════════════════════════════════════════════════
export {
  createPendingOperationStore,
  createRegistrationStore,
  createCampaignStore,
  createFormStore,
} from './common/resilience/pending-operation.js';
export type {
  PendingOperationBackend,
  PendingOperationConfig,
  PendingOperationOptions,
} from './common/resilience/pending-operation.js';

// ═══════════════════════════════════════════════════════════════════
// Caching
// ═══════════════════════════════════════════════════════════════════
export { 
  // Core functions
  cached, 
  getCache, 
  setCache, 
  deleteCache, 
  deleteCachePattern, 
  clearCache,
  clearMemoryCache,
  // Batch operations
  getCacheMany,
  setCacheMany,
  deleteCacheMany,
  // Configuration & stats
  configureCacheSettings,
  getCacheStats,
  resetCacheStats,
  // Cache warming
  warmCache,
  // Key helpers
  createCacheKeys,
  CacheKeys,
} from './databases/cache.js';
export type { CacheConfig, CacheStatistics } from './databases/cache.js';

// ═══════════════════════════════════════════════════════════════════
// Redis
// ═══════════════════════════════════════════════════════════════════
export { 
  connectRedis, 
  getRedis, 
  getRedisForRead,
  hasReadReplica,
  publish, 
  subscribe, 
  closeRedis, 
  checkRedisHealth,
  scanKeysIterator,
  scanKeysArray,
  scanKeysWithCallback,
  batchGetValues,
  getRedisConnectionStats,
} from './databases/redis/connection.js';
export type { 
  RedisConfig, 
  RedisSentinelConfig,
  RedisReplicaConfig,
  ScanOptions,
  RedisConnectionStats,
} from './databases/redis/connection.js';

// ═══════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// Circuit Breaker & Retry
// ═══════════════════════════════════════════════════════════════════
export { 
  CircuitBreaker, 
  createCircuitBreaker,
  CircuitBreakerOpenError,
} from './common/resilience/circuit-breaker.js';
export type { CircuitBreakerConfig } from './common/resilience/circuit-breaker.js';

export { 
  retry, 
  createRetryFunction,
  RetryConfigs,
} from './common/resilience/retry.js';
export type { 
  RetryConfig, 
  RetryResult, 
  RetryStrategy,
} from './common/resilience/retry.js';

// ═══════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════
export { validateInput } from './common/validation/arktype.js';

export { 
  ValidationHandler,
  AuthValidator,
  RequiredFieldValidator,
  TypeValidator,
  ExtractInputValidator,
  PermissionValidator,
  ValidationChainBuilder,
  createValidationChain,
} from './common/graphql/validation-chain.js';
export type { ValidationContext, ValidationResult } from './common/graphql/validation-chain.js';

// ═══════════════════════════════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════════════════════════════
export { 
  getErrorMessage, 
  normalizeError,
  GraphQLError,
  formatGraphQLError,
  registerServiceErrorCodes,
  getAllErrorCodes,
  extractServiceFromCode,
} from './common/errors.js';

// ═══════════════════════════════════════════════════════════════════
// Lifecycle & Startup
// ═══════════════════════════════════════════════════════════════════
export { onShutdown, offShutdown, shutdown, setupGracefulShutdown, isShutdownInProgress } from './common/lifecycle/shutdown.js';
export type { ShutdownOptions } from './common/lifecycle/shutdown.js';

export { setupCleanupTask, setupCleanupTasks, setupEventListener } from './common/lifecycle/tasks.js';
export { initializeService, initializeDatabase, initializeRedis, safeInitialize } from './common/lifecycle/startup.js';
export type { CleanupTask, EventListenerConfig } from './common/lifecycle/tasks.js';

// ═══════════════════════════════════════════════════════════════════
// Generic Utilities
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// GraphQL Resolver Utilities
// ═══════════════════════════════════════════════════════════════════
export { requireAuth, getTenantId, getUserId, createObjectModelQueryResolver } from './common/graphql/utils.js';
export { 
  ResolverBuilder,
  createResolverBuilder,
} from './common/graphql/builder.js';
export type { ResolverFunction, ServiceResolvers } from './common/graphql/builder.js';

// GraphQL Query Complexity
export {
  createComplexityConfig,
  calculateComplexity,
  analyzeQueryComplexity,
  validateQueryComplexity,
  createComplexityMiddleware,
  // Presets
  STRICT_COMPLEXITY_CONFIG,
  STANDARD_COMPLEXITY_CONFIG,
  RELAXED_COMPLEXITY_CONFIG,
} from './common/graphql/complexity.js';
export type { ComplexityConfig, ComplexityResult } from './common/graphql/complexity.js';

// ═══════════════════════════════════════════════════════════════════
// Repository (with caching)
// ═══════════════════════════════════════════════════════════════════
export { createRepository, generateId as generateUUID, bulkInsert, bulkUpdate } from './databases/mongodb/repository.js';

// ═══════════════════════════════════════════════════════════════════
// Pagination (cursor-based, sharding-optimized)
// ═══════════════════════════════════════════════════════════════════
export {
  paginateCollection,
  convertOffsetToCursor,
  type CursorPaginationOptions,
  type CursorPaginationResult,
} from './databases/mongodb/pagination.js';

// ═══════════════════════════════════════════════════════════════════
// Cross-Service Integration (Event-driven)
// ═══════════════════════════════════════════════════════════════════
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
} from './common/events/integration.js';
export type { IntegrationEvent, EmitOptions, UnifiedEmitOptions } from './common/events/integration.js';

// ═══════════════════════════════════════════════════════════════════
// Webhooks
// ═══════════════════════════════════════════════════════════════════
export {
  createWebhookService,
  createWebhookManager,
  WebhookManager,
  initializeWebhooks,
  generateSignature,
  verifySignature,
  webhookGraphQLTypes,
} from './common/events/webhooks.js';
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
} from './common/events/webhooks.js';

// ═══════════════════════════════════════════════════════════════════
// Access Control (RBAC/ACL)
// ═══════════════════════════════════════════════════════════════════
export {
  createAccessControl,
  AccessEngine,
  createAccessEngine,
  AccessStore,
  AccessCache,
  accessGraphQLTypes,
  createAccessResolvers,
  ACCESS_CONTROL_URNS,
} from './access/index.js';

export type {
  AccessControlConfig,
  AccessControl,
  URN,
  URNContext,
  URNMatcher,
  Role,
  Policy,
  PolicyEffect,
  PolicySubject,
  PolicyCondition,
  SubjectType,
  ConditionOperator,
  ACLGrant,
  CreateRoleInput,
  UpdateRoleInput,
  CreatePolicyInput,
  CreateACLGrantInput,
  CompiledPermissions,
  AccessCheckResult,
  AccessContext,
  UserContextInput,
  AccessEngineConfig,
  ResolvedAccessConfig,
  CacheStats,
  CacheInvalidationEvent,
  AuditLogEntry,
} from './access/index.js';

// ═══════════════════════════════════════════════════════════════════
// Infrastructure Generator
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// ArkType (Schema Validation)
// ═══════════════════════════════════════════════════════════════════
export { type } from 'arktype';


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║                           SHARED TYPES                                     ║
// ║  Type definitions used across microservices                               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// Common Types
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

// Auth & Permissions Types
export type { 
  UserContext, 
  JwtConfig, 
  TokenPair,
  Permission,
  PermissionRule, 
  PermissionMap,
} from './types/index.js';

// Repository Types
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

// Resolver Types
export type {
  Resolver,
  Resolvers, 
  ResolverContext,
  SubscriptionResolver,
} from './types/index.js';

// Currency Types (Configurable registry)
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

// Reference Types (Cross-service linking)
export type {
  UserReference,
  ServiceResponse,
} from './types/index.js';
export { successResponse, errorResponse } from './types/index.js';

// Brand & Tenant Types
export type {
  Brand,
  Tenant,
} from './databases/mongodb/brand-tenant-store.js';


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║                    INTERNAL / ADVANCED API                                 ║
// ║  For special cases, scripts, or internal core-service use only            ║
// ║  Microservices should use createServiceDatabaseAccess() instead           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════
// Low-Level MongoDB Connection (INTERNAL - use createServiceDatabaseAccess)
// ═══════════════════════════════════════════════════════════════════
// These are needed for:
//   - Scripts that bootstrap database connections
//   - Config store initialization
//   - Internal core-service operations
//
export { 
  connectDatabase, 
  getDatabase, 
  closeDatabase,
  checkDatabaseHealth,
  getClient,
  getDatabaseStats,
  getConnectionPoolStats,
  getPoolHealthStatus,
  registerIndexes,
  DEFAULT_MONGO_CONFIG,
} from './databases/mongodb/connection.js';
export type { MongoConfig } from './databases/mongodb/connection.js';

// ═══════════════════════════════════════════════════════════════════
// MongoDB Utilities (for direct collection operations)
// ═══════════════════════════════════════════════════════════════════
export {
  ObjectId,
  isValidObjectId,
  toObjectId,
  objectIdToString,
  generateMongoId,
  buildIdQuery,
  buildIdQueryWithOr,
  buildUpdateQuery,
  findById,
  findOneById,
  extractDocumentId,
  normalizeDocument,
  normalizeDocuments,
  updateOneById,
  deleteOneById,
  findOneAndUpdateById,
} from './databases/mongodb/utils.js';

export type {
  Collection,
  Filter,
  Document,
  ClientSession,
  Db,
  MongoClient,
} from './databases/mongodb/utils.js';

// MongoDB Error Handling
export {
  isDuplicateKeyError,
  handleDuplicateKeyError,
  executeWithDuplicateHandling,
  type DuplicateKeyErrorOptions,
} from './databases/mongodb/errors.js';

// ═══════════════════════════════════════════════════════════════════
// User Utilities (INTERNAL - for scripts/admin operations)
// ═══════════════════════════════════════════════════════════════════
export {
  findUserIdByRole,
  findUserIdsByRole,
} from './databases/mongodb/user-utils.js';
export type { FindUserByRoleOptions } from './databases/mongodb/user-utils.js';

// ═══════════════════════════════════════════════════════════════════
// Context Resolution (INTERNAL - for gateway/middleware)
// ═══════════════════════════════════════════════════════════════════
export {
  resolveContext,
  getBrand,
  getTenantId as getTenantIdFromContext,
} from './common/config/context.js';

// Core Database Name Constant
export {
  CORE_DATABASE_NAME,
} from './databases/mongodb/constants.js';

// Brand & Tenant Store (INTERNAL - for gateway/admin)
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
} from './databases/mongodb/brand-tenant-store.js';

// ═══════════════════════════════════════════════════════════════════
// Database Strategy Pattern (ADVANCED - for special multi-tenant cases)
// ═══════════════════════════════════════════════════════════════════
// Most services should use createServiceDatabaseAccess() instead.
// Use these only for:
//   - Custom multi-tenant configurations
//   - Sharding implementations
//   - Cross-database operations
//
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
  resolveDatabase,
} from './databases/mongodb/strategy.js';
export type {
  DatabaseStrategy,
  DatabaseResolver,
  DatabaseContext,
  DatabaseStrategyConfig,
  DatabaseResolutionOptions,
} from './databases/mongodb/strategy.js';

export {
  resolveDatabaseStrategyFromConfig,
  resolveRedisUrlFromConfig,
  getCentralDatabase,
  getCentralClient,
  getServiceDatabase,
  getServiceStrategy,
  initializeServiceDatabase,
  clearDatabaseCaches,
  type DatabaseConfig,
  type ServiceDatabaseOptions,
} from './databases/mongodb/strategy-config.js';
