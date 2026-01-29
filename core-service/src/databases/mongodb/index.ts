/**
 * MongoDB Module - Re-exports all MongoDB-related functionality
 * 
 * This is the main entry point for MongoDB utilities in core-service.
 */

// Connection
export {
  connectDatabase,
  getDatabase,
  getClient,
  closeDatabase,
  checkDatabaseHealth,
  getDatabaseStats,
  getConnectionPoolStats,
  registerIndexes,
  DEFAULT_MONGO_CONFIG,
  type MongoConfig,
} from './connection.js';

// Constants
export { CORE_DATABASE_NAME } from './constants.js';

// Utils
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
  updateOneById,
  deleteOneById,
  findOneAndUpdateById,
  extractDocumentId,
  normalizeDocument,
  normalizeDocuments,
  type Collection,
  type Filter,
  type Document,
  type ClientSession,
  type Db,
  type MongoClient,
} from './utils.js';

// Errors
export {
  isDuplicateKeyError,
  handleDuplicateKeyError,
  executeWithDuplicateHandling,
  type DuplicateKeyErrorOptions,
} from './errors.js';

// Repository
export {
  createRepository,
  bulkInsert,
  bulkUpdate,
  aggregate,
  generateId,
  type CacheTTLConfig,
  type RepositoryOptions,
} from './repository.js';

// Pagination
export {
  paginateCollection,
  convertOffsetToCursor,
  type CursorPaginationOptions,
  type CursorPaginationResult,
} from './pagination.js';

// Strategy
export {
  DatabaseStrategyResolver,
  createDatabaseStrategy,
  getDatabaseByStrategy,
  resolveDatabase,
  createSharedDatabaseStrategy,
  createPerServiceDatabaseStrategy,
  createPerBrandDatabaseStrategy,
  createPerBrandServiceDatabaseStrategy,
  createPerTenantDatabaseStrategy,
  createPerTenantServiceDatabaseStrategy,
  createPerShardDatabaseStrategy,
  type DatabaseStrategy,
  type DatabaseResolver,
  type DatabaseContext,
  type DatabaseStrategyConfig,
  type DatabaseResolutionOptions,
} from './strategy.js';

// Strategy Config
export {
  resolveDatabaseStrategyFromConfig,
  resolveRedisUrlFromConfig,
  getCentralDatabase,
  getCentralClient,
  getServiceDatabase,
  getServiceStrategy,
  clearDatabaseCaches,
  initializeServiceDatabase,
  type DatabaseConfig,
  type ServiceDatabaseOptions,
} from './strategy-config.js';

// Service Accessor
export {
  createServiceDatabaseAccess,
  type ServiceDatabaseAccessor,
  type ServiceDatabaseOptions as ServiceDbOptions,
} from './service-accessor.js';
