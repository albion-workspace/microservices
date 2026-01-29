/**
 * Service Database Access Pattern
 * 
 * Provides a standardized way for microservices to access their database.
 * This is the RECOMMENDED pattern for all services.
 * 
 * Benefits:
 * - Works with all database strategies (shared, per-service, per-tenant, etc.)
 * - Clear initialization and usage pattern
 * - Type-safe and explicit
 * - No global state leakage
 * - Complete API: database, client, health, stats, indexes
 * 
 * Usage in a microservice:
 * ```typescript
 * // 1. Create the accessor (typically in a dedicated file)
 * import { createServiceDatabaseAccess } from 'core-service';
 * export const db = createServiceDatabaseAccess('payment-service');
 * 
 * // 2. Initialize at startup (in index.ts)
 * await db.initialize({ brand: process.env.BRAND, tenantId: process.env.TENANT_ID });
 * 
 * // 3. Use anywhere in the service
 * const database = await db.getDb();
 * const collection = database.collection('wallets');
 * 
 * // 4. For multi-tenant, pass tenantId
 * const database = await db.getDb(tenantId);
 * 
 * // 5. Health checks and monitoring
 * const health = await db.checkHealth();
 * const stats = await db.getStats();
 * 
 * // 6. Register indexes at startup
 * db.registerIndexes('wallets', [
 *   { key: { userId: 1 }, unique: false },
 *   { key: { id: 1 }, unique: true },
 * ]);
 * await db.ensureIndexes();
 * ```
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Single source of truth for database access pattern
 * - No backward compatibility / legacy fallbacks
 */

import type { Db, MongoClient } from 'mongodb';

import { logger } from '../common/logger.js';
import { resolveContext } from '../common/config/context.js';
import { 
  type DatabaseStrategyResolver, 
  type DatabaseContext,
  resolveDatabase,
  type DatabaseResolutionOptions,
} from './strategy.js';
import { initializeServiceDatabase } from './strategy-config.js';
import { getConnectionPoolStats } from './mongodb.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseIndexConfig {
  key: Record<string, 1 | -1>;
  unique?: boolean;
  sparse?: boolean;
  name?: string;
  // Note: 'background' option is deprecated in MongoDB 4.2+
  // Indexes now use an optimized build process by default
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  connections: number;
  checkedOut: number;
  database: string;
  service: string;
}

export interface DatabaseStats {
  collections: number;
  objects: number;
  dataSize: number;
  storageSize: number;
  indexes: number;
  indexSize: number;
}

export interface ServiceDatabaseAccessor {
  /**
   * Initialize the database connection for this service.
   * Must be called once at service startup before using other methods.
   */
  initialize(options?: { brand?: string; tenantId?: string }): Promise<{
    database: Db;
    strategy: DatabaseStrategyResolver;
    context: DatabaseContext;
  }>;
  
  /**
   * Get the database for this service.
   * @param tenantId - Optional tenant ID for multi-tenant strategies
   * @returns Database instance
   * @throws Error if not initialized
   */
  getDb(tenantId?: string): Promise<Db>;
  
  /**
   * Get the MongoDB client.
   * Useful for creating sessions, transactions, or accessing other databases.
   * @throws Error if not initialized
   */
  getClient(): MongoClient;
  
  /**
   * Get the database strategy (for passing to components that need it).
   * @throws Error if not initialized
   */
  getStrategy(): DatabaseStrategyResolver;
  
  /**
   * Get the default context (for passing to components that need it).
   * @throws Error if not initialized
   */
  getContext(): DatabaseContext;
  
  /**
   * Get database resolution options (for passing to resolveDatabase).
   * This is useful for components that need to resolve databases themselves.
   * @throws Error if not initialized
   */
  getResolutionOptions(): DatabaseResolutionOptions;
  
  /**
   * Check if the database accessor has been initialized.
   */
  isInitialized(): boolean;
  
  /**
   * Get the service name this accessor is for.
   */
  getServiceName(): string;
  
  // ═══════════════════════════════════════════════════════════════════
  // Health & Monitoring
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Check database health.
   * Performs a ping and returns latency and connection info.
   */
  checkHealth(): Promise<HealthCheckResult>;
  
  /**
   * Get database statistics for monitoring.
   * Returns collection count, data size, index info, etc.
   */
  getStats(): Promise<DatabaseStats>;
  
  // ═══════════════════════════════════════════════════════════════════
  // Index Management
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Register indexes for a collection.
   * Call this before ensureIndexes() to define which indexes should be created.
   * 
   * @param collection - Collection name
   * @param indexes - Array of index configurations
   * 
   * @example
   * db.registerIndexes('wallets', [
   *   { key: { userId: 1 }, unique: false },
   *   { key: { id: 1 }, unique: true },
   *   { key: { tenantId: 1, currency: 1 } },
   * ]);
   */
  registerIndexes(collection: string, indexes: DatabaseIndexConfig[]): void;
  
  /**
   * Ensure all registered indexes are created.
   * Call this once at service startup after registering indexes.
   */
  ensureIndexes(): Promise<void>;
  
  /**
   * Get all registered indexes (for debugging/inspection).
   */
  getRegisteredIndexes(): Map<string, DatabaseIndexConfig[]>;
}

// ═══════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a database accessor for a service.
 * 
 * This is the RECOMMENDED way for services to manage database access.
 * Creates a self-contained accessor that:
 * - Enforces initialization before use
 * - Works with all database strategies
 * - Provides complete API (database, client, health, stats, indexes)
 * 
 * @param serviceName - The name of the service (e.g., 'payment-service')
 * @returns ServiceDatabaseAccessor instance
 * 
 * @example
 * // Create accessor
 * export const db = createServiceDatabaseAccess('payment-service');
 * 
 * // Initialize at startup
 * await db.initialize();
 * 
 * // Use in resolvers/services
 * const database = await db.getDb();
 * const wallets = database.collection('wallets');
 * 
 * // Health check
 * const health = await db.checkHealth();
 * if (!health.healthy) logger.error('Database unhealthy!');
 */
export function createServiceDatabaseAccess(serviceName: string): ServiceDatabaseAccessor {
  // Internal state
  let strategy: DatabaseStrategyResolver | undefined;
  let context: DatabaseContext | undefined;
  let client: MongoClient | undefined;
  let defaultDb: Db | undefined;
  let initialized = false;
  
  // Index registry for this service
  const indexRegistry = new Map<string, DatabaseIndexConfig[]>();
  
  // Helper to check initialization
  const ensureInitialized = (method: string): void => {
    if (!initialized || !strategy || !context || !client || !defaultDb) {
      throw new Error(
        `Service database not initialized. Call ${serviceName}.db.initialize() before using ${method}(). ` +
        `This should be done once at service startup.`
      );
    }
  };
  
  return {
    async initialize(options?: { brand?: string; tenantId?: string }) {
      if (initialized) {
        logger.warn('Service database already initialized, returning cached result', { serviceName });
        return { database: defaultDb!, strategy: strategy!, context: context! };
      }
      
      // Resolve context from environment if not provided
      const resolvedContext = await resolveContext();
      const brand = options?.brand ?? resolvedContext.brand;
      const tenantId = options?.tenantId ?? resolvedContext.tenantId;
      
      // Use centralized initialization
      const result = await initializeServiceDatabase({
        serviceName,
        brand,
        tenantId,
      });
      
      strategy = result.strategy;
      context = result.context;
      defaultDb = result.database;
      client = result.database.client;
      initialized = true;
      
      logger.info('Service database initialized', {
        service: serviceName,
        database: result.database.databaseName,
        context: result.context,
      });
      
      return result;
    },
    
    async getDb(tenantId?: string): Promise<Db> {
      ensureInitialized('getDb');
      
      // If tenantId provided, resolve with tenant context
      if (tenantId) {
        return resolveDatabase(
          { databaseStrategy: strategy, defaultContext: context },
          serviceName,
          tenantId
        );
      }
      
      // Use default database
      return defaultDb!;
    },
    
    getClient(): MongoClient {
      ensureInitialized('getClient');
      return client!;
    },
    
    getStrategy(): DatabaseStrategyResolver {
      ensureInitialized('getStrategy');
      return strategy!;
    },
    
    getContext(): DatabaseContext {
      ensureInitialized('getContext');
      return context!;
    },
    
    getResolutionOptions(): DatabaseResolutionOptions {
      ensureInitialized('getResolutionOptions');
      return {
        databaseStrategy: strategy,
        defaultContext: context,
      };
    },
    
    isInitialized(): boolean {
      return initialized;
    },
    
    getServiceName(): string {
      return serviceName;
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // Health & Monitoring
    // ═══════════════════════════════════════════════════════════════════
    
    async checkHealth(): Promise<HealthCheckResult> {
      if (!initialized || !defaultDb || !client) {
        return {
          healthy: false,
          latencyMs: -1,
          connections: 0,
          checkedOut: 0,
          database: '',
          service: serviceName,
        };
      }
      
      const start = Date.now();
      try {
        await defaultDb.command({ ping: 1 });
        const latencyMs = Date.now() - start;
        
        // Use event-based connection pool stats (MongoDB 7.x best practice)
        const poolStats = getConnectionPoolStats();
        
        return {
          healthy: true,
          latencyMs,
          connections: poolStats.totalConnections,
          checkedOut: poolStats.checkedOut,
          database: defaultDb.databaseName,
          service: serviceName,
        };
      } catch (error) {
        logger.error('Database health check failed', { service: serviceName, error });
        return {
          healthy: false,
          latencyMs: -1,
          connections: 0,
          checkedOut: 0,
          database: defaultDb?.databaseName || '',
          service: serviceName,
        };
      }
    },
    
    async getStats(): Promise<DatabaseStats> {
      ensureInitialized('getStats');
      
      try {
        const stats = await defaultDb!.stats();
        return {
          collections: stats.collections,
          objects: stats.objects,
          dataSize: stats.dataSize,
          storageSize: stats.storageSize,
          indexes: stats.indexes,
          indexSize: stats.indexSize,
        };
      } catch (error) {
        logger.error('Failed to get database stats', { service: serviceName, error });
        return {
          collections: 0,
          objects: 0,
          dataSize: 0,
          storageSize: 0,
          indexes: 0,
          indexSize: 0,
        };
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // Index Management
    // ═══════════════════════════════════════════════════════════════════
    
    registerIndexes(collection: string, indexes: DatabaseIndexConfig[]): void {
      // Merge with existing indexes for this collection
      const existing = indexRegistry.get(collection) || [];
      indexRegistry.set(collection, [...existing, ...indexes]);
      logger.debug('Indexes registered', { service: serviceName, collection, count: indexes.length });
    },
    
    async ensureIndexes(): Promise<void> {
      ensureInitialized('ensureIndexes');
      
      if (indexRegistry.size === 0) {
        logger.debug('No indexes registered for service', { service: serviceName });
        return;
      }
      
      try {
        const collections = await defaultDb!.listCollections().toArray();
        const existingCollections = new Set(collections.map(c => c.name));
        
        for (const [collName, indexes] of indexRegistry) {
          // Create collection if it doesn't exist (indexes need the collection)
          if (!existingCollections.has(collName)) {
            await defaultDb!.createCollection(collName);
            logger.debug('Created collection for indexes', { service: serviceName, collection: collName });
          }
          
          // Create indexes (MongoDB 4.2+ uses optimized build process by default)
          const collection = defaultDb!.collection(collName);
          await collection.createIndexes(indexes.map(idx => ({
            key: idx.key,
            unique: idx.unique,
            sparse: idx.sparse,
            name: idx.name,
          })));
          
          logger.debug('Indexes created', { service: serviceName, collection: collName, count: indexes.length });
        }
        
        logger.info('All indexes ensured', { service: serviceName, collections: indexRegistry.size });
      } catch (error) {
        logger.error('Failed to ensure indexes', { service: serviceName, error });
        throw error;
      }
    },
    
    getRegisteredIndexes(): Map<string, DatabaseIndexConfig[]> {
      return new Map(indexRegistry);
    },
  };
}
