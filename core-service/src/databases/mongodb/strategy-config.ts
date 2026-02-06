/**
 * Database Strategy Configuration Resolver
 * 
 * Resolves database strategy from MongoDB config store.
 * Makes database strategies fully configurable without code changes.
 * 
 * Provides two levels of database access:
 * 1. getCentralDatabase() - Bootstrap layer (always core_service)
 * 2. getServiceDatabase() - Business layer (strategy-based)
 */

import type { Db } from 'mongodb';

import { getConfigWithDefault } from '../../common/config/store.js';
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
import { connectDatabase, getDatabase, getClient } from './connection.js';
import { CORE_DATABASE_NAME } from './constants.js';
import { logger } from '../../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseConfig {
  strategy: DatabaseStrategy;
  mongoUri?: string;
  dbNameTemplate?: string;
  redisUrl?: string;
  numShards?: number;
}

export interface ServiceDatabaseOptions {
  serviceName: string;
  brand?: string;
  tenantId?: string;
  database?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
}

// ═══════════════════════════════════════════════════════════════════
// Strategy Resolver from Config
// ═══════════════════════════════════════════════════════════════════

export async function resolveDatabaseStrategyFromConfig(
  service: string,
  options?: { brand?: string; tenantId?: string }
): Promise<DatabaseStrategyResolver> {
  const { brand, tenantId } = options || {};
  
  // IMPORTANT: Environment variables take highest priority (Docker/K8s override)
  // This ensures containers use the correct hosts even if old config exists in MongoDB
  const envMongoUri = process.env.MONGO_URI;
  const envRedisUrl = process.env.REDIS_URL;
  
  // Extract base host from environment if available
  const baseMongoHost = envMongoUri 
    ? envMongoUri.replace(/\/[^\/]+(\?.*)?$/, '') // Extract host part (mongodb://host:port)
    : null;
  
  // Load strategy from config store (only strategy matters, not the URIs)
  const dbConfig = await getConfigWithDefault<DatabaseConfig>(service, 'database', { brand, tenantId });
  const strategy = dbConfig?.strategy || (
    (service === 'core-service' || service === 'auth-service') ? 'shared' : 'per-service'
  );
  const dbNameTemplate = dbConfig?.dbNameTemplate || (
    (service === 'core-service' || service === 'auth-service') ? CORE_DATABASE_NAME : '{service}'
  );
  
  // Build MongoDB URI: env > stored config > local dev default (single place)
  let mongoUri: string;
  if (envMongoUri) {
    // Use environment variable - this is the Docker/K8s case
    if (strategy === 'per-service') {
      mongoUri = envMongoUri.replace(/\/[^\/\?]+(\?|$)/, `/{service}$1`);
    } else {
      mongoUri = envMongoUri;
    }
  } else if (dbConfig?.mongoUri) {
    // Use stored config (local development case)
    mongoUri = dbConfig.mongoUri;
  } else {
    // Local dev: no env, no config – build default URI from service
    const dbName = strategy === 'shared' ? CORE_DATABASE_NAME : service.replace(/-/g, '_');
    mongoUri = `mongodb://localhost:27017/${dbName}`;
  }
  
  // Build Redis URL: environment takes priority
  const redisUrl = envRedisUrl || dbConfig?.redisUrl;
  
  let uriTemplate = mongoUri;
  let resolvedDbNameTemplate = dbNameTemplate;
  
  if (strategy !== 'per-service') {
    uriTemplate = resolveUriTemplate(uriTemplate, { service, brand, tenantId });
    resolvedDbNameTemplate = resolveDbNameTemplate(resolvedDbNameTemplate, { service, brand, tenantId });
  }
  
  switch (strategy) {
    case 'shared':
      return createSharedDatabaseStrategy();
    case 'per-service':
      if (!resolvedDbNameTemplate.includes('{service}')) resolvedDbNameTemplate = '{service}';
      if (!uriTemplate.includes('{service}')) {
        // Add {service} placeholder to URI if missing
        uriTemplate = uriTemplate.replace(/\/[^\/\?]+(\?|$)/, '/{service}$1');
      }
      return createPerServiceDatabaseStrategy(resolvedDbNameTemplate, uriTemplate);
    case 'per-brand':
      return createPerBrandDatabaseStrategy(
        resolveDbNameTemplate(dbConfig?.dbNameTemplate || 'brand_{brand}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-brand-service':
      return createPerBrandServiceDatabaseStrategy(
        resolveDbNameTemplate(dbConfig?.dbNameTemplate || 'brand_{brand}_{service}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-tenant':
      return createPerTenantDatabaseStrategy(
        resolveDbNameTemplate(dbConfig?.dbNameTemplate || 'tenant_{tenantId}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-tenant-service':
      return createPerTenantServiceDatabaseStrategy(
        resolveDbNameTemplate(dbConfig?.dbNameTemplate || 'tenant_{tenantId}_{service}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-shard':
      return createPerShardDatabaseStrategy({
        numShards: dbConfig?.numShards || 4,
        dbNameTemplate: resolvedDbNameTemplate,
        uriTemplate,
      });
    default:
      // Should not reach here - all cases handled above
      return createPerServiceDatabaseStrategy('{service}', uriTemplate);
  }
}

function resolveUriTemplate(template: string, context: { service: string; brand?: string; tenantId?: string }): string {
  let resolved = template.replace(/{service}/g, context.service.replace(/-/g, '_'));
  if (context.brand) resolved = resolved.replace(/{brand}/g, context.brand);
  if (context.tenantId) resolved = resolved.replace(/{tenantId}/g, context.tenantId);
  return resolved;
}

function resolveDbNameTemplate(template: string, context: { service: string; brand?: string; tenantId?: string }): string {
  let resolved = template.replace(/{service}/g, context.service.replace(/-/g, '_'));
  if (context.brand) resolved = resolved.replace(/{brand}/g, context.brand);
  if (context.tenantId) resolved = resolved.replace(/{tenantId}/g, context.tenantId);
  return resolved;
}

export async function resolveRedisUrlFromConfig(
  service: string,
  options?: { brand?: string; tenantId?: string }
): Promise<string | undefined> {
  // IMPORTANT: Environment variables take highest priority (Docker/K8s override)
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  
  // Fall back to config store
  const { brand, tenantId } = options || {};
  const dbConfig = await getConfigWithDefault<DatabaseConfig>(service, 'database', { brand, tenantId });
  return dbConfig?.redisUrl;
}

// ═══════════════════════════════════════════════════════════════════
// Centralized Database Access
// ═══════════════════════════════════════════════════════════════════

const strategyCache = new Map<string, DatabaseStrategyResolver>();
const databaseCache = new Map<string, Db>();

export function getCentralDatabase(): Db {
  return getClient().db(CORE_DATABASE_NAME);
}

export function getCentralClient() {
  return getClient();
}

export async function getServiceDatabase(
  serviceName: string,
  context?: { brand?: string; tenantId?: string }
): Promise<Db> {
  const { brand, tenantId } = context || {};
  const cacheKey = `${serviceName}:${brand || ''}:${tenantId || ''}`;
  
  const cachedDb = databaseCache.get(cacheKey);
  if (cachedDb) return cachedDb;
  
  const strategy = await getServiceStrategy(serviceName, { brand, tenantId });
  const dbContext: DatabaseContext = {
    service: serviceName,
    ...(brand && { brand }),
    ...(tenantId && { tenantId }),
  };
  
  const db = await strategy.resolve(dbContext);
  databaseCache.set(cacheKey, db);
  return db;
}

export async function getServiceStrategy(
  serviceName: string,
  context?: { brand?: string; tenantId?: string }
): Promise<DatabaseStrategyResolver> {
  const { brand, tenantId } = context || {};
  const cacheKey = `${serviceName}:${brand || ''}:${tenantId || ''}`;
  
  const cached = strategyCache.get(cacheKey);
  if (cached) return cached;
  
  const strategy = await resolveDatabaseStrategyFromConfig(serviceName, { brand, tenantId });
  strategyCache.set(cacheKey, strategy);
  return strategy;
}

export function clearDatabaseCaches(): void {
  strategyCache.clear();
  databaseCache.clear();
}

export async function initializeServiceDatabase(options: ServiceDatabaseOptions): Promise<{
  database: Db;
  strategy: DatabaseStrategyResolver;
  context: DatabaseContext;
}> {
  const { serviceName, brand, tenantId, database, databaseStrategy } = options;
  
  const context: DatabaseContext = {
    service: serviceName,
    ...(brand && { brand }),
    ...(tenantId && { tenantId }),
  };
  
  if (database) {
    const simpleStrategy = createSharedDatabaseStrategy(database);
    return { database, strategy: simpleStrategy, context };
  }
  
  if (databaseStrategy) {
    const db = await databaseStrategy.resolve(context);
    return { database: db, strategy: databaseStrategy, context };
  }
  
  try {
    getDatabase();
  } catch {
    // Connect: env > config > local dev default (same logic as resolveDatabaseStrategyFromConfig)
    let mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      const dbConfig = await getConfigWithDefault<{ mongoUri?: string; strategy?: string }>(serviceName, 'database', { brand, tenantId });
      mongoUri = dbConfig?.mongoUri;
      if (!mongoUri) {
        const strat = dbConfig?.strategy ?? ((serviceName === 'core-service' || serviceName === 'auth-service') ? 'shared' : 'per-service');
        const dbName = strat === 'shared' ? CORE_DATABASE_NAME : serviceName.replace(/-/g, '_');
        mongoUri = `mongodb://localhost:27017/${dbName}`;
      }
    }
    await connectDatabase(mongoUri);
  }

  const strategy = await getServiceStrategy(serviceName, { brand, tenantId });
  const db = await getServiceDatabase(serviceName, { brand, tenantId });
  
  return { database: db, strategy, context };
}
