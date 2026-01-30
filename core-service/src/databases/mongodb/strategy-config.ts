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
  
  let dbConfig = await getConfigWithDefault<DatabaseConfig>(service, 'database', { brand, tenantId });
  
  // Build base MongoDB URI from environment or localhost fallback
  const baseMongoHost = process.env.MONGO_URI 
    ? process.env.MONGO_URI.replace(/\/[^\/]+(\?.*)?$/, '') // Extract host part (mongodb://host:port)
    : 'mongodb://localhost:27017';
  
  if (!dbConfig) {
    const isSharedService = service === 'core-service' || service === 'auth-service';
    dbConfig = {
      strategy: (isSharedService ? 'shared' : 'per-service') as DatabaseStrategy,
      mongoUri: isSharedService 
        ? `${baseMongoHost}/${CORE_DATABASE_NAME}?directConnection=true`
        : `${baseMongoHost}/{service}?directConnection=true`,
      dbNameTemplate: isSharedService ? CORE_DATABASE_NAME : '{service}',
      redisUrl: process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`,
    };
  }
  
  const strategy = dbConfig.strategy || 'per-service';
  let mongoUri = dbConfig.mongoUri;
  
  if (strategy === 'per-service' && mongoUri && !mongoUri.includes('{service}')) {
    mongoUri = `${baseMongoHost}/{service}?directConnection=true`;
  }
  if (!mongoUri) {
    mongoUri = `${baseMongoHost}/{service}?directConnection=true`;
  }
  
  let uriTemplate = mongoUri;
  let dbNameTemplate = dbConfig.dbNameTemplate || '{service}';
  
  if (strategy !== 'per-service') {
    uriTemplate = resolveUriTemplate(uriTemplate, { service, brand, tenantId });
    dbNameTemplate = resolveDbNameTemplate(dbNameTemplate, { service, brand, tenantId });
  }
  
  switch (strategy) {
    case 'shared':
      return createSharedDatabaseStrategy();
    case 'per-service':
      if (!dbNameTemplate.includes('{service}')) dbNameTemplate = '{service}';
      if (!uriTemplate.includes('{service}')) uriTemplate = `${baseMongoHost}/{service}?directConnection=true`;
      return createPerServiceDatabaseStrategy(dbNameTemplate, uriTemplate);
    case 'per-brand':
      return createPerBrandDatabaseStrategy(
        resolveDbNameTemplate(dbConfig.dbNameTemplate || 'brand_{brand}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-brand-service':
      return createPerBrandServiceDatabaseStrategy(
        resolveDbNameTemplate(dbConfig.dbNameTemplate || 'brand_{brand}_{service}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-tenant':
      return createPerTenantDatabaseStrategy(
        resolveDbNameTemplate(dbConfig.dbNameTemplate || 'tenant_{tenantId}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-tenant-service':
      return createPerTenantServiceDatabaseStrategy(
        resolveDbNameTemplate(dbConfig.dbNameTemplate || 'tenant_{tenantId}_{service}', { service, brand, tenantId }),
        resolveUriTemplate(uriTemplate, { service, brand, tenantId })
      );
    case 'per-shard':
      return createPerShardDatabaseStrategy({
        numShards: dbConfig.numShards || 4,
        dbNameTemplate,
        uriTemplate,
      });
    default:
      return createPerServiceDatabaseStrategy('{service}', `${baseMongoHost}/{service}?directConnection=true`);
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
  const { brand, tenantId } = options || {};
  const dbConfig = await getConfigWithDefault<DatabaseConfig>(service, 'database', { brand, tenantId });
  return dbConfig?.redisUrl || process.env.REDIS_URL || 
    (process.env.REDIS_PASSWORD ? `redis://:${process.env.REDIS_PASSWORD}@localhost:6379` : undefined);
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
    const mongoUri = process.env.MONGO_URI || `mongodb://localhost:27017/${CORE_DATABASE_NAME}?directConnection=true`;
    await connectDatabase(mongoUri);
  }
  
  const strategy = await getServiceStrategy(serviceName, { brand, tenantId });
  const db = await getServiceDatabase(serviceName, { brand, tenantId });
  
  return { database: db, strategy, context };
}
