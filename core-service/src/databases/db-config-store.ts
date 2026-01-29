/**
 * Dynamic Database Configuration Store
 * 
 * Stores database connection settings (URI, dbName, etc.) in MongoDB
 * Allows dynamic database configuration without code changes
 * 
 * Similar to config-store but specifically for database connection settings
 * Supports same strategies: per-service, per-brand, per-tenant, per-shard
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses abstractions (getDatabase, getRedis)
 * - Static imports
 */

import { getDatabase } from './mongodb.js';
import { getCache, setCache, deleteCache, deleteCachePattern } from './cache.js';
import { logger } from '../common/logger.js';
import { generateMongoId } from './mongodb-utils.js';
import type { Collection, Document, Filter, Db } from 'mongodb';
import type { MongoConfig } from './mongodb.js';
import type { DatabaseStrategyResolver, DatabaseContext } from './strategy.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseConfigEntry {
  id: string;
  service?: string;
  brand?: string;
  tenantId?: string;
  shardKey?: string | number;
  uri: string;
  dbName?: string;
  config?: Partial<MongoConfig>;
  metadata?: {
    description?: string;
    updatedBy?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  __v?: number;
}

export interface DatabaseConfigStoreOptions {
  /** Collection name (default: 'database_configs') */
  collectionName?: string;
  /** Cache enabled (default: true) */
  cacheEnabled?: boolean;
  /** Cache TTL in seconds (default: 600) */
  cacheTtl?: number;
  /** Database instance to use (optional) */
  database?: Db;
  /** Database strategy resolver (optional) */
  databaseStrategy?: DatabaseStrategyResolver;
}

export interface GetDatabaseConfigOptions {
  service?: string;
  brand?: string;
  tenantId?: string;
  shardKey?: string | number;
  defaultValue?: {
    uri: string;
    dbName?: string;
    config?: Partial<MongoConfig>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Database Config Store Class
// ═══════════════════════════════════════════════════════════════════

/**
 * Database Configuration Store
 * Stores and retrieves database connection settings dynamically
 */
export class DatabaseConfigStore {
  private collectionName: string;
  private cacheEnabled: boolean;
  private cacheTtl: number;
  private database: Db | null;
  private databaseStrategy: DatabaseStrategyResolver | null;
  private collection: Collection<Document> | null = null;

  constructor(options: DatabaseConfigStoreOptions = {}) {
    this.collectionName = options.collectionName || 'database_configs';
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTtl = options.cacheTtl || 600; // 10 minutes default (longer than config-store)
    this.database = options.database || null;
    this.databaseStrategy = options.databaseStrategy || null;
  }

  /**
   * Get MongoDB database instance (for storing configs)
   */
  private async getDatabase(context?: DatabaseContext): Promise<Db> {
    if (this.databaseStrategy && context) {
      return this.databaseStrategy.resolve(context);
    }
    if (this.database) {
      return this.database;
    }
    return getDatabase();
  }

  /**
   * Get MongoDB collection (lazy initialization)
   */
  private async getCollection(context?: DatabaseContext): Promise<Collection<Document>> {
    const db = await this.getDatabase(context);
    
    if (this.databaseStrategy && context) {
      // Strategy-based: return collection for this context
      return db.collection(this.collectionName);
    }
    
    // Static database: cache collection
    if (!this.collection) {
      this.collection = db.collection(this.collectionName);
      
      // Create indexes
      await this.collection.createIndex(
        { service: 1, brand: 1, tenantId: 1, shardKey: 1 },
        { unique: true, sparse: true }
      ).catch(() => {});
      
      await this.collection.createIndex(
        { service: 1, brand: 1 }
      ).catch(() => {});
    }
    
    return this.collection;
  }

  /**
   * Build cache key
   */
  private buildCacheKey(service?: string, brand?: string, tenantId?: string, shardKey?: string | number): string {
    const parts = ['dbconfig'];
    if (service) parts.push(service);
    if (brand) parts.push(`brand:${brand}`);
    if (tenantId) parts.push(`tenant:${tenantId}`);
    if (shardKey !== undefined) parts.push(`shard:${shardKey}`);
    return parts.join(':');
  }

  /**
   * Build MongoDB query filter
   */
  private buildQuery(service?: string, brand?: string, tenantId?: string, shardKey?: string | number): Filter<Document> {
    const query: Filter<Document> = {};
    if (service !== undefined) query.service = service;
    if (brand !== undefined) query.brand = brand;
    if (tenantId !== undefined) query.tenantId = tenantId;
    if (shardKey !== undefined) query.shardKey = shardKey;
    return query;
  }

  /**
   * Get database configuration
   * Returns connection settings (URI, dbName, config) for the given context
   */
  async get(options: GetDatabaseConfigOptions = {}): Promise<{
    uri: string;
    dbName?: string;
    config?: Partial<MongoConfig>;
  } | null> {
    const { service, brand, tenantId, shardKey, defaultValue } = options;
    const cacheKey = this.buildCacheKey(service, brand, tenantId, shardKey);
    const query = this.buildQuery(service, brand, tenantId, shardKey);

    // Try cache first
    if (this.cacheEnabled) {
      const cached = await this.getFromCache(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Try database
    const context: DatabaseContext = { service: service || '', brand, tenantId, shardKey };
    const collection = await this.getCollection(context);
    const doc = await collection.findOne(query);
    
    if (doc) {
      const config = this.normalizeDocument(doc);
      
      // Cache result
      if (this.cacheEnabled) {
        await this.setCache(cacheKey, {
          uri: config.uri,
          dbName: config.dbName,
          config: config.config,
        });
      }
      
      return {
        uri: config.uri,
        dbName: config.dbName,
        config: config.config,
      };
    }

    // Not found - return default if provided
    if (defaultValue) {
      return defaultValue;
    }

    return null;
  }

  /**
   * Set database configuration
   */
  async set(
    options: {
      service?: string;
      brand?: string;
      tenantId?: string;
      shardKey?: string | number;
      uri: string;
      dbName?: string;
      config?: Partial<MongoConfig>;
      metadata?: { description?: string; updatedBy?: string };
    }
  ): Promise<void> {
    const { service, brand, tenantId, shardKey, uri, dbName, config, metadata } = options;
    const query = this.buildQuery(service, brand, tenantId, shardKey);
    const cacheKey = this.buildCacheKey(service, brand, tenantId, shardKey);

    const context: DatabaseContext = { service: service || '', brand, tenantId, shardKey };
    const collection = await this.getCollection(context);
    const now = new Date();
    
    // Check if config exists
    const existing = await collection.findOne(query);
    
    if (existing) {
      // Update existing
      await collection.findOneAndUpdate(
        query,
        {
          $set: {
            uri,
            dbName,
            config,
            metadata: {
              ...existing.metadata,
              ...metadata,
            },
            updatedAt: now,
          },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after' }
      );
    } else {
      // Create new
      const { objectId, idString } = generateMongoId();
      await collection.insertOne({
        _id: objectId,
        id: idString,
        service,
        brand,
        tenantId,
        shardKey,
        uri,
        dbName,
        config,
        metadata,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      });
    }

    // Invalidate cache
    if (this.cacheEnabled) {
      await deleteCache(cacheKey);
      await deleteCachePattern('dbconfig:*');
    }
  }

  /**
   * Delete database configuration
   */
  async delete(options: {
    service?: string;
    brand?: string;
    tenantId?: string;
    shardKey?: string | number;
  }): Promise<void> {
    const { service, brand, tenantId, shardKey } = options;
    const query = this.buildQuery(service, brand, tenantId, shardKey);
    const cacheKey = this.buildCacheKey(service, brand, tenantId, shardKey);

    const context: DatabaseContext = { service: service || '', brand, tenantId, shardKey };
    const collection = await this.getCollection(context);
    await collection.deleteOne(query);

    // Invalidate cache
    if (this.cacheEnabled) {
      await deleteCache(cacheKey);
      await deleteCachePattern('dbconfig:*');
    }
  }

  /**
   * Normalize MongoDB document
   */
  private normalizeDocument(doc: Document): DatabaseConfigEntry {
    return {
      id: doc.id || doc._id?.toString() || '',
      service: doc.service,
      brand: doc.brand,
      tenantId: doc.tenantId,
      shardKey: doc.shardKey,
      uri: doc.uri,
      dbName: doc.dbName,
      config: doc.config,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      __v: doc.__v,
    };
  }

  /**
   * Get from cache
   */
  private async getFromCache(cacheKey: string): Promise<{
    uri: string;
    dbName?: string;
    config?: Partial<MongoConfig>;
  } | null> {
    if (!this.cacheEnabled) return null;
    
    try {
      const cached = await getCache<{ uri: string; dbName?: string; config?: Partial<MongoConfig> }>(cacheKey);
      return cached;
    } catch {
      return null;
    }
  }

  /**
   * Set cache
   */
  private async setCache(
    cacheKey: string,
    value: { uri: string; dbName?: string; config?: Partial<MongoConfig> }
  ): Promise<void> {
    if (!this.cacheEnabled) return;
    
    try {
      await setCache(cacheKey, value, this.cacheTtl);
    } catch {
      // Ignore cache errors
    }
  }
}

/**
 * Create a database config store instance
 */
export function createDatabaseConfigStore(options?: DatabaseConfigStoreOptions): DatabaseConfigStore {
  return new DatabaseConfigStore(options);
}

/**
 * Get database configuration with automatic default
 * If config doesn't exist, uses provided default or falls back to environment variable
 */
let defaultDatabaseConfigStore: DatabaseConfigStore | null = null;

export async function getDatabaseConfig(
  options: GetDatabaseConfigOptions & {
    defaultValue?: {
      uri: string;
      dbName?: string;
      config?: Partial<MongoConfig>;
    };
  }
): Promise<{
  uri: string;
  dbName?: string;
  config?: Partial<MongoConfig>;
}> {
  if (!defaultDatabaseConfigStore) {
    defaultDatabaseConfigStore = createDatabaseConfigStore();
  }
  
  const config = await defaultDatabaseConfigStore.get(options);
  
  if (config) {
    return config;
  }
  
  // Fallback to environment variable
  const envUri = process.env.MONGO_URI;
  if (envUri) {
    return {
      uri: envUri,
      dbName: options.defaultValue?.dbName,
      config: options.defaultValue?.config,
    };
  }
  
  // Last resort: throw error
  throw new Error('Database configuration not found and no default provided');
}
