/**
 * Service Database Access Pattern
 * 
 * Provides a standardized way for microservices to access their database.
 * This is the RECOMMENDED pattern for all services.
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Single source of truth for database access pattern
 */

import type { Db, MongoClient } from 'mongodb';

import { logger } from '../../common/logger.js';
import { resolveContext } from '../../common/config/context.js';
import { 
  type DatabaseStrategyResolver, 
  type DatabaseContext,
  resolveDatabase,
  type DatabaseResolutionOptions,
} from './strategy.js';
import { initializeServiceDatabase } from './strategy-config.js';
import { getConnectionPoolStats } from './connection.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseIndexConfig {
  key: Record<string, 1 | -1>;
  unique?: boolean;
  sparse?: boolean;
  name?: string;
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

export interface ServiceDatabaseOptions {
  brand?: string;
  tenantId?: string;
}

export interface ServiceDatabaseAccessor {
  initialize(options?: ServiceDatabaseOptions): Promise<{
    database: Db;
    strategy: DatabaseStrategyResolver;
    context: DatabaseContext;
  }>;
  getDb(tenantId?: string): Promise<Db>;
  getClient(): MongoClient;
  getStrategy(): DatabaseStrategyResolver;
  getContext(): DatabaseContext;
  getResolutionOptions(): DatabaseResolutionOptions;
  isInitialized(): boolean;
  getServiceName(): string;
  checkHealth(): Promise<HealthCheckResult>;
  getStats(): Promise<DatabaseStats>;
  registerIndexes(collection: string, indexes: DatabaseIndexConfig[]): void;
  ensureIndexes(): Promise<void>;
  getRegisteredIndexes(): Map<string, DatabaseIndexConfig[]>;
}

// ═══════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════

export function createServiceDatabaseAccess(serviceName: string): ServiceDatabaseAccessor {
  let strategy: DatabaseStrategyResolver | undefined;
  let context: DatabaseContext | undefined;
  let client: MongoClient | undefined;
  let defaultDb: Db | undefined;
  let initialized = false;
  const indexRegistry = new Map<string, DatabaseIndexConfig[]>();
  
  const ensureInitialized = (method: string): void => {
    if (!initialized || !strategy || !context || !client || !defaultDb) {
      throw new Error(
        `Service database not initialized. Call ${serviceName}.db.initialize() before using ${method}().`
      );
    }
  };
  
  return {
    async initialize(options?: ServiceDatabaseOptions) {
      if (initialized) {
        logger.warn('Service database already initialized', { serviceName });
        return { database: defaultDb!, strategy: strategy!, context: context! };
      }
      
      const resolvedContext = await resolveContext();
      const brand = options?.brand ?? resolvedContext.brand;
      const tenantId = options?.tenantId ?? resolvedContext.tenantId;
      
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
      });
      
      return result;
    },
    
    async getDb(tenantId?: string): Promise<Db> {
      ensureInitialized('getDb');
      if (tenantId) {
        return resolveDatabase(
          { databaseStrategy: strategy, defaultContext: context },
          serviceName,
          tenantId
        );
      }
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
      return { databaseStrategy: strategy, defaultContext: context };
    },
    
    isInitialized(): boolean {
      return initialized;
    },
    
    getServiceName(): string {
      return serviceName;
    },
    
    async checkHealth(): Promise<HealthCheckResult> {
      if (!initialized || !defaultDb) {
        return {
          healthy: false, latencyMs: -1, connections: 0, checkedOut: 0,
          database: '', service: serviceName,
        };
      }
      
      const start = Date.now();
      try {
        await defaultDb.command({ ping: 1 });
        const poolStats = getConnectionPoolStats();
        return {
          healthy: true,
          latencyMs: Date.now() - start,
          connections: poolStats.totalConnections,
          checkedOut: poolStats.checkedOut,
          database: defaultDb.databaseName,
          service: serviceName,
        };
      } catch {
        return {
          healthy: false, latencyMs: -1, connections: 0, checkedOut: 0,
          database: defaultDb?.databaseName || '', service: serviceName,
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
      } catch {
        return { collections: 0, objects: 0, dataSize: 0, storageSize: 0, indexes: 0, indexSize: 0 };
      }
    },
    
    registerIndexes(collection: string, indexes: DatabaseIndexConfig[]): void {
      const existing = indexRegistry.get(collection) || [];
      indexRegistry.set(collection, [...existing, ...indexes]);
    },
    
    async ensureIndexes(): Promise<void> {
      ensureInitialized('ensureIndexes');
      if (indexRegistry.size === 0) return;
      
      const collections = await defaultDb!.listCollections().toArray();
      const existingCollections = new Set(collections.map(c => c.name));
      
      for (const [collName, indexes] of indexRegistry) {
        if (!existingCollections.has(collName)) {
          await defaultDb!.createCollection(collName);
        }
        const collection = defaultDb!.collection(collName);
        await collection.createIndexes(indexes.map(idx => ({
          key: idx.key, unique: idx.unique, sparse: idx.sparse, name: idx.name,
        })));
      }
      logger.info('All indexes ensured', { service: serviceName });
    },
    
    getRegisteredIndexes(): Map<string, DatabaseIndexConfig[]> {
      return new Map(indexRegistry);
    },
  };
}
