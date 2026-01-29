/**
 * Dynamic Configuration Store
 * 
 * Generic MongoDB-based configuration management with:
 * - Permission-based access (sensitive paths vs public)
 * - Multi-brand/tenant support
 * - Dynamic reloading
 * - Caching layer
 * - Automatic default creation (get-or-create pattern)
 * - Uses ServiceDatabaseAccessor for consistent database access
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses ServiceDatabaseAccessor pattern for database access
 * - Static imports (not require)
 * - Uses hasRole/hasAnyRole from core-service/access
 * - No backward compatibility / legacy fallbacks
 */

// External packages (type imports)
import type { Collection, Document, Filter, Db } from 'mongodb';

// Local imports
import { getClient } from '../databases/mongodb.js';
import { CORE_DATABASE_NAME } from '../databases/core-database.js';
import { getCache, setCache, deleteCache, deleteCachePattern } from '../databases/cache.js';
import { resolveDatabaseStrategyFromConfig } from '../databases/strategy-config.js';
import { logger } from './logger.js';
import { hasAnyRole } from './permissions.js';
import { generateMongoId } from '../databases/mongodb-utils.js';

// Local type imports
import type { UserContext } from '../types/index.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';
import type { ServiceDatabaseAccessor } from '../databases/service-database.js';

// ═══════════════════════════════════════════════════════════════════
// Module-level State (Config Store Caches)
// ═══════════════════════════════════════════════════════════════════

/**
 * Bootstrap config store - always uses core_service database
 * Used for reading 'database' config (strategy) during bootstrap
 */
let bootstrapConfigStore: ConfigStore | null = null;

/**
 * Service config stores - cached per service/brand/tenant
 * Used for reading service-specific configs that follow the strategy
 */
const serviceConfigStores = new Map<string, ConfigStore>();

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ConfigEntry {
  id: string;
  service: string;
  brand?: string;
  tenantId?: string;
  key: string;
  value: unknown;
  metadata?: {
    description?: string;
    updatedBy?: string;
    sensitivePaths?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
  __v?: number;
}

export interface ConfigStoreOptions {
  /** Collection name (default: 'service_configs') */
  collectionName?: string;
  /** Cache enabled (default: true) */
  cacheEnabled?: boolean;
  /** Cache TTL in seconds (default: 300) */
  cacheTtl?: number;
  
  /**
   * Service database accessor (RECOMMENDED)
   * Use this for consistent database access following the standard pattern.
   * 
   * @example
   * // Use service's database accessor
   * import { db } from './database.js';
   * const configStore = createConfigStore({ accessor: db });
   */
  accessor?: ServiceDatabaseAccessor;
  
  /** 
   * Database instance to use directly (alternative to accessor)
   * Use this when you have a specific Db instance.
   */
  database?: Db;
  
  /**
   * Database strategy resolver (advanced)
   * Use this for dynamic database resolution based on context.
   * Takes precedence over `database` option.
   */
  databaseStrategy?: DatabaseStrategyResolver;
  
  /**
   * Force use of core_service database (INTERNAL - for bootstrap only)
   * When true, always uses core_service database.
   * This is used internally for the bootstrap config store.
   */
  useCoreDatabase?: boolean;
}

export interface GetConfigOptions {
  brand?: string;
  tenantId?: string;
  shardKey?: string | number;
  user?: UserContext | null;
  defaultValue?: unknown;
  defaultSensitivePaths?: string[];
  defaultMetadata?: { description?: string };
}

export interface GetAllConfigOptions {
  brand?: string;
  tenantId?: string;
  shardKey?: string | number;
  user?: UserContext | null;
  includeSensitive?: boolean;
  defaults?: Record<string, unknown>;
  defaultSensitivePaths?: Record<string, string[]>;
}

export interface SetConfigOptions {
  brand?: string;
  tenantId?: string;
  shardKey?: string | number;
  sensitivePaths?: string[];
  metadata?: { description?: string; updatedBy?: string };
  user?: UserContext | null;
}

// ═══════════════════════════════════════════════════════════════════
// Default Config Registry (Similar to Error Code Registry)
// ═══════════════════════════════════════════════════════════════════

/**
 * Default config registry - stores defaults per service that will be auto-created if missing
 * Similar pattern to error code registry
 */
const defaultConfigRegistry = new Map<string, Map<string, {
  value: unknown;
  sensitivePaths?: string[];
  description?: string;
}>>();

/**
 * Register default configurations for a service
 * Similar to registerServiceErrorCodes - defines defaults that will be auto-created if missing
 * 
 * @example
 * registerServiceConfigDefaults('auth-service', {
 *   otpLength: { value: 6, description: 'OTP code length' },
 *   oauth: {
 *     value: { google: { clientId: '', clientSecret: '' } },
 *     sensitivePaths: ['oauth.google.clientSecret'],
 *     description: 'OAuth configuration',
 *   },
 * });
 */
export function registerServiceConfigDefaults(
  service: string,
  defaults: Record<string, {
    value: unknown;
    sensitivePaths?: string[];
    description?: string;
  }>
): void {
  if (!defaultConfigRegistry.has(service)) {
    defaultConfigRegistry.set(service, new Map());
  }
  
  const serviceDefaults = defaultConfigRegistry.get(service)!;
  for (const [key, config] of Object.entries(defaults)) {
    serviceDefaults.set(key, config);
  }
  
  logger.debug('Registered default configs', { service, count: Object.keys(defaults).length });
}

/**
 * Get default config for a service and key
 */
function getDefaultConfig(
  service: string,
  key: string
): { value: unknown; sensitivePaths?: string[]; description?: string } | null {
  const serviceDefaults = defaultConfigRegistry.get(service);
  if (!serviceDefaults) return null;
  return serviceDefaults.get(key) || null;
}

/**
 * Get all registered default configs for a service
 */
function getAllDefaultConfigs(service: string): Map<string, {
  value: unknown;
  sensitivePaths?: string[];
  description?: string;
}> {
  return defaultConfigRegistry.get(service) || new Map();
}

/**
 * Ensure all registered default configs are created in the database
 * Call this after database connection is established to pre-create all defaults
 * 
 * @example
 * // After createGateway() connects to database
 * await ensureDefaultConfigsCreated('auth-service');
 */
export async function ensureDefaultConfigsCreated(
  service: string,
  options?: {
    brand?: string;
    tenantId?: string;
    configStore?: ConfigStore;
  }
): Promise<number> {
  const { brand, tenantId, configStore } = options || {};
  const store = configStore || bootstrapConfigStore || createConfigStore();
  
  const defaults = getAllDefaultConfigs(service);
  if (defaults.size === 0) {
    logger.debug('No default configs registered for service', { service });
    return 0;
  }
  
  let createdCount = 0;
  let skippedCount = 0;
  
  for (const [key, defaultConfig] of defaults.entries()) {
    try {
      // Try to get config - this will auto-create if missing
      const existing = await store.get(service, key, { brand, tenantId });
      
      if (existing === null) {
        // Config doesn't exist, create it
        await store.set(service, key, defaultConfig.value, {
          brand,
          tenantId,
          sensitivePaths: defaultConfig.sensitivePaths,
          metadata: {
            description: defaultConfig.description || `Default config for ${service}.${key}`,
            updatedBy: 'system',
          },
        });
        createdCount++;
        logger.debug('Created default config', { service, key });
      } else {
        skippedCount++;
        logger.debug('Config already exists, skipped', { service, key });
      }
    } catch (error) {
      // Database not connected or other error - skip this config
      logger.debug('Could not ensure config creation (DB may not be connected)', { 
        service, 
        key, 
        error: error instanceof Error ? error.message : String(error)
      });
      skippedCount++;
    }
  }
  
  logger.info('Ensured default configs created', { 
    service, 
    total: defaults.size, 
    created: createdCount, 
    skipped: skippedCount 
  });
  
  return createdCount;
}

// ═══════════════════════════════════════════════════════════════════
// Permission Filtering
// ═══════════════════════════════════════════════════════════════════

/**
 * Filter sensitive paths within config values based on user permissions
 * Supports nested objects with sensitive fields
 */
function filterSensitivePaths(
  value: unknown,
  sensitivePaths: string[] | undefined,
  user: UserContext | null
): unknown {
  // No sensitive paths = return as-is
  if (!sensitivePaths || sensitivePaths.length === 0) {
    return value;
  }

  // Admin/system role = return all (including sensitive)
  if (user && hasAnyRole('system', 'admin')(user)) {
    return value; // Full access
  }

  // Regular user = filter out sensitive paths
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value; // Primitive or array - return as-is
  }

  // Clone object and remove sensitive paths
  const filtered = { ...value as Record<string, unknown> };
  
  for (const path of sensitivePaths) {
    // Split dot-notation path (e.g., 'google.clientSecret' -> ['google', 'clientSecret'])
    const parts = path.split('.');
    
    if (parts.length === 1) {
      // Top-level key
      delete filtered[parts[0]];
    } else {
      // Nested path - navigate and delete
      let current: any = filtered;
      for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] && typeof current[parts[i]] === 'object') {
          current = current[parts[i]];
        } else {
          break; // Path doesn't exist, skip
        }
      }
      // Delete the final key
      if (current && typeof current === 'object') {
        delete current[parts[parts.length - 1]];
      }
    }
  }

  return filtered;
}

/**
 * Filter configs based on user permissions
 * Handles both top-level and nested sensitive fields
 */
function filterConfigsByPermission(
  configs: ConfigEntry[],
  user: UserContext | null
): ConfigEntry[] {
  return configs.map(config => ({
    ...config,
    value: filterSensitivePaths(
      config.value,
      config.metadata?.sensitivePaths,
      user
    ),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Config Store Class
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration Store - Generic MongoDB-based config management
 * 
 * Features:
 * - Permission-based access (sensitive paths vs public)
 * - Multi-brand/tenant support
 * - Dynamic reloading
 * - Caching layer
 * - Automatic default creation (get-or-create pattern)
 * - Uses ServiceDatabaseAccessor for consistent database access
 * 
 * Database access priority:
 * 1. databaseStrategy (if provided with context)
 * 2. accessor.getDb() (recommended for services)
 * 3. database (direct Db instance)
 * 4. useCoreDatabase (internal bootstrap only)
 */
export class ConfigStore {
  private collectionName: string;
  private cacheEnabled: boolean;
  private cacheTtl: number;
  private accessor: ServiceDatabaseAccessor | null;
  private database: Db | null;
  private databaseStrategy: DatabaseStrategyResolver | null;
  private useCoreDatabase: boolean;
  private collection: Collection<Document> | null = null;

  constructor(options: ConfigStoreOptions = {}) {
    this.collectionName = options.collectionName || 'service_configs';
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTtl = options.cacheTtl || 300; // 5 minutes default
    this.accessor = options.accessor || null;
    this.database = options.database || null;
    this.databaseStrategy = options.databaseStrategy || null;
    this.useCoreDatabase = options.useCoreDatabase || false;
    
    // Validate: at least one database source must be provided
    if (!options.accessor && !options.database && !options.databaseStrategy && !options.useCoreDatabase) {
      logger.warn('ConfigStore created without database source. Provide accessor, database, databaseStrategy, or useCoreDatabase.');
    }
  }

  /**
   * Get MongoDB database instance
   * 
   * Priority:
   * 1. databaseStrategy (with context) - for dynamic resolution
   * 2. accessor.getDb() - recommended for services
   * 3. database - direct Db instance
   * 4. useCoreDatabase - internal bootstrap only
   * 
   * Returns null if database is not connected yet (allows graceful fallback to defaults)
   */
  private async getDatabaseInstance(context?: DatabaseContext): Promise<Db | null> {
    try {
      // 1. Strategy resolver takes precedence (for multi-tenant/brand scenarios)
      if (this.databaseStrategy && context) {
        return await this.databaseStrategy.resolve(context);
      }
      
      // 2. Use service database accessor (RECOMMENDED pattern)
      if (this.accessor) {
        if (!this.accessor.isInitialized()) {
          logger.debug('ConfigStore accessor not yet initialized, returning null');
          return null;
        }
        return await this.accessor.getDb();
      }
      
      // 3. Use provided database instance directly
      if (this.database) {
        return this.database;
      }
      
      // 4. Bootstrap mode: use core_service database directly
      // This is internal for getCentralConfigStore() only
      if (this.useCoreDatabase) {
        try {
          const client = getClient();
          // Verify connection
          await client.db('admin').command({ ping: 1 });
          // Always return core_service database
          return client.db(CORE_DATABASE_NAME);
        } catch (dbError: any) {
          if (dbError?.message?.includes('not connected') || dbError?.message?.includes('Client must be connected')) {
            return null;
          }
          throw dbError;
        }
      }
      
      // No database source configured - return null
      // This allows graceful fallback to defaults
      return null;
    } catch (error) {
      // Database not connected yet - return null to allow fallback to defaults
      return null;
    }
  }

  /**
   * Get MongoDB collection (lazy initialization)
   * Uses the database instance provided in constructor, strategy resolver, or getDatabase()
   * Returns null if database is not connected (allows graceful fallback to defaults)
   */
  private async getCollection(context?: DatabaseContext): Promise<Collection<Document> | null> {
    // Always resolve database (may change based on context for strategy)
    let db = await this.getDatabaseInstance(context);
    
    // If database not connected, return null (will use defaults)
    if (!db) {
      return null;
    }
    
    // Verify connection is still alive before returning collection
    // This prevents using a collection with a disconnected client
    try {
      await db.admin().ping();
    } catch (pingError: any) {
      // Connection lost - try to reconnect once
      if (pingError?.message?.includes('not connected') || pingError?.message?.includes('Client must be connected')) {
        // Try to get database again (might reconnect)
        db = await this.getDatabaseInstance(context);
        if (!db) {
          return null;
        }
        // Try ping again after reconnection attempt
        try {
          await db.admin().ping();
        } catch (retryError: any) {
          // Still disconnected - return null to use defaults
          if (retryError?.message?.includes('not connected') || retryError?.message?.includes('Client must be connected')) {
            return null;
          }
          throw retryError;
        }
      } else {
        // Re-throw other errors (e.g., network errors)
        throw pingError;
      }
    }
    
    // For strategy-based resolution, we need to get collection per context
    // Cache key includes context for strategy-based lookups
    const cacheKey = context 
      ? `${this.collectionName}:${context.service}:${context.brand || ''}:${context.tenantId || ''}`
      : this.collectionName;
    
    // If using strategy, we can't cache collection globally (it changes per context)
    if (this.databaseStrategy && context) {
      // Return collection for this specific context
      return db.collection(this.collectionName);
    }
    
    // For static database, cache collection
    if (!this.collection) {
      this.collection = db.collection(this.collectionName);
      
      // Create indexes for performance
      await this.collection.createIndex(
        { service: 1, brand: 1, tenantId: 1, key: 1 },
        { unique: true }
      ).catch(() => {}); // Ignore if already exists
      
      await this.collection.createIndex(
        { service: 1, brand: 1 }
      ).catch(() => {}); // Ignore if already exists
      
      await this.collection.createIndex(
        { 'metadata.sensitivePaths': 1 }
      ).catch(() => {}); // Ignore if already exists
    }
    
    // If using strategy, return collection directly (can't cache globally)
    if (this.databaseStrategy && context) {
      return this.collection;
    }
    
    return this.collection;
  }

  /**
   * Build cache key for a config entry
   */
  private buildCacheKey(service: string, key: string, brand?: string, tenantId?: string): string {
    const parts = [service, key];
    if (brand) parts.push(`brand:${brand}`);
    if (tenantId) parts.push(`tenant:${tenantId}`);
    return `config:${parts.join(':')}`;
  }

  /**
   * Build MongoDB query filter
   */
  private buildQuery(service: string, key: string, brand?: string, tenantId?: string): Filter<Document> {
    const query: Filter<Document> = { service, key };
    if (brand !== undefined) query.brand = brand;
    if (tenantId !== undefined) query.tenantId = tenantId;
    return query;
  }

  /**
   * Get configuration value (with automatic default creation)
   * If config doesn't exist and default is provided, creates it in database
   * Automatically filters sensitive paths based on user permissions
   */
  async get<T = unknown>(
    service: string,
    key: string,
    options: GetConfigOptions = {}
  ): Promise<T | null> {
    const { brand, tenantId, shardKey, user, defaultValue, defaultSensitivePaths, defaultMetadata } = options;
    const cacheKey = this.buildCacheKey(service, key, brand, tenantId);
    const query = this.buildQuery(service, key, brand, tenantId);
    const userContext = user ?? null;

    // Try cache first (if enabled)
    if (this.cacheEnabled) {
      const cached = await this.getFromCache<T>(cacheKey, userContext);
      if (cached !== null) {
        return cached;
      }
    }

    // Try database (with context for strategy resolution)
    const context: DatabaseContext = { service, brand, tenantId, shardKey: options.shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, return default only (don't try to create)
    if (!collection) {
      const defaultConfig = defaultValue !== undefined 
        ? { value: defaultValue, sensitivePaths: defaultSensitivePaths, description: defaultMetadata?.description }
        : getDefaultConfig(service, key);
      
      if (defaultConfig) {
        return defaultConfig.value as T;
      }
      return null;
    }
    
    const doc = await collection.findOne(query);
    
    if (doc) {
      const config = this.normalizeDocument(doc);
      const filtered = filterConfigsByPermission([config], userContext)[0];
      
      // Cache result
      if (this.cacheEnabled) {
        await this.setCacheValue(cacheKey, filtered.value, userContext);
      }
      
      return filtered.value as T;
    }

    // Config doesn't exist - check for default
    const defaultConfig = defaultValue !== undefined 
      ? { value: defaultValue, sensitivePaths: defaultSensitivePaths, description: defaultMetadata?.description }
      : getDefaultConfig(service, key);
    
    if (defaultConfig) {
      // Auto-create config with default value (only if database is connected)
      // If database not connected, we'll retry on next access
      try {
        await this.set(service, key, defaultConfig.value, {
          brand,
          tenantId,
          shardKey: options.shardKey,
          sensitivePaths: defaultConfig.sensitivePaths,
          metadata: {
            description: defaultConfig.description || `Default config for ${service}.${key}`,
            updatedBy: 'system',
          },
        });
        logger.debug('Auto-created config from default', { service, key });
      } catch (error) {
        // Database not connected or set failed - log but don't throw
        // Config will be created on next access when DB is available
        logger.debug('Could not auto-create config (DB may not be connected yet), will retry on next access', { 
          service, 
          key, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Return filtered default value (even if creation failed)
      const filtered = filterSensitivePaths(defaultConfig.value, defaultConfig.sensitivePaths, userContext);
      return filtered as T;
    }

    return null;
  }

  /**
   * Get all configurations for a service
   * Returns public + sensitive paths (if user has permission)
   * Automatically filters nested sensitive fields based on metadata.sensitivePaths
   * Automatically creates missing configs from defaults if provided
   */
  async getAll<T = Record<string, unknown>>(
    service: string,
    options: GetAllConfigOptions = {}
  ): Promise<T> {
    const { brand, tenantId, shardKey, user, includeSensitive, defaults, defaultSensitivePaths } = options;
    const query: Filter<Document> = { service };
    if (brand !== undefined) query.brand = brand;
    if (tenantId !== undefined) query.tenantId = tenantId;
    const userContext = user ?? null;

    const context: DatabaseContext = { service, brand, tenantId, shardKey: options.shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, return defaults only
    if (!collection) {
      const result: Record<string, unknown> = {};
      if (defaults) {
        const userContext = user ?? null;
        for (const [key, defaultValue] of Object.entries(defaults)) {
          const defaultConfig = getDefaultConfig(service, key);
          const sensitivePaths = defaultSensitivePaths?.[key] || defaultConfig?.sensitivePaths;
          const filteredValue = filterSensitivePaths(defaultValue, sensitivePaths, userContext);
          result[key] = filteredValue;
        }
      }
      return result as T;
    }
    
    const docs = await collection.find(query).toArray();
    
    const configs = docs.map(doc => this.normalizeDocument(doc));
    const filtered = filterConfigsByPermission(configs, includeSensitive ? null : userContext);
    
    // Build result object
    const result: Record<string, unknown> = {};
    for (const config of filtered) {
      result[config.key] = config.value;
    }

    // Auto-create missing configs from defaults
    if (defaults) {
      for (const [key, defaultValue] of Object.entries(defaults)) {
        if (!(key in result)) {
          const defaultConfig = getDefaultConfig(service, key);
          const sensitivePaths = defaultSensitivePaths?.[key] || defaultConfig?.sensitivePaths;
          
          await this.set(service, key, defaultValue, {
            brand,
            tenantId,
            shardKey,
            sensitivePaths,
            metadata: {
              description: defaultConfig?.description || `Default config for ${service}.${key}`,
              updatedBy: 'system',
            },
          });
          
          // Add to result (filtered)
          const filteredValue = filterSensitivePaths(defaultValue, sensitivePaths, userContext);
          result[key] = filteredValue;
        }
      }
    }

    return result as T;
  }

  /**
   * Set configuration value
   * Requires admin/system role (checked by caller)
   * 
   * Note: Automatically increments __v (MongoDB version key) on updates
   */
  async set(
    service: string,
    key: string,
    value: unknown,
    options: SetConfigOptions = {}
  ): Promise<void> {
    const { brand, tenantId, shardKey, sensitivePaths, metadata, user } = options;
    const query = this.buildQuery(service, key, brand, tenantId);
    const cacheKey = this.buildCacheKey(service, key, brand, tenantId);

    const context: DatabaseContext = { service, brand, tenantId, shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, skip set (will be created later when DB is available)
    if (!collection) {
      logger.debug('Database not connected, skipping config set', { service, key });
      return;
    }
    
    const now = new Date();
    
    // Check if config exists
    const existing = await collection.findOne(query);
    
    if (existing) {
      // Update existing config
      await collection.findOneAndUpdate(
        query,
        {
          $set: {
            value,
            metadata: {
              ...existing.metadata,
              ...metadata,
              sensitivePaths: sensitivePaths || existing.metadata?.sensitivePaths,
            },
            updatedAt: now,
          },
          $inc: { __v: 1 }, // Increment version (like Mongoose)
        },
        { returnDocument: 'after' }
      );
    } else {
      // Create new config
      const { objectId, idString } = generateMongoId();
      await collection.insertOne({
        _id: objectId,
        id: idString,
        service,
        brand,
        tenantId,
        key,
        value,
        metadata: {
          ...metadata,
          sensitivePaths,
        },
        createdAt: now,
        updatedAt: now,
        __v: 0, // Initial version
      });
    }

    // Invalidate cache
    if (this.cacheEnabled) {
      await deleteCache(cacheKey);
      await deleteCachePattern(`config:${service}:*`);
    }
  }

  /**
   * Get full config entry (with metadata) - for GraphQL API
   * Returns ConfigEntry with all fields including metadata
   */
  async getEntry(
    service: string,
    key: string,
    options: { brand?: string; tenantId?: string; shardKey?: string | number; user?: UserContext | null } = {}
  ): Promise<ConfigEntry | null> {
    const { brand, tenantId, shardKey, user } = options;
    const query = this.buildQuery(service, key, brand, tenantId);
    const userContext = user ?? null;

    const context: DatabaseContext = { service, brand, tenantId, shardKey: options.shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, return null
    if (!collection) {
      return null;
    }
    
    const doc = await collection.findOne(query);
    
    if (!doc) {
      return null;
    }
    
    const config = this.normalizeDocument(doc);
    
    // Filter sensitive paths based on permissions
    const filtered = filterConfigsByPermission([config], userContext)[0];
    
    return filtered;
  }

  /**
   * Get all config entries (with metadata) - for GraphQL API
   * Returns ConfigEntry[] with all fields including metadata
   */
  async getAllEntries(
    service: string,
    options: GetAllConfigOptions = {}
  ): Promise<ConfigEntry[]> {
    const { brand, tenantId, shardKey, user, includeSensitive } = options;
    const query: Filter<Document> = { service };
    if (brand !== undefined) query.brand = brand;
    if (tenantId !== undefined) query.tenantId = tenantId;
    const userContext = user ?? null;

    const context: DatabaseContext = { service, brand, tenantId, shardKey: options.shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, return empty array
    if (!collection) {
      return [];
    }
    
    const docs = await collection.find(query).toArray();
    
    const configs = docs.map(doc => this.normalizeDocument(doc));
    const filtered = filterConfigsByPermission(configs, includeSensitive ? null : userContext);
    
    return filtered;
  }

  /**
   * Delete configuration
   * Requires admin/system role (checked by caller)
   */
  async delete(
    service: string,
    key: string,
    options: { brand?: string; tenantId?: string; shardKey?: string | number } = {}
  ): Promise<void> {
    const { brand, tenantId, shardKey } = options;
    const query = this.buildQuery(service, key, brand, tenantId);
    const cacheKey = this.buildCacheKey(service, key, brand, tenantId);

    const context: DatabaseContext = { service, brand, tenantId, shardKey: options.shardKey };
    const collection = await this.getCollection(context);
    
    // If database not connected, skip delete
    if (!collection) {
      logger.debug('Database not connected, skipping config delete', { service, key });
      return;
    }
    
    await collection.deleteOne(query);

    // Invalidate cache
    if (this.cacheEnabled) {
      await deleteCache(cacheKey);
      await deleteCachePattern(`config:${service}:*`);
    }
  }

  /**
   * Reload configuration for a service (clears cache)
   */
  async reload(service: string, brand?: string, tenantId?: string): Promise<void> {
    if (this.cacheEnabled) {
      const pattern = brand || tenantId
        ? `config:${service}:*:brand:${brand || '*'}:tenant:${tenantId || '*'}`
        : `config:${service}:*`;
      await deleteCachePattern(pattern);
    }
  }

  /**
   * Normalize MongoDB document to ConfigEntry
   */
  private normalizeDocument(doc: Document): ConfigEntry {
    return {
      id: doc.id || doc._id?.toString() || '',
      service: doc.service,
      brand: doc.brand,
      tenantId: doc.tenantId,
      key: doc.key,
      value: doc.value,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      __v: doc.__v,
    };
  }

  /**
   * Get from cache (with permission filtering)
   */
  private async getFromCache<T>(cacheKey: string, user: UserContext | null): Promise<T | null> {
    if (!this.cacheEnabled) return null;
    
    try {
      const cached = await getCache<T>(cacheKey);
      if (cached !== null) {
        // Note: Cache stores filtered values, so no need to filter again
        return cached;
      }
    } catch {
      // Cache error - ignore and fetch from DB
    }
    
    return null;
  }

  /**
   * Set cache (with permission filtering)
   */
  private async setCacheValue(cacheKey: string, value: unknown, user: UserContext | null): Promise<void> {
    if (!this.cacheEnabled) return;
    
    try {
      // Cache stores filtered value (already filtered by get method)
      await setCache(cacheKey, value, this.cacheTtl);
    } catch {
      // Cache error - ignore
    }
  }
}

/**
 * Create a config store instance
 */
export function createConfigStore(options?: ConfigStoreOptions): ConfigStore {
  return new ConfigStore(options);
}

/**
 * Create a config store for a specific service with database strategy.
 * 
 * Config Storage Strategy:
 * - 'shared': Returns central config store (core_service.service_configs)
 * - 'per-service': Returns config store for service's own database
 * - 'per-brand': Returns config store for brand database
 * 
 * @example
 * const configStore = await createServiceConfigStore('bonus-service', { brand, tenantId });
 * const jwtConfig = await configStore.get('bonus-service', 'jwt');
 */
export async function createServiceConfigStore(
  serviceName: string,
  options?: {
    brand?: string;
    tenantId?: string;
    collectionName?: string;
    cacheEnabled?: boolean;
    cacheTtl?: number;
  }
): Promise<ConfigStore> {
  const { brand, tenantId, collectionName, cacheEnabled, cacheTtl } = options || {};
  
  // First, read database strategy from bootstrap config (core_service)
  const centralStore = getCentralConfigStore();
  const dbConfig = await centralStore.get<{ strategy?: string }>(
    serviceName, 
    'database', 
    { brand, tenantId }
  );
  
  // If no DB config exists, check registered defaults for strategy
  // This is important for services like auth-service that use 'shared' strategy
  let strategy = dbConfig?.strategy;
  if (!strategy) {
    const defaultConfig = getDefaultConfig(serviceName, 'database');
    if (defaultConfig?.value && typeof defaultConfig.value === 'object') {
      strategy = (defaultConfig.value as { strategy?: string }).strategy;
    }
  }
  strategy = strategy || 'per-service';
  
  // For 'shared' strategy, return central config store
  // auth-service uses 'shared' because it was merged into core_service
  if (strategy === 'shared') {
    return centralStore;
  }
  
  // For other strategies, resolve and create config store for service's database
  const databaseStrategy = await resolveDatabaseStrategyFromConfig(serviceName, { brand, tenantId });
  
  return createConfigStore({
    collectionName: collectionName || 'service_configs',
    cacheEnabled: cacheEnabled !== false,
    cacheTtl: cacheTtl || 300, // 5 minutes default
    databaseStrategy,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Central Config Store (Bootstrap)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the central config store (always uses core_service database).
 * This is for reading bootstrap config (database/strategy) during startup.
 * 
 * NOTE: Bootstrap config (database strategy) MUST be stored centrally because
 * you need to read the strategy before you can connect to the service database.
 * This solves the "chicken and egg" problem.
 * 
 * Service-specific configs follow the strategy:
 * - 'shared': All config in core_service
 * - 'per-service': Config in each service's own database
 * 
 * IMPORTANT: Uses useCoreDatabase: true to ALWAYS use core_service database
 * regardless of what database getDatabase() currently returns. This prevents
 * configs from being written to the wrong database when scripts/services
 * connect to different databases.
 * 
 * @example
 * // Read bootstrap config (always from core_service)
 * const configStore = getCentralConfigStore();
 * const dbConfig = await configStore.get('bonus-service', 'database');
 */
export function getCentralConfigStore(): ConfigStore {
  if (!bootstrapConfigStore) {
    bootstrapConfigStore = createConfigStore({
      collectionName: 'service_configs',
      cacheEnabled: true,
      cacheTtl: 300,
      useCoreDatabase: true, // ALWAYS use core_service database
    });
  }
  return bootstrapConfigStore;
}

/**
 * Clear all config store caches (useful for testing)
 */
export function clearCentralConfigStore(): void {
  bootstrapConfigStore = null;
  serviceConfigStores.clear();
}

/**
 * Get configuration with automatic default creation
 * If config doesn't exist and default is registered, creates it automatically
 * 
 * Config Storage Strategy:
 * - 'database' key (bootstrap config): ALWAYS in core_service.service_configs
 *   (required to solve the chicken-egg problem - need strategy before knowing which DB)
 * - Other keys (service-specific): Follow the database strategy
 *   - 'per-service': In service's own database (e.g., bonus_service.service_configs)
 *   - 'shared': In core_service.service_configs
 *   - 'per-brand': In brand database (e.g., brand_brand-a.service_configs)
 * 
 * @example
 * // Database config (always from core_service)
 * const dbConfig = await getConfigWithDefault<DatabaseConfig>('auth-service', 'database');
 * 
 * // Service-specific config (follows strategy)
 * const jwtConfig = await getConfigWithDefault<JwtConfig>('auth-service', 'jwt');
 */
export async function getConfigWithDefault<T = unknown>(
  service: string,
  key: string,
  options?: {
    brand?: string;
    tenantId?: string;
    user?: UserContext | null;
  }
): Promise<T | null> {
  const { brand, tenantId, user } = options || {};
  
  // Bootstrap config (database/strategy): ALWAYS from core_service
  // This breaks the circular dependency: need strategy to connect, need connection to read strategy
  if (key === 'database') {
    if (!bootstrapConfigStore) {
      bootstrapConfigStore = createConfigStore({
        collectionName: 'service_configs',
        cacheEnabled: true,
        cacheTtl: 300,
        useCoreDatabase: true, // ALWAYS use core_service database
      });
    }
    return bootstrapConfigStore.get<T>(service, key, { brand, tenantId, user });
  }
  
  // Service-specific config: Follow the database strategy
  // Create cache key for this service/brand/tenant combination
  const cacheKey = `${service}:${brand || ''}:${tenantId || ''}`;
  
  let configStore = serviceConfigStores.get(cacheKey);
  if (!configStore) {
    // First, read the database strategy from bootstrap config (core_service)
    if (!bootstrapConfigStore) {
      bootstrapConfigStore = createConfigStore({
        collectionName: 'service_configs',
        cacheEnabled: true,
        cacheTtl: 300,
        useCoreDatabase: true, // ALWAYS use core_service database
      });
    }
    
    // Get database config to determine strategy
    const dbConfig = await bootstrapConfigStore.get<{ strategy?: string }>(
      service, 
      'database', 
      { brand, tenantId }
    );
    
    // If no DB config exists, check registered defaults for strategy
    // This is important for services like auth-service that use 'shared' strategy
    let strategy = dbConfig?.strategy;
    if (!strategy) {
      const defaultConfig = getDefaultConfig(service, 'database');
      if (defaultConfig?.value && typeof defaultConfig.value === 'object') {
        strategy = (defaultConfig.value as { strategy?: string }).strategy;
      }
    }
    strategy = strategy || 'per-service';
    
    // For 'shared' strategy, use core_service (same as bootstrap)
    if (strategy === 'shared') {
      configStore = bootstrapConfigStore;
    } else {
      // For other strategies, create a config store with the resolved strategy
      // This will write/read from the service's own database
      try {
        const databaseStrategy = await resolveDatabaseStrategyFromConfig(service, { brand, tenantId });
        configStore = createConfigStore({
          collectionName: 'service_configs',
          cacheEnabled: true,
          cacheTtl: 300,
          databaseStrategy,
        });
      } catch {
        // If strategy resolution fails, fall back to bootstrap store
        configStore = bootstrapConfigStore;
      }
    }
    
    serviceConfigStores.set(cacheKey, configStore);
  }
  
  return configStore.get<T>(service, key, { brand, tenantId, user });
}

/**
 * Clear the service config store caches (useful for testing)
 */
export function clearServiceConfigStores(): void {
  bootstrapConfigStore = null;
  serviceConfigStores.clear();
}
