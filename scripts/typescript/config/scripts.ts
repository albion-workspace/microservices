/**
 * Scripts Configuration and Utilities
 * 
 * Centralized configuration and utilities for all test scripts.
 * Loads configuration dynamically from MongoDB config store.
 * Provides MongoDB connections, service URLs, and other shared utilities.
 * 
 * Following CODING_STANDARDS.md:
 * - Uses abstractions (getConfigWithDefault, resolveContext, getServiceDatabase)
 * - Static imports
 * - Generic only (no service-specific logic)
 * - Import ordering: Internal packages → Type imports
 */

// Internal packages (core-service)
import { 
  getConfigWithDefault,
  resolveContext,
  resolveDatabaseStrategyFromConfig,
  resolveRedisUrlFromConfig,
  CORE_DATABASE_NAME,
  connectDatabase,
  getClient,
  closeDatabase,
  // Redis helpers
  connectRedis,
  getRedis,
  // Centralized database helpers
  getServiceDatabase as coreGetServiceDatabase,
  getCentralDatabase,
  getServiceStrategy,
  initializeServiceDatabase as coreInitializeServiceDatabase,
  clearDatabaseCaches,
  clearServiceConfigStores,
} from '../../../core-service/src/index.js';

// Type imports
import type {
  DatabaseResolutionOptions,
  DatabaseContext,
  DatabaseStrategyResolver,
  Db,
  MongoClient,
} from '../../../core-service/src/index.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ScriptConfig {
  /** MongoDB URI for core_service database (used to bootstrap config store) */
  coreMongoUri: string;
  /** Redis URL */
  redisUrl?: string;
  /** Brand ID (resolved dynamically) */
  brand?: string;
  /** Tenant ID (resolved dynamically) */
  tenantId?: string;
  /** Service URLs (from config store) */
  serviceUrls: {
    auth: string;
    payment: string;
    bonus: string;
    notification: string;
  };
}

export interface MongoConfig {
  core_service: string;
  payment_service: string;
  bonus_service: string;
  notification_service: string;
}

// ═══════════════════════════════════════════════════════════════════
// Exported Service URLs (for direct use in scripts)
// ═══════════════════════════════════════════════════════════════════

/**
 * Service URLs - loaded dynamically from MongoDB config store
 * These are initialized when loadScriptConfig() is called
 * Use these directly in scripts instead of hardcoded URLs
 */
export let AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
export let PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
export let BONUS_SERVICE_URL = 'http://localhost:3005/graphql';
export let NOTIFICATION_SERVICE_URL = 'http://localhost:3006/graphql';

// ═══════════════════════════════════════════════════════════════════
// Configuration Cache
// ═══════════════════════════════════════════════════════════════════

let cachedConfig: ScriptConfig | null = null;
let databaseConnected = false;

// ═══════════════════════════════════════════════════════════════════
// Database Strategy Cache
// ═══════════════════════════════════════════════════════════════════

/**
 * Cached database strategies per service
 */
const strategyCache = new Map<string, Awaited<ReturnType<typeof resolveDatabaseStrategyFromConfig>>>();

// ═══════════════════════════════════════════════════════════════════
// Configuration Loading
// ═══════════════════════════════════════════════════════════════════

/**
 * Bootstrap database connection for config store
 * This must be called before loading config
 * Uses static imports per CODING_STANDARDS.md
 */
async function bootstrapDatabase(): Promise<void> {
  // Check if client is actually connected (not just the flag)
  // Use ping-based verification (MongoDB driver v4 compatible)
  try {
    const client = getClient();
    const db = getCentralDatabase();
    // Verify connection is working using ping command (MongoDB driver v4 compatible)
    if (client && db) {
      try {
        await client.db('admin').command({ ping: 1 });
        databaseConnected = true;
        return;
      } catch {
        // Ping failed - connection is not working, need to reconnect
      }
    }
  } catch {
    // Client not available or not connected
  }

  // Reset flag if connection was lost
  databaseConnected = false;
  
  // Clear cached config to force reload after reconnection
  cachedConfig = null;

  // ALWAYS use core_service for bootstrap - ignore MONGO_URI env var
  // The env var might be set from a previous service run (e.g., notification_service)
  // Scripts must always bootstrap from core_service to read config correctly
  const coreMongoUri = `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;

  // Connect to database (this initializes the default config store)
  // If connectDatabase has cached db but client is disconnected, we need to close first
  try {
    await closeDatabase();
  } catch {
    // Ignore errors - might not be connected
  }
  
  await connectDatabase(coreMongoUri);
  databaseConnected = true;
}

/**
 * Get database strategy for a service
 * Uses config store to resolve strategy dynamically
 */
async function getDatabaseStrategy(
  service: string,
  options?: { brand?: string; tenantId?: string }
): Promise<Awaited<ReturnType<typeof resolveDatabaseStrategyFromConfig>>> {
  const cacheKey = `${service}:${options?.brand || ''}:${options?.tenantId || ''}`;
  
  if (strategyCache.has(cacheKey)) {
    return strategyCache.get(cacheKey)!;
  }

  const config = await loadScriptConfig();
  const strategy = await resolveDatabaseStrategyFromConfig(service, {
    brand: options?.brand || config.brand,
    tenantId: options?.tenantId || config.tenantId,
  });

  strategyCache.set(cacheKey, strategy);
  return strategy;
}

/**
 * Load script configuration from MongoDB config store
 * Falls back to environment variables if config not found
 */
export async function loadScriptConfig(): Promise<ScriptConfig> {
  // Always bootstrap connection first to ensure it's connected
  // This ensures connection is established even if cached config exists
  await bootstrapDatabase();
  
  // Return cached config if it exists and connection is verified
  if (cachedConfig) {
    return cachedConfig;
  }

  // Resolve brand/tenant dynamically
  const context = await resolveContext();
  const brand = context.brand;
  const tenantId = context.tenantId;

  // Load service URLs from config store (with fallback to env vars)
  let authUrl: string;
  try {
    authUrl = await getConfigWithDefault<string>('auth-service', 'serviceUrl', { brand, tenantId })
      ?? process.env.AUTH_URL 
      ?? 'http://localhost:3003/graphql';
  } catch {
    authUrl = process.env.AUTH_URL ?? 'http://localhost:3003/graphql';
  }

  let paymentUrl: string;
  try {
    paymentUrl = await getConfigWithDefault<string>('payment-service', 'serviceUrl', { brand, tenantId })
      ?? process.env.PAYMENT_URL 
      ?? 'http://localhost:3004/graphql';
  } catch {
    paymentUrl = process.env.PAYMENT_URL ?? 'http://localhost:3004/graphql';
  }

  let bonusUrl: string;
  try {
    bonusUrl = await getConfigWithDefault<string>('bonus-service', 'serviceUrl', { brand, tenantId })
      ?? process.env.BONUS_URL 
      ?? 'http://localhost:3005/graphql';
  } catch {
    bonusUrl = process.env.BONUS_URL ?? 'http://localhost:3005/graphql';
  }

  let notificationUrl: string;
  try {
    notificationUrl = await getConfigWithDefault<string>('notification-service', 'serviceUrl', { brand, tenantId })
      ?? process.env.NOTIFICATION_URL 
      ?? 'http://localhost:3006/graphql';
  } catch {
    notificationUrl = process.env.NOTIFICATION_URL ?? 'http://localhost:3006/graphql';
  }

  // Load Redis URL from config store (try core-service first, then any service)
  let redisUrl: string | undefined;
  try {
    redisUrl = await resolveRedisUrlFromConfig('core-service', { brand, tenantId });
  } catch {
    // Try auth-service as fallback
    try {
      redisUrl = await resolveRedisUrlFromConfig('auth-service', { brand, tenantId });
    } catch {
      // Fallback to env var
      redisUrl = process.env.REDIS_URL;
    }
  }

  // Get core MongoDB URI (from config or env)
  const coreMongoUri = process.env.MONGO_URI 
    || `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;

  cachedConfig = {
    coreMongoUri,
    redisUrl,
    brand,
    tenantId,
    serviceUrls: {
      auth: authUrl,
      payment: paymentUrl,
      bonus: bonusUrl,
      notification: notificationUrl,
    },
  };

  // Update exported service URLs for direct use in scripts
  AUTH_SERVICE_URL = authUrl;
  PAYMENT_SERVICE_URL = paymentUrl;
  BONUS_SERVICE_URL = bonusUrl;
  NOTIFICATION_SERVICE_URL = notificationUrl;

  return cachedConfig;
}

/**
 * Get MongoDB URI for a specific service
 * Resolves from config store using database strategy
 */
export async function getServiceMongoUri(service: string): Promise<string> {
  const config = await loadScriptConfig();
  
  // Resolve database strategy to get URI
  const strategy = await resolveDatabaseStrategyFromConfig(service, {
    brand: config.brand,
    tenantId: config.tenantId,
  });

  // For scripts, we need the URI template
  // Since we can't easily extract URI from strategy, fallback to config or env
  const dbConfig = await getConfigWithDefault<{ mongoUri?: string }>(
    service,
    'database',
    { brand: config.brand, tenantId: config.tenantId }
  );

  if (dbConfig?.mongoUri) {
    // Resolve placeholders
    let uri = dbConfig.mongoUri;
    uri = uri.replace(/{service}/g, service.replace(/-/g, '_'));
    if (config.brand) {
      uri = uri.replace(/{brand}/g, config.brand);
    }
    if (config.tenantId) {
      uri = uri.replace(/{tenantId}/g, config.tenantId);
    }
    return uri;
  }

  // Fallback to env var or default
  const envVar = process.env[`MONGO_URI_${service.toUpperCase().replace(/-/g, '_')}`];
  if (envVar) {
    return envVar;
  }

  // Default template
  const dbName = service === 'core-service' || service === 'auth-service' 
    ? CORE_DATABASE_NAME 
    : service.replace(/-/g, '_');
  return process.env.MONGO_URI 
    || `mongodb://localhost:27017/${dbName}?directConnection=true`;
}

// ═══════════════════════════════════════════════════════════════════
// Generic Database Resolution Functions (using strategy pattern)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get MongoDB database for a specific service using database strategy
 * Supports per-service, per-brand, per-tenant, and other strategies
 * 
 * NOTE: This is the scripts-specific function that requires a service name.
 * It wraps core-service's getServiceDatabase() for use in scripts.
 * Do NOT confuse with the old core-service getDatabase() (parameterless).
 * 
 * @param service - Service name (e.g., 'payment-service', 'bonus-service')
 * @param options - Optional context for database resolution
 * @returns Database instance resolved using configured strategy
 * 
 * @example
 * // Per-service strategy (default)
 * const db = await getServiceDb('payment-service');
 * 
 * // Per-brand strategy
 * const db = await getServiceDb('payment-service', { brand: 'brand-a' });
 * 
 * // Per-tenant strategy
 * const db = await getServiceDb('payment-service', { tenantId: 'tenant-123' });
 * 
 * // Per-brand-service strategy
 * const db = await getServiceDb('payment-service', { brand: 'brand-a', tenantId: 'tenant-123' });
 */
export async function getServiceDb(
  service: string,
  options?: {
    /** Brand identifier (for per-brand strategies) */
    brand?: string;
    /** Tenant ID (for per-tenant strategies) */
    tenantId?: string;
    /** Shard key (for per-shard strategy) */
    shardKey?: string | number;
  }
): Promise<Db> {
  // Ensure connection is established
  await loadScriptConfig();
  
  // Get config for default brand/tenant if not provided
  const config = await loadScriptConfig();
  
  // Merge options with config defaults
  const resolvedOptions = {
    brand: options?.brand || config.brand,
    tenantId: options?.tenantId || config.tenantId,
  };
  
  // Use centralized getServiceDatabase helper from core-service
  // This handles strategy resolution automatically
  const db = await coreGetServiceDatabase(service, resolvedOptions);
  
  return db;
}

/**
 * Get MongoDB client for a specific service
 * Extracts client from database instance (Db.client property)
 * 
 * @param service - Service name
 * @param options - Optional context for database resolution
 * @returns MongoDB client
 */
export async function getMongoClient(
  service: string,
  options?: { brand?: string; tenantId?: string; shardKey?: string | number }
): Promise<MongoClient> {
  // Get database first to ensure strategy is resolved
  const db = await getServiceDb(service, options);
  // Extract client from database instance
  return db.client;
}


// ═══════════════════════════════════════════════════════════════════
// Script Database Initialization (mirrors service pattern)
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize database for a script.
 * 
 * This is the recommended way to get database access in scripts.
 * Mirrors the service pattern (initializeServiceDatabase) but with
 * script-specific defaults and retry logic.
 * 
 * @param serviceName - Service name (e.g., 'bonus-service', 'payment-service')
 * @param options - Optional context (brand, tenantId)
 * @returns Object with database, strategy, and context
 * 
 * @example
 * // Initialize for a specific service
 * const { database, strategy, context } = await initializeScriptDatabase('bonus-service');
 * const bonuses = database.collection('user_bonuses');
 * 
 * @example
 * // With brand/tenant context
 * const { database, strategy, context } = await initializeScriptDatabase('payment-service', {
 *   brand: 'brand-a',
 *   tenantId: 'tenant-123',
 * });
 */
export async function initializeScriptDatabase(
  serviceName: string,
  options?: {
    brand?: string;
    tenantId?: string;
  }
): Promise<{
  database: Db;
  strategy: DatabaseStrategyResolver;
  context: DatabaseContext;
}> {
  // Ensure config is loaded (this establishes database connection)
  await loadScriptConfig();
  const config = await loadScriptConfig();
  
  // Merge options with config defaults
  const resolvedOptions = {
    brand: options?.brand || config.brand,
    tenantId: options?.tenantId || config.tenantId,
  };
  
  // Retry logic: if connection fails, clear cache and retry once
  let retries = 2;
  while (retries > 0) {
    try {
      // Use centralized initializeServiceDatabase from core-service
      const result = await coreInitializeServiceDatabase({
        serviceName,
        brand: resolvedOptions.brand,
        tenantId: resolvedOptions.tenantId,
      });
      
      // Verify connection is still alive
      await result.database.admin().ping();
      
      return result;
    } catch (error: any) {
      // Connection lost - clear cache and retry once
      if ((error?.message?.includes('not connected') || error?.message?.includes('Client must be connected')) && retries > 1) {
        clearConfigCache();
        clearDatabaseCaches();
        await loadScriptConfig();
        retries--;
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('Failed to initialize script database after retries');
}

/**
 * Close all MongoDB connections
 * Closes the MongoDB client and clears all caches
 */
export async function closeAllConnections(): Promise<void> {
  // Clear local strategy cache
  strategyCache.clear();
  
  // Clear core-service caches
  clearDatabaseCaches();
  
  // Reset database connected flag so we can reconnect later
  databaseConnected = false;
  
  // Close MongoDB connections (using static import)
  try {
    await closeDatabase();
  } catch (error) {
    // If closeDatabase fails (e.g., not connected), that's okay
    // Just log and continue
    if (error instanceof Error && !error.message.includes('not connected')) {
      console.warn('Warning: Error closing database connections:', error.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Convenience Functions for Specific Services (using strategy pattern)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get MongoDB database for core_service (formerly auth_service)
 * Uses database strategy from config store
 * 
 * @param options - Optional context for database resolution
 */
export async function getAuthDatabase(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<Db> {
  return getServiceDb('core-service', options);
}

/**
 * Get MongoDB client for core_service database (formerly auth_service)
 */
export async function getAuthClient(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<MongoClient> {
  return getMongoClient('core-service', options);
}

/**
 * Get MongoDB database for core_service (new name)
 */
export async function getCoreDatabase(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<Db> {
  return getServiceDb('core-service', options);
}

/**
 * Get MongoDB client for core_service database (new name)
 */
export async function getCoreClient(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<MongoClient> {
  return getMongoClient('core-service', options);
}

/**
 * Get MongoDB database for payment_service
 * Uses database strategy from config store
 * 
 * @param options - Optional context for database resolution
 */
export async function getPaymentDatabase(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<Db> {
  return getServiceDb('payment-service', options);
}

/**
 * Get MongoDB client for payment_service database
 */
export async function getPaymentClient(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<MongoClient> {
  return getMongoClient('payment-service', options);
}

/**
 * Get MongoDB database for bonus_service
 * Uses database strategy from config store
 * 
 * @param options - Optional context for database resolution
 */
export async function getBonusDatabase(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<Db> {
  return getServiceDb('bonus-service', options);
}

/**
 * Get MongoDB client for bonus_service database
 */
export async function getBonusClient(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<MongoClient> {
  return getMongoClient('bonus-service', options);
}

/**
 * Get MongoDB database for notification_service
 * Uses database strategy from config store
 * 
 * @param options - Optional context for database resolution
 */
export async function getNotificationDatabase(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<Db> {
  return getServiceDb('notification-service', options);
}

/**
 * Get MongoDB client for notification_service database
 */
export async function getNotificationClient(options?: { brand?: string; tenantId?: string; shardKey?: string | number }): Promise<MongoClient> {
  return getMongoClient('notification-service', options);
}

// ═══════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Clear cached configuration (for testing)
 * Also clears core-service database caches
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  strategyCache.clear();
  databaseConnected = false;
  // Also clear core-service caches for consistency
  clearDatabaseCaches();
}

// ═══════════════════════════════════════════════════════════════════
// Command Line Argument Parsing Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse brand and tenant from command line arguments
 * Supports --brand and --tenant flags
 * 
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @returns Parsed brand and tenantId
 * 
 * @example
 * const args = process.argv.slice(2);
 * const { brand, tenantId } = parseBrandTenantArgs(args);
 * const db = await getServiceDb('payment-service', { brand, tenantId });
 */
export function parseBrandTenantArgs(args: string[]): { brand?: string; tenantId?: string } {
  let brand: string | undefined;
  let tenantId: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--brand' && args[i + 1]) {
      brand = args[i + 1];
      i++;
    } else if (args[i] === '--tenant' && args[i + 1]) {
      tenantId = args[i + 1];
      i++;
    } else if (args[i].startsWith('--brand=')) {
      brand = args[i].split('=')[1];
    } else if (args[i].startsWith('--tenant=')) {
      tenantId = args[i].split('=')[1];
    }
  }
  
  return { brand, tenantId };
}

/**
 * Get database context from command line arguments or config
 * Combines CLI args with resolved config defaults
 * 
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @returns Database context with brand and tenantId
 */
export async function getDatabaseContextFromArgs(args: string[]): Promise<{ brand?: string; tenantId?: string }> {
  const cliArgs = parseBrandTenantArgs(args);
  const config = await loadScriptConfig();
  
  return {
    brand: cliArgs.brand || config.brand,
    tenantId: cliArgs.tenantId || config.tenantId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Database Management Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Drop all service databases
 * Uses database strategy to resolve which databases to drop
 * 
 * IMPORTANT: By default (no options), uses per-service strategy (no brand/tenant).
 * This drops: core_service, payment_service, bonus_service, notification_service
 * 
 * @param options - Optional context for database resolution (brand/tenant)
 *                  If not provided, uses per-service strategy (default)
 * @returns Array of dropped database names
 * 
 * @example
 * // Drop databases using per-service strategy (default - no brand/tenant)
 * // Drops: core_service, payment_service, bonus_service, notification_service
 * const dropped = await dropAllDatabases();
 * 
 * // Drop databases for specific brand (per-brand or per-brand-service strategy)
 * const dropped = await dropAllDatabases({ brand: 'brand-a' });
 * 
 * // Drop databases for specific tenant (per-tenant or per-tenant-service strategy)
 * const dropped = await dropAllDatabases({ tenantId: 'tenant-123' });
 */
export async function dropAllDatabases(options?: { brand?: string; tenantId?: string }): Promise<string[]> {
  const SERVICES = [
    'core-service',
    'payment-service',
    'bonus-service',
    'notification-service',
  ] as const;

  // Clear ALL caches to ensure fresh database resolution
  clearConfigCache();
  clearDatabaseCaches();
  clearServiceConfigStores();
  strategyCache.clear();
  cachedConfig = null;
  databaseConnected = false;

  // Ensure we're connected to core_service
  const coreMongoUri = `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;
  await connectDatabase(coreMongoUri);
  databaseConnected = true;

  // If no options provided, explicitly use per-service strategy (no brand/tenant)
  // This ensures we drop: core_service, payment_service, bonus_service, notification_service
  const dbOptions = options || {};

  const dropped: string[] = [];

  console.log(`\n📋 Dropping databases using ${options?.brand ? 'per-brand' : options?.tenantId ? 'per-tenant' : 'per-service'} strategy...\n`);

  // Use client directly to drop known databases (simpler and more reliable)
  // This avoids going through the strategy resolver which might have stale caches
  const client = getClient();
  const knownDatabases = [
    CORE_DATABASE_NAME,       // core_service
    'payment_service',
    'bonus_service', 
    'notification_service',
  ];
  
  for (const dbName of knownDatabases) {
    try {
      const db = client.db(dbName);
      await db.dropDatabase();
      dropped.push(dbName);
      console.log(`✅ Successfully dropped: ${dbName}`);
    } catch (error) {
      console.error(`❌ Error dropping ${dbName}:`, error instanceof Error ? error.message : String(error));
      // Continue with other databases even if one fails
    }
  }

  // Flush Redis cache to clear any stale data (sessions, pending operations, etc.)
  try {
    console.log('\n🧹 Flushing Redis cache...');
    const redisUrl = process.env.REDIS_URL 
      || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`;
    await connectRedis(redisUrl);
    const redis = getRedis();
    if (redis) {
      await redis.flushAll();
      console.log('✅ Redis cache flushed');
    } else {
      console.log('⚠️  Redis not connected, skipping flush');
    }
  } catch (redisError) {
    console.warn('⚠️  Warning: Could not flush Redis:', redisError instanceof Error ? redisError.message : String(redisError));
  }

  // After dropping databases, ensure core_service database is recreated
  // This is needed because config store lives in core_service
  // Use direct connection to avoid config store dependency loop
  try {
    console.log('\n🔄 Recreating core_service database for config store...');
    
    // Use static imports (already imported at top level)
    const coreMongoUri = process.env.MONGO_URI 
      || `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;
    
    // Connect directly to core_service (bypasses config store)
    await connectDatabase(coreMongoUri);
    const client = getClient();
    const coreDb = client.db(CORE_DATABASE_NAME);
    
    // Ensure service_configs collection exists (will be created on first use)
    try {
      await coreDb.collection('service_configs').createIndex(
        { service: 1, key: 1, brand: 1, tenantId: 1 }, 
        { unique: true, background: true }
      );
    } catch (indexError) {
      // Index might already exist or collection might not exist yet - that's fine
      // Collection will be created when first config is written
    }
    console.log('✅ core_service database ready for service_configs');
    console.log('   Note: Config defaults will be auto-created when services start or when getConfigWithDefault() is called\n');
  } catch (error) {
    console.warn('⚠️  Warning: Could not recreate core_service database:', error instanceof Error ? error.message : String(error));
    console.warn('   Config loading may fail until services restart and recreate configs\n');
  }

  return dropped;
}
