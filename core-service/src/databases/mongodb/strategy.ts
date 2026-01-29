/**
 * Database Strategy Pattern - Flexible Database Architecture
 * 
 * Supports multiple database strategies:
 * - Single shared database (all services)
 * - Split per service (each service has own database)
 * - Split per brand (each brand has own database)
 * - Hybrid (combination of strategies)
 * 
 * This pattern allows services to decide database placement dynamically
 * without hardcoding database connections.
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses abstractions (getDatabase)
 * - Static imports
 */

import { getDatabase, getClient } from './connection.js';
import { logger } from '../../common/logger.js';
import { createHash } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import type { MongoConfig } from './connection.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Database strategy type
 */
export type DatabaseStrategy = 
  | 'shared'           // Single database for all services
  | 'per-service'     // Each service has own database (no brand/tenant separation)
  | 'per-brand'        // Each brand has own database (all services share within brand)
  | 'per-brand-service' // Each brand+service combination has own database (max isolation)
  | 'per-tenant'       // Each tenant has own database (all services share within tenant) - same pattern as per-brand
  | 'per-tenant-service' // Each tenant+service combination has own database (max isolation) - same pattern as per-brand-service
  | 'per-shard'        // Horizontal partitioning/sharding (by hash, range, or key)
  | 'hybrid';          // Custom strategy (uses resolver function)

/**
 * Database resolver function
 * Returns database instance based on context
 */
export type DatabaseResolver = (context: DatabaseContext) => Db | Promise<Db>;

/**
 * Context for database resolution
 */
export interface DatabaseContext {
  /** Service name (e.g., 'auth-service', 'payment-service') */
  service: string;
  /** Brand identifier (optional) */
  brand?: string;
  /** Tenant ID (optional) */
  tenantId?: string;
  /** Shard key for horizontal partitioning (optional, for per-shard strategy) */
  shardKey?: string | number;
  /** Additional context (for custom strategies) */
  [key: string]: unknown;
}

/**
 * Database strategy configuration
 */
export interface DatabaseStrategyConfig {
  /** Strategy type */
  strategy: DatabaseStrategy;
  /** Custom resolver (required for 'hybrid' strategy) */
  resolver?: DatabaseResolver;
  /** Database name template (for per-service/per-brand strategies) */
  dbNameTemplate?: string;
  /** MongoDB URI template (for per-service/per-brand strategies) */
  uriTemplate?: string;
  /** Default database (fallback) */
  defaultDatabase?: Db;
  /** Number of shards (for per-shard strategy, default: 4) */
  numShards?: number;
  /** Shard function (for per-shard strategy, default: hash-based) */
  shardFunction?: (shardKey: string | number, numShards: number) => number;
}

/**
 * Database connection cache
 * Stores connections per strategy key
 */
interface DatabaseConnection {
  db: Db;
  client: MongoClient;
  key: string;
}

// ═══════════════════════════════════════════════════════════════════
// Database Connection Cache
// ═══════════════════════════════════════════════════════════════════

const connectionCache = new Map<string, DatabaseConnection>();

/**
 * Generate cache key for database connection
 */
function generateCacheKey(strategy: DatabaseStrategy, context: DatabaseContext): string {
  switch (strategy) {
    case 'shared':
      return 'shared:default';
    case 'per-service':
      return `service:${context.service}`;
    case 'per-brand':
      return `brand:${context.brand || 'default'}`;
    case 'per-tenant':
      return `tenant:${context.tenantId || 'default'}`;
    case 'hybrid':
      // Use resolver to generate key (if it's a function that can generate keys)
      return `hybrid:${context.service}:${context.brand || ''}:${context.tenantId || ''}`;
    default:
      return 'default';
  }
}

// ═══════════════════════════════════════════════════════════════════
// Database Strategy Resolver
// ═══════════════════════════════════════════════════════════════════

/**
 * Database Strategy Resolver
 * Resolves database instance based on strategy and context
 */
export class DatabaseStrategyResolver {
  private config: DatabaseStrategyConfig;
  private defaultDb: Db | null = null;
  private numShards: number;
  private shardFunction: (shardKey: string | number, numShards: number) => number;

  constructor(config: DatabaseStrategyConfig) {
    this.config = config;
    
    // Initialize default database if provided
    if (config.defaultDatabase) {
      this.defaultDb = config.defaultDatabase;
    }
    
    // Initialize sharding config (if per-shard strategy)
    this.numShards = config.numShards || 4;
    this.shardFunction = config.shardFunction || this.defaultShardFunction.bind(this);
  }

  /**
   * Resolve database instance based on strategy and context
   */
  async resolve(context: DatabaseContext): Promise<Db> {
    const { strategy, resolver } = this.config;

    switch (strategy) {
      case 'shared':
        return this.resolveShared();
      
      case 'per-service':
        return this.resolvePerService(context);
      
      case 'per-brand':
        return this.resolvePerBrand(context);
      
      case 'per-brand-service':
        return this.resolvePerBrandService(context);
      
      case 'per-tenant':
        return this.resolvePerTenant(context);
      
      case 'per-tenant-service':
        return this.resolvePerTenantService(context);
      
      case 'per-shard':
        return this.resolvePerShard(context);
      
      case 'hybrid':
        if (!resolver) {
          throw new Error('Hybrid strategy requires a resolver function');
        }
        return Promise.resolve(resolver(context));
      
      default:
        return this.getDefaultDatabase();
    }
  }

  /**
   * Shared database strategy (single database for all)
   */
  private resolveShared(): Db {
    const cacheKey = 'shared:default';
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Use default database
    const db = this.getDefaultDatabase();
    
    // Cache connection
    connectionCache.set(cacheKey, {
      db,
      client: getClient(),
      key: cacheKey,
    });

    return db;
  }

  /**
   * Per-service database strategy
   * Each service has its own database
   * Supports combined per-brand-per-service: use template like "brand_{brand}_{service}"
   */
  private async resolvePerService(context: DatabaseContext): Promise<Db> {
    const cacheKey = `service:${context.service}:${context.brand || ''}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name from template with support for {service} and {brand}
    let dbName = this.config.dbNameTemplate || '{service}';
    
    // Replace ALL occurrences of {service} placeholder (not just first)
    dbName = dbName.replace(/{service}/g, context.service.replace(/-/g, '_'));
    if (context.brand) {
      dbName = dbName.replace(/{brand}/g, context.brand.replace(/-/g, '_'));
    }
    
    // If template doesn't contain {service} and no brand, use service name directly
    if (!dbName.includes('{service}') && !context.brand && dbName === '{service}') {
      dbName = context.service.replace(/-/g, '_');
    }
    
    // Debug logging for troubleshooting
    if (dbName === 'core_service' && context.service !== 'core-service') {
      logger.warn('Per-service strategy resolved to core_service for non-core service', {
        service: context.service,
        template: this.config.dbNameTemplate,
        resolvedDbName: dbName
      });
    }

    // Build URI from template with support for {service} and {brand}
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri.replace('{service}', context.service.replace(/-/g, '_'));
    if (context.brand) {
      uri = uri.replace('{brand}', context.brand.replace(/-/g, '_'));
    }

    // Connect to service-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Per-brand database strategy
   * Each brand has its own database (all services share within brand)
   */
  private async resolvePerBrand(context: DatabaseContext): Promise<Db> {
    if (!context.brand) {
      logger.warn('Per-brand strategy requires brand context, falling back to default');
      return this.getDefaultDatabase();
    }

    const cacheKey = `brand:${context.brand}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name: brand_{brand} (all services share)
    const dbName = this.config.dbNameTemplate
      ? this.config.dbNameTemplate.replace('{brand}', context.brand.replace(/-/g, '_'))
      : `brand_${context.brand.replace(/-/g, '_')}`;

    // Build URI
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri.replace('{brand}', context.brand.replace(/-/g, '_'));

    // Connect to brand-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Per-brand-service database strategy
   * Each brand+service combination has its own database (max isolation)
   * Example: brand_brand-a_auth_service, brand_brand-a_payment_service
   */
  private async resolvePerBrandService(context: DatabaseContext): Promise<Db> {
    if (!context.brand) {
      logger.warn('Per-brand-service strategy requires brand context, falling back to default');
      return this.getDefaultDatabase();
    }

    if (!context.service) {
      logger.warn('Per-brand-service strategy requires service context, falling back to default');
      return this.getDefaultDatabase();
    }

    const cacheKey = `brand:${context.brand}:service:${context.service}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name: brand_{brand}_{service} (each service isolated)
    const dbName = this.config.dbNameTemplate
      ? this.config.dbNameTemplate
          .replace('{brand}', context.brand.replace(/-/g, '_'))
          .replace('{service}', context.service.replace(/-/g, '_'))
      : `brand_${context.brand.replace(/-/g, '_')}_${context.service.replace(/-/g, '_')}`;

    // Build URI
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri
      .replace('{brand}', context.brand.replace(/-/g, '_'))
      .replace('{service}', context.service.replace(/-/g, '_'));

    // Connect to brand+service-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Per-tenant database strategy
   * Each tenant has its own database (all services share within tenant)
   * Same pattern as per-brand - tenants are like brands for isolation
   */
  private async resolvePerTenant(context: DatabaseContext): Promise<Db> {
    if (!context.tenantId) {
      logger.warn('Per-tenant strategy requires tenantId context, falling back to default');
      return this.getDefaultDatabase();
    }

    const cacheKey = `tenant:${context.tenantId}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name: tenant_{tenantId} (all services share)
    const dbName = this.config.dbNameTemplate
      ? this.config.dbNameTemplate.replace('{tenantId}', context.tenantId.replace(/-/g, '_'))
      : `tenant_${context.tenantId.replace(/-/g, '_')}`;

    // Build URI
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri.replace('{tenantId}', context.tenantId.replace(/-/g, '_'));

    // Connect to tenant-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Per-tenant-service database strategy
   * Each tenant+service combination has its own database (max isolation)
   * Same pattern as per-brand-service - tenants are like brands
   */
  private async resolvePerTenantService(context: DatabaseContext): Promise<Db> {
    if (!context.tenantId) {
      logger.warn('Per-tenant-service strategy requires tenantId context, falling back to default');
      return this.getDefaultDatabase();
    }

    if (!context.service) {
      logger.warn('Per-tenant-service strategy requires service context, falling back to default');
      return this.getDefaultDatabase();
    }

    const cacheKey = `tenant:${context.tenantId}:service:${context.service}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name: tenant_{tenantId}_{service} (each service isolated)
    const dbName = this.config.dbNameTemplate
      ? this.config.dbNameTemplate
          .replace('{tenantId}', context.tenantId.replace(/-/g, '_'))
          .replace('{service}', context.service.replace(/-/g, '_'))
      : `tenant_${context.tenantId.replace(/-/g, '_')}_${context.service.replace(/-/g, '_')}`;

    // Build URI
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri
      .replace('{tenantId}', context.tenantId.replace(/-/g, '_'))
      .replace('{service}', context.service.replace(/-/g, '_'));

    // Connect to tenant+service-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Per-shard database strategy
   * Horizontal partitioning/sharding by hash, range, or key
   * 
   * Supports:
   * - Hash-based sharding (default): hash(shardKey) % numShards
   * - Range-based sharding: shardKey % numShards
   * - Custom shard function
   */
  private async resolvePerShard(context: DatabaseContext): Promise<Db> {
    if (!context.shardKey) {
      logger.warn('Per-shard strategy requires shardKey context, falling back to default');
      return this.getDefaultDatabase();
    }
    
    // Calculate shard number using configured shard function
    const shardNumber = this.shardFunction(context.shardKey, this.numShards);
    const cacheKey = `shard:${shardNumber}:${context.service || ''}`;
    
    // Check cache
    const cached = connectionCache.get(cacheKey);
    if (cached) {
      return cached.db;
    }

    // Build database name: shard_{shardNumber} or shard_{shardNumber}_{service}
    let dbName = this.config.dbNameTemplate || 'shard_{shard}';
    dbName = dbName.replace('{shard}', String(shardNumber));
    if (context.service) {
      dbName = dbName.replace('{service}', context.service.replace(/-/g, '_'));
    }
    // If no template, default to shard number
    if (!this.config.dbNameTemplate) {
      dbName = context.service
        ? `shard_${shardNumber}_${context.service.replace(/-/g, '_')}`
        : `shard_${shardNumber}`;
    }

    // Build URI
    let uri = this.config.uriTemplate || process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
    uri = uri.replace('{shard}', String(shardNumber));
    if (context.service) {
      uri = uri.replace('{service}', context.service.replace(/-/g, '_'));
    }

    // Connect to shard-specific database
    const db = await this.connectToDatabase(uri, dbName, cacheKey, context);
    
    return db;
  }

  /**
   * Default shard function: hash-based sharding
   * Uses MD5 hash of shardKey, then modulo numShards
   */
  private defaultShardFunction(shardKey: string | number, numShards: number): number {
    const keyString = String(shardKey);
    const hash = createHash('md5').update(keyString).digest('hex');
    // Convert first 8 hex chars to number, then modulo
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return hashNum % numShards;
  }

  /**
   * Connect to a specific database
   * 
   * NOTE: Database config (URI, dbName) is already resolved from service_configs
   * via resolveDatabaseStrategyFromConfig(). No need to re-read from database_configs.
   */
  private async connectToDatabase(uri: string, dbName: string, cacheKey: string, context?: DatabaseContext): Promise<Db> {
    // Import dynamically to avoid circular dependency
    const { connectDatabase, getClient } = await import('./connection.js');
    
    // For per-service strategy (and other multi-database strategies), we need to:
    // 1. Connect the client once (if not already connected) - this establishes the connection pool
    // 2. Use client.db(dbName) to get different database instances from the same client
    // This allows multiple databases on the same MongoDB server
    
    // Extract base URI (without database name) for client connection
    // MongoDB client can connect to server without specifying database
    const uriObj = new URL(uri);
    const baseUri = `${uriObj.protocol}//${uriObj.host}${uriObj.search || ''}`;
    
    // Connect client (this is cached globally, so multiple calls are safe)
    // Use base URI to connect to MongoDB server (not specific database)
    await connectDatabase(baseUri);
    const client = getClient();
    
    // Get specific database instance using dbName
    // This allows multiple databases from the same client connection
    const db = client.db(dbName);
    
    // Cache connection
    connectionCache.set(cacheKey, {
      db,
      client,
      key: cacheKey,
    });

    logger.debug('Connected to database via strategy', { 
      strategy: this.config.strategy,
      dbName,
      cacheKey,
    });

    return db;
  }

  /**
   * Get default database (fallback)
   */
  private getDefaultDatabase(): Db {
    if (this.defaultDb) {
      return this.defaultDb;
    }
    return getDatabase();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a database strategy resolver
 */
export function createDatabaseStrategy(config: DatabaseStrategyConfig): DatabaseStrategyResolver {
  return new DatabaseStrategyResolver(config);
}

/**
 * Get database using strategy resolver
 * Convenience function for common use cases
 */
export async function getDatabaseByStrategy(
  strategy: DatabaseStrategy,
  context: DatabaseContext,
  config?: Partial<DatabaseStrategyConfig>
): Promise<Db> {
  const resolver = createDatabaseStrategy({
    strategy,
    ...config,
  });
  
  return resolver.resolve(context);
}

/**
 * Database resolution options
 * Used by services to resolve database instances
 */
export interface DatabaseResolutionOptions {
  /** Direct database instance (if provided, uses this directly) */
  database?: Db;
  /** Database strategy resolver */
  databaseStrategy?: DatabaseStrategyResolver;
  /** Default context for strategy resolution */
  defaultContext?: DatabaseContext;
}

/**
 * Resolve database instance from options
 */
export async function resolveDatabase(
  options: DatabaseResolutionOptions,
  serviceName: string,
  tenantId?: string
): Promise<Db> {
  const { database, databaseStrategy, defaultContext } = options;
  
  // If direct database provided, use it
  if (database) {
    return database;
  }
  
  // If strategy provided, resolve using context
  if (databaseStrategy) {
    const context: DatabaseContext = {
      service: serviceName,
      ...(tenantId && { tenantId }),
      ...defaultContext,
    };
    return await databaseStrategy.resolve(context);
  }
  
  // Neither provided - throw error (no backward compatibility per CODING_STANDARDS.md)
  throw new Error(
    `Database resolution requires either database or databaseStrategy with defaultContext. ` +
    `Service: ${serviceName}, tenantId: ${tenantId || 'none'}`
  );
}

// ═══════════════════════════════════════════════════════════════════
// Pre-configured Strategies
// ═══════════════════════════════════════════════════════════════════

export function createSharedDatabaseStrategy(defaultDatabase?: Db): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'shared',
    defaultDatabase,
  });
}

export function createPerServiceDatabaseStrategy(
  dbNameTemplate?: string,
  uriTemplate?: string
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-service',
    dbNameTemplate: dbNameTemplate || '{service}',
    uriTemplate,
  });
}

export function createPerBrandDatabaseStrategy(
  dbNameTemplate?: string,
  uriTemplate?: string
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-brand',
    dbNameTemplate: dbNameTemplate || 'brand_{brand}',
    uriTemplate,
  });
}

export function createPerBrandServiceDatabaseStrategy(
  dbNameTemplate?: string,
  uriTemplate?: string
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-brand-service',
    dbNameTemplate: dbNameTemplate || 'brand_{brand}_{service}',
    uriTemplate,
  });
}

export function createPerTenantDatabaseStrategy(
  dbNameTemplate?: string,
  uriTemplate?: string
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-tenant',
    dbNameTemplate: dbNameTemplate || 'tenant_{tenantId}',
    uriTemplate,
  });
}

export function createPerTenantServiceDatabaseStrategy(
  dbNameTemplate?: string,
  uriTemplate?: string
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-tenant-service',
    dbNameTemplate: dbNameTemplate || 'tenant_{tenantId}_{service}',
    uriTemplate,
  });
}

export function createPerShardDatabaseStrategy(
  options?: {
    numShards?: number;
    shardFunction?: (shardKey: string | number, numShards: number) => number;
    dbNameTemplate?: string;
    uriTemplate?: string;
  }
): DatabaseStrategyResolver {
  return createDatabaseStrategy({
    strategy: 'per-shard',
    numShards: options?.numShards || 4,
    shardFunction: options?.shardFunction,
    dbNameTemplate: options?.dbNameTemplate || 'shard_{shard}',
    uriTemplate: options?.uriTemplate,
  });
}
