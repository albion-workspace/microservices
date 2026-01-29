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
 * ```
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Single source of truth for database access pattern
 * - No backward compatibility / legacy fallbacks
 */

import type { Db } from 'mongodb';

import { logger } from '../common/logger.js';
import { resolveContext } from '../common/context-resolver.js';
import { 
  type DatabaseStrategyResolver, 
  type DatabaseContext,
  resolveDatabase,
  type DatabaseResolutionOptions,
} from './strategy.js';
import { initializeServiceDatabase } from './strategy-config.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ServiceDatabaseAccessor {
  /**
   * Initialize the database connection for this service.
   * Must be called once at service startup before using getDb().
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
 * - Provides clean API for database access
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
 */
export function createServiceDatabaseAccess(serviceName: string): ServiceDatabaseAccessor {
  // Internal state
  let strategy: DatabaseStrategyResolver | undefined;
  let context: DatabaseContext | undefined;
  let initialized = false;
  
  // Helper to check initialization
  const ensureInitialized = (method: string): void => {
    if (!initialized || !strategy || !context) {
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
        return { database: await this.getDb(), strategy: strategy!, context: context! };
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
      
      // Use default context
      return resolveDatabase(
        { databaseStrategy: strategy, defaultContext: context },
        serviceName
      );
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
  };
}
