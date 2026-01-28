/**
 * Database Strategy Configuration Resolver
 * 
 * Resolves database strategy from MongoDB config store.
 * Makes database strategies fully configurable without code changes.
 * 
 * Provides two levels of database access:
 * 1. getCentralDatabase() - Bootstrap layer (always core_service)
 * 2. getServiceDatabase() - Business layer (strategy-based)
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses abstractions (getConfigWithDefault)
 * - Static imports
 */

// External packages (type imports)
import type { Db } from 'mongodb';

// Local imports
import { getConfigWithDefault } from '../common/config-store.js';
import { 
  createDatabaseStrategy,
  createSharedDatabaseStrategy,
  createPerServiceDatabaseStrategy,
  createPerBrandDatabaseStrategy,
  createPerBrandServiceDatabaseStrategy,
  createPerTenantDatabaseStrategy,
  createPerTenantServiceDatabaseStrategy,
  createPerShardDatabaseStrategy,
  type DatabaseStrategyResolver,
  type DatabaseStrategy,
  type DatabaseContext,
} from './strategy.js';
import { connectDatabase, getDatabase, getClient } from './mongodb.js';
import { CORE_DATABASE_NAME } from './core-database.js';
import { logger } from '../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseConfig {
  /** Database strategy type */
  strategy: DatabaseStrategy;
  /** MongoDB URI template (supports {service}, {brand}, {tenantId} placeholders) */
  mongoUri?: string;
  /** Database name template (supports {service}, {brand}, {tenantId} placeholders) */
  dbNameTemplate?: string;
  /** Redis URL (optional, for caching) */
  redisUrl?: string;
  /** Number of shards (for per-shard strategy, default: 4) */
  numShards?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Strategy Resolver from Config
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve database strategy from MongoDB config store
 * Falls back to per-service strategy with default URI if config not found
 * 
 * @example
 * // Get strategy for auth-service
 * const strategy = await resolveDatabaseStrategyFromConfig('auth-service');
 * const db = await strategy.resolve({ service: 'auth-service', brand: 'brand-a' });
 */
export async function resolveDatabaseStrategyFromConfig(
  service: string,
  options?: {
    brand?: string;
    tenantId?: string;
  }
): Promise<DatabaseStrategyResolver> {
  const { brand, tenantId } = options || {};
  
  // Load database config from MongoDB config store
  let dbConfig = await getConfigWithDefault<DatabaseConfig>(
    service,
    'database',
    { brand, tenantId }
  );
  
  // If no config found, use defaults
  // IMPORTANT: core-service and auth-service always use 'shared' strategy (core_service database)
  // because they store users, sessions, and configs that are shared across all services
  // NOTE: Do NOT use process.env.MONGO_URI here - it may be set from a running service
  // and contain a specific database name (e.g., notification_service) that's wrong for other services
  if (!dbConfig) {
    const isSharedService = service === 'core-service' || service === 'auth-service';
    dbConfig = {
      strategy: (isSharedService ? 'shared' : 'per-service') as DatabaseStrategy,
      mongoUri: isSharedService 
        ? `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`
        : 'mongodb://localhost:27017/{service}?directConnection=true',
      dbNameTemplate: isSharedService ? CORE_DATABASE_NAME : '{service}',
      redisUrl: process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`,
    };
  }
  
  // Determine the strategy (default to per-service if not specified)
  const strategy = dbConfig.strategy || 'per-service';
  
  // For per-service strategy, ensure URI has {service} placeholder
  // If URI is hardcoded without placeholder, use default template
  // NOTE: Do NOT use process.env.MONGO_URI as fallback - it may contain a specific
  // database name from a running service that's wrong for other services
  let mongoUri = dbConfig.mongoUri;
  if (strategy === 'per-service' && mongoUri && !mongoUri.includes('{service}')) {
    // URI is hardcoded (e.g., mongodb://localhost:27017/core_service), use default template instead
    logger.warn('Database URI does not contain {service} placeholder for per-service strategy, using default template', {
      service,
      providedUri: mongoUri
    });
    mongoUri = 'mongodb://localhost:27017/{service}?directConnection=true';
  }
  
  // If still no URI, use default template
  if (!mongoUri) {
    mongoUri = 'mongodb://localhost:27017/{service}?directConnection=true';
  }
  
  // For per-service strategy, pass template as-is (not resolved)
  // The strategy will resolve it when resolve() is called with actual service context
  // For other strategies, we may need to resolve templates if they depend on brand/tenant
  
  // Resolve URI template (replace placeholders for service, but keep {service} for per-service)
  let uriTemplate = mongoUri || 'mongodb://localhost:27017/{service}?directConnection=true';
  
  // For per-service strategy, keep {service} placeholder in URI template
  // For other strategies, resolve placeholders
  if (strategy !== 'per-service') {
    uriTemplate = resolveUriTemplate(uriTemplate, { service, brand, tenantId });
  }
  
  // Database name template - keep as template for per-service, resolve for others
  let dbNameTemplate = dbConfig.dbNameTemplate || '{service}';
  if (strategy !== 'per-service') {
    dbNameTemplate = resolveDbNameTemplate(dbNameTemplate, { service, brand, tenantId });
  }
  
  // Create strategy based on config
  switch (strategy) {
    case 'shared':
      return createSharedDatabaseStrategy();
    
    case 'per-service':
      // For per-service strategy, ensure template contains {service} placeholder
      // If template is already resolved (e.g., 'core_service'), use default template
      if (!dbNameTemplate.includes('{service}')) {
        logger.warn('Database name template does not contain {service} placeholder for per-service strategy, using default template', {
          service,
          providedTemplate: dbNameTemplate
        });
        dbNameTemplate = '{service}';
      }
      // Ensure URI template contains {service} placeholder
      if (!uriTemplate.includes('{service}')) {
        logger.warn('URI template does not contain {service} placeholder for per-service strategy, using default template', {
          service,
          providedUri: uriTemplate
        });
        uriTemplate = 'mongodb://localhost:27017/{service}?directConnection=true';
      }
      // Pass template as-is - strategy will resolve {service} when resolve() is called
      return createPerServiceDatabaseStrategy(
        dbNameTemplate,  // Template with {service} placeholder
        uriTemplate       // Template with {service} placeholder
      );
    
    case 'per-brand':
      // For per-brand, resolve templates with brand
      const brandDbNameTemplate = resolveDbNameTemplate(
        dbConfig.dbNameTemplate || 'brand_{brand}',
        { service, brand, tenantId }
      );
      const brandUriTemplate = resolveUriTemplate(
        uriTemplate,
        { service, brand, tenantId }
      );
      return createPerBrandDatabaseStrategy(
        brandDbNameTemplate,
        brandUriTemplate
      );
    
    case 'per-brand-service':
      // For per-brand-service, resolve templates with brand
      const brandServiceDbNameTemplate = resolveDbNameTemplate(
        dbConfig.dbNameTemplate || 'brand_{brand}_{service}',
        { service, brand, tenantId }
      );
      const brandServiceUriTemplate = resolveUriTemplate(
        uriTemplate,
        { service, brand, tenantId }
      );
      return createPerBrandServiceDatabaseStrategy(
        brandServiceDbNameTemplate,
        brandServiceUriTemplate
      );
    
    case 'per-tenant':
      // For per-tenant, resolve templates with tenantId
      const tenantDbNameTemplate = resolveDbNameTemplate(
        dbConfig.dbNameTemplate || 'tenant_{tenantId}',
        { service, brand, tenantId }
      );
      const tenantUriTemplate = resolveUriTemplate(
        uriTemplate,
        { service, brand, tenantId }
      );
      return createPerTenantDatabaseStrategy(
        tenantDbNameTemplate,
        tenantUriTemplate
      );
    
    case 'per-tenant-service':
      // For per-tenant-service, resolve templates with tenantId
      const tenantServiceDbNameTemplate = resolveDbNameTemplate(
        dbConfig.dbNameTemplate || 'tenant_{tenantId}_{service}',
        { service, brand, tenantId }
      );
      const tenantServiceUriTemplate = resolveUriTemplate(
        uriTemplate,
        { service, brand, tenantId }
      );
      return createPerTenantServiceDatabaseStrategy(
        tenantServiceDbNameTemplate,
        tenantServiceUriTemplate
      );
    
    case 'per-shard':
      // For per-shard, keep templates (will be resolved with shardKey later)
      return createPerShardDatabaseStrategy({
        numShards: dbConfig.numShards || 4,
        dbNameTemplate: dbNameTemplate,
        uriTemplate: uriTemplate,
      });
    
    default:
      logger.warn('Unknown database strategy, falling back to per-service', { 
        service, 
        strategy: dbConfig.strategy 
      });
      // Ensure templates have {service} placeholder for per-service fallback
      const fallbackDbNameTemplate = dbNameTemplate.includes('{service}') ? dbNameTemplate : '{service}';
      const fallbackUriTemplate = uriTemplate.includes('{service}') ? uriTemplate : 'mongodb://localhost:27017/{service}?directConnection=true';
      return createPerServiceDatabaseStrategy(
        fallbackDbNameTemplate,
        fallbackUriTemplate
      );
  }
}

/**
 * Resolve URI template with placeholders
 */
function resolveUriTemplate(
  template: string,
  context: { service: string; brand?: string; tenantId?: string }
): string {
  let resolved = template;
  
  // Replace placeholders
  resolved = resolved.replace(/{service}/g, context.service.replace(/-/g, '_'));
  if (context.brand) {
    resolved = resolved.replace(/{brand}/g, context.brand);
  }
  if (context.tenantId) {
    resolved = resolved.replace(/{tenantId}/g, context.tenantId);
  }
  
  return resolved;
}

/**
 * Resolve database name template with placeholders
 */
function resolveDbNameTemplate(
  template: string,
  context: { service: string; brand?: string; tenantId?: string }
): string {
  let resolved = template;
  
  // Replace placeholders
  resolved = resolved.replace(/{service}/g, context.service.replace(/-/g, '_'));
  if (context.brand) {
    resolved = resolved.replace(/{brand}/g, context.brand);
  }
  if (context.tenantId) {
    resolved = resolved.replace(/{tenantId}/g, context.tenantId);
  }
  
  return resolved;
}

/**
 * Get Redis URL from config store
 * Falls back to environment variable or default
 */
export async function resolveRedisUrlFromConfig(
  service: string,
  options?: {
    brand?: string;
    tenantId?: string;
  }
): Promise<string | undefined> {
  const { brand, tenantId } = options || {};
  
  // Load database config to get Redis URL
  const dbConfig = await getConfigWithDefault<DatabaseConfig>(
    service,
    'database',
    { brand, tenantId }
  );
  
  // Return Redis URL from config, env var, or undefined
  return dbConfig?.redisUrl 
    || process.env.REDIS_URL 
    || (process.env.REDIS_PASSWORD 
      ? `redis://:${process.env.REDIS_PASSWORD}@localhost:6379`
      : undefined);
}

// ═══════════════════════════════════════════════════════════════════
// Centralized Database Access (Simplified API)
// ═══════════════════════════════════════════════════════════════════

/**
 * Cache for resolved database strategies per service
 * Key: "serviceName" or "serviceName:brand:tenantId"
 */
const strategyCache = new Map<string, DatabaseStrategyResolver>();

/**
 * Cache for resolved database instances
 * Key: "serviceName:brand:tenantId"
 */
const databaseCache = new Map<string, Db>();

/**
 * Get the central database (core_service) for bootstrapping.
 * 
 * This is the FIXED entry point before strategy is known.
 * Used for:
 * - Reading config (which is always in core_service)
 * - Authentication data (users, sessions)
 * - System-wide data (brands, tenants)
 * 
 * IMPORTANT: Uses getClient().db(CORE_DATABASE_NAME) to ALWAYS return core_service
 * regardless of what database getDatabase() currently points to.
 * This fixes the issue where scripts connect to different databases and
 * getDatabase() returns the wrong database.
 * 
 * @returns The core_service database
 * @throws Error if database not connected
 * 
 * @example
 * const db = getCentralDatabase();
 * const users = db.collection('users');
 */
export function getCentralDatabase(): Db {
  // ALWAYS return core_service, regardless of current connection
  // getDatabase() can change after scripts connect to other databases
  return getClient().db(CORE_DATABASE_NAME);
}

/**
 * Get the central MongoDB client for cross-database access.
 * Use this when you need to access multiple databases.
 * 
 * @example
 * const client = getCentralClient();
 * const coreDb = client.db('core_service');
 * const paymentDb = client.db('payment_service');
 */
export function getCentralClient() {
  return getClient();
}

/**
 * Get a database connection for a service.
 * 
 * Automatically reads strategy from config and resolves to correct database.
 * Services don't need to know about strategy resolution - just provide context.
 * 
 * Bootstrap flow:
 * 1. Reads database strategy from config (core_service.service_configs)
 * 2. Resolves to correct database based on strategy
 * 3. Caches result for performance
 * 
 * @param serviceName - Service name (e.g., 'bonus-service', 'payment-service')
 * @param context - Optional context (brand, tenantId) for multi-brand/tenant
 * @returns Database instance for the service
 * 
 * @example
 * // Simple usage (per-service strategy)
 * const db = await getServiceDatabase('bonus-service');
 * const bonuses = db.collection('user_bonuses');
 * 
 * @example
 * // Multi-brand usage
 * const db = await getServiceDatabase('bonus-service', { brand: 'brand-a' });
 * 
 * @example
 * // Multi-tenant usage
 * const db = await getServiceDatabase('payment-service', { tenantId: 'tenant-123' });
 */
export async function getServiceDatabase(
  serviceName: string,
  context?: {
    brand?: string;
    tenantId?: string;
  }
): Promise<Db> {
  const { brand, tenantId } = context || {};
  
  // Create cache key
  const cacheKey = `${serviceName}:${brand || ''}:${tenantId || ''}`;
  
  // Check database cache first
  const cachedDb = databaseCache.get(cacheKey);
  if (cachedDb) {
    return cachedDb;
  }
  
  // Get or create strategy for this service
  const strategy = await getServiceStrategy(serviceName, { brand, tenantId });
  
  // Resolve database using strategy
  const dbContext: DatabaseContext = {
    service: serviceName,
    ...(brand && { brand }),
    ...(tenantId && { tenantId }),
  };
  
  const db = await strategy.resolve(dbContext);
  
  // Cache the database instance
  databaseCache.set(cacheKey, db);
  
  logger.debug('Resolved service database', {
    service: serviceName,
    brand,
    tenantId,
    database: db.databaseName,
  });
  
  return db;
}

/**
 * Get the database strategy resolver for a service.
 * 
 * For most use cases, prefer getServiceDatabase() which handles strategy resolution.
 * Use this when you need direct access to the strategy resolver.
 * 
 * @param serviceName - Service name
 * @param context - Optional context for strategy resolution
 * @returns Database strategy resolver
 */
export async function getServiceStrategy(
  serviceName: string,
  context?: {
    brand?: string;
    tenantId?: string;
  }
): Promise<DatabaseStrategyResolver> {
  const { brand, tenantId } = context || {};
  
  // Create cache key for strategy
  const strategyCacheKey = `${serviceName}:${brand || ''}:${tenantId || ''}`;
  
  // Check strategy cache
  const cachedStrategy = strategyCache.get(strategyCacheKey);
  if (cachedStrategy) {
    return cachedStrategy;
  }
  
  // Resolve strategy from config
  const strategy = await resolveDatabaseStrategyFromConfig(serviceName, { brand, tenantId });
  
  // Cache the strategy
  strategyCache.set(strategyCacheKey, strategy);
  
  return strategy;
}

/**
 * Clear all database caches (useful for testing)
 */
export function clearDatabaseCaches(): void {
  strategyCache.clear();
  databaseCache.clear();
}

/**
 * Database context options for service initialization
 * 
 * This interface is used by services to configure their database access.
 * Services can either provide a direct database instance (for testing)
 * or let the system resolve it from config.
 */
export interface ServiceDatabaseOptions {
  /** Service name (required) */
  serviceName: string;
  /** Brand context (optional) */
  brand?: string;
  /** Tenant context (optional) */
  tenantId?: string;
  /** Direct database override (for testing) */
  database?: Db;
  /** Direct strategy override (for advanced use) */
  databaseStrategy?: DatabaseStrategyResolver;
}

/**
 * Initialize database for a service.
 * 
 * This is the recommended way to get database access in services.
 * Handles all the complexity of strategy resolution.
 * 
 * @param options - Service database options
 * @returns Object with database and strategy
 * 
 * @example
 * // In service startup
 * const { database, strategy, context } = await initializeServiceDatabase({
 *   serviceName: 'bonus-service',
 *   brand: process.env.BRAND,
 *   tenantId: process.env.TENANT_ID,
 * });
 * 
 * // Pass to components that need database access
 * handlerRegistry.initialize({ database, databaseStrategy: strategy, defaultContext: context });
 */
export async function initializeServiceDatabase(options: ServiceDatabaseOptions): Promise<{
  database: Db;
  strategy: DatabaseStrategyResolver;
  context: DatabaseContext;
}> {
  const { serviceName, brand, tenantId, database, databaseStrategy } = options;
  
  // Build context
  const context: DatabaseContext = {
    service: serviceName,
    ...(brand && { brand }),
    ...(tenantId && { tenantId }),
  };
  
  // If direct database provided, use it (for testing)
  if (database) {
    // Create a simple strategy that returns the provided database
    const simpleStrategy = createSharedDatabaseStrategy(database);
    return { database, strategy: simpleStrategy, context };
  }
  
  // If direct strategy provided, use it
  if (databaseStrategy) {
    const db = await databaseStrategy.resolve(context);
    return { database: db, strategy: databaseStrategy, context };
  }
  
  // Ensure database is connected before resolving strategy
  // This is needed because strategy resolution reads config from database
  try {
    getDatabase(); // Check if already connected
  } catch {
    // Not connected - connect to core_service first (bootstrap)
    const mongoUri = process.env.MONGO_URI 
      || `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;
    logger.info('Connecting to database for service initialization', { serviceName, mongoUri: mongoUri.replace(/\/\/[^@]+@/, '//<credentials>@') });
    await connectDatabase(mongoUri);
  }
  
  // Resolve from config (normal flow)
  const strategy = await getServiceStrategy(serviceName, { brand, tenantId });
  const db = await getServiceDatabase(serviceName, { brand, tenantId });
  
  return { database: db, strategy, context };
}
