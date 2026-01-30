/**
 * Base Repository Class
 * 
 * Generic repository base class that provides common CRUD operations.
 * Extend this class for domain-specific repositories in microservices.
 * 
 * Features:
 * - Generic type-safe CRUD operations
 * - MongoDB session support for transactions
 * - Automatic timestamps (createdAt, updatedAt)
 * - Cursor-based pagination
 * - Bulk operations
 * - Soft delete support
 * - Query building helpers
 * - Logging
 * 
 * @example
 * ```typescript
 * // In your service
 * import { BaseRepository } from 'core-service';
 * 
 * interface User extends BaseEntity {
 *   email: string;
 *   name: string;
 * }
 * 
 * class UserRepository extends BaseRepository<User> {
 *   constructor() {
 *     super('users', db);
 *   }
 *   
 *   // Add domain-specific methods
 *   async findByEmail(email: string): Promise<User | null> {
 *     return this.findOne({ email });
 *   }
 * }
 * ```
 */

import type { 
  Collection, 
  Db,
  Document,
  Filter,
  UpdateFilter,
  FindOptions,
  ClientSession,
  Sort,
  IndexDescription,
} from 'mongodb';
import { randomUUID } from 'node:crypto';

import { logger } from '../../common/logger.js';
import { generateMongoId, normalizeDocument } from './utils.js';
import { paginateCollection, type PaginateOptions, type PaginationResult } from './pagination.js';

// Import shared types from types/
import type { 
  BaseEntity, 
  UserEntity,
} from '../../types/common.js';
import type { WriteOptions } from '../../types/repository.js';

// ═══════════════════════════════════════════════════════════════════
// Additional Types for Base Repository
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal entity interface for entities without tenantId
 * Use this for truly global entities (rare)
 */
export interface MinimalEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Re-export types for convenience when importing from base-repository
export type { BaseEntity, UserEntity, WriteOptions };

/**
 * Query options
 */
export interface QueryOptions<T> {
  filter?: Filter<T>;
  sort?: Sort;
  limit?: number;
  skip?: number;
  session?: ClientSession;
  projection?: Document;
}

/**
 * Pagination input
 */
export interface PaginationInput {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

/**
 * Database accessor interface
 */
export interface DatabaseAccessor {
  getDb(): Promise<Db>;
}

/**
 * Repository configuration
 */
export interface RepositoryConfig {
  /** Enable automatic timestamps (default: true) */
  timestamps?: boolean;
  /** Custom createdAt field name */
  createdAtField?: string;
  /** Custom updatedAt field name */
  updatedAtField?: string;
  /** Enable soft delete (default: false) */
  softDelete?: boolean;
  /** Soft delete field name (default: 'deletedAt') */
  softDeleteField?: string;
  /** Default sort field */
  defaultSortField?: string;
  /** Default sort direction */
  defaultSortDirection?: 'asc' | 'desc';
  /** Default page size */
  defaultPageSize?: number;
  /** Indexes to create */
  indexes?: IndexDescription[];
}

// ═══════════════════════════════════════════════════════════════════
// Base Repository Class
// ═══════════════════════════════════════════════════════════════════

/**
 * Base Repository Class
 * 
 * Provides generic CRUD operations for MongoDB collections.
 * Extend this class and add domain-specific methods.
 */
export abstract class BaseRepository<T extends BaseEntity> {
  protected readonly collectionName: string;
  protected readonly dbAccessor: DatabaseAccessor;
  protected readonly config: Required<RepositoryConfig>;
  
  private _collection: Collection<Document> | null = null;
  private _indexesCreated = false;
  
  constructor(
    collectionName: string,
    dbAccessor: DatabaseAccessor,
    config: RepositoryConfig = {}
  ) {
    this.collectionName = collectionName;
    this.dbAccessor = dbAccessor;
    
    // Merge with defaults
    this.config = {
      timestamps: config.timestamps ?? true,
      createdAtField: config.createdAtField ?? 'createdAt',
      updatedAtField: config.updatedAtField ?? 'updatedAt',
      softDelete: config.softDelete ?? false,
      softDeleteField: config.softDeleteField ?? 'deletedAt',
      defaultSortField: config.defaultSortField ?? 'createdAt',
      defaultSortDirection: config.defaultSortDirection ?? 'desc',
      defaultPageSize: config.defaultPageSize ?? 20,
      indexes: config.indexes ?? [],
    };
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Collection Access
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Get MongoDB collection
   */
  protected async getCollection(): Promise<Collection<Document>> {
    if (!this._collection) {
      const db = await this.dbAccessor.getDb();
      this._collection = db.collection(this.collectionName);
      
      // Create indexes on first access
      if (!this._indexesCreated && this.config.indexes.length > 0) {
        await this.ensureIndexes();
        this._indexesCreated = true;
      }
    }
    return this._collection;
  }
  
  /**
   * Ensure indexes are created
   */
  protected async ensureIndexes(): Promise<void> {
    const collection = await this.getCollection();
    for (const index of this.config.indexes) {
      try {
        // Extract key and clean options (remove null/undefined values)
        const { key, ...rawOptions } = index;
        const options = Object.fromEntries(
          Object.entries(rawOptions).filter(([_, v]) => v != null)
        );
        await collection.createIndex(key, options);
      } catch (error) {
        // Index might already exist
        logger.debug('Index creation skipped', { 
          collection: this.collectionName, 
          key: index.key 
        });
      }
    }
  }
  
  // ───────────────────────────────────────────────────────────────────
  // CREATE Operations
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new entity
   */
  async create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: WriteOptions
  ): Promise<T> {
    const collection = await this.getCollection();
    const now = new Date();
    
    // Generate MongoDB ObjectId
    const { objectId, idString } = generateMongoId();
    
    // Build document
    const doc: any = {
      _id: objectId,
      id: idString,
      ...data,
    };
    
    // Add timestamps
    if (this.config.timestamps && !options?.skipTimestamps) {
      doc[this.config.createdAtField] = now;
      doc[this.config.updatedAtField] = now;
    }
    
    await collection.insertOne(doc, { session: options?.session });
    
    this.logOperation('create', { id: idString });
    
    return this.normalize(doc);
  }
  
  /**
   * Create multiple entities
   */
  async createMany(
    items: Omit<T, 'id' | 'createdAt' | 'updatedAt'>[],
    options?: WriteOptions
  ): Promise<T[]> {
    if (items.length === 0) return [];
    
    const collection = await this.getCollection();
    const now = new Date();
    
    const docs = items.map(item => {
      const { objectId, idString } = generateMongoId();
      const doc: any = {
        _id: objectId,
        id: idString,
        ...item,
      };
      
      if (this.config.timestamps && !options?.skipTimestamps) {
        doc[this.config.createdAtField] = now;
        doc[this.config.updatedAtField] = now;
      }
      
      return doc;
    });
    
    await collection.insertMany(docs, { 
      session: options?.session,
      ordered: false, // Parallel inserts
    });
    
    this.logOperation('createMany', { count: docs.length });
    
    return docs.map(doc => this.normalize(doc));
  }
  
  // ───────────────────────────────────────────────────────────────────
  // READ Operations
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find entity by ID
   */
  async findById(
    id: string,
    options?: WriteOptions
  ): Promise<T | null> {
    const collection = await this.getCollection();
    const filter = this.buildFindFilter({ id } as Partial<T>);
    
    const doc = await collection.findOne(filter, { 
      session: options?.session,
    });
    
    return doc ? this.normalize(doc) : null;
  }
  
  /**
   * Find one entity by filter
   */
  async findOne(
    filter: Partial<T>,
    options?: WriteOptions
  ): Promise<T | null> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    const doc = await collection.findOne(mongoFilter, {
      session: options?.session,
    });
    
    return doc ? this.normalize(doc) : null;
  }
  
  /**
   * Find multiple entities by filter
   */
  async findMany(
    filter: Partial<T> = {},
    queryOptions?: QueryOptions<T>
  ): Promise<T[]> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    const cursor = collection.find(mongoFilter, {
      session: queryOptions?.session,
      projection: queryOptions?.projection,
    });
    
    if (queryOptions?.sort) {
      cursor.sort(queryOptions.sort);
    } else {
      cursor.sort({ [this.config.defaultSortField]: this.config.defaultSortDirection === 'asc' ? 1 : -1 });
    }
    
    if (queryOptions?.skip) {
      cursor.skip(queryOptions.skip);
    }
    
    if (queryOptions?.limit) {
      cursor.limit(queryOptions.limit);
    }
    
    const docs = await cursor.toArray();
    return docs.map(doc => this.normalize(doc));
  }
  
  /**
   * Find multiple entities by IDs
   */
  async findByIds(
    ids: string[],
    options?: WriteOptions
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    
    const collection = await this.getCollection();
    const filter = this.buildFindFilter({} as Partial<T>);
    (filter as any).id = { $in: ids };
    
    const docs = await collection.find(filter, {
      session: options?.session,
    }).toArray();
    
    return docs.map(doc => this.normalize(doc));
  }
  
  /**
   * Check if entity exists
   */
  async exists(
    filter: Partial<T>,
    options?: WriteOptions
  ): Promise<boolean> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    const doc = await collection.findOne(mongoFilter, {
      session: options?.session,
      projection: { id: 1 },
    });
    
    return doc !== null;
  }
  
  /**
   * Count entities
   */
  async count(
    filter: Partial<T> = {},
    options?: WriteOptions
  ): Promise<number> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    // Use estimatedDocumentCount for no-filter counts (faster)
    if (Object.keys(filter).length === 0 && !this.config.softDelete) {
      return collection.estimatedDocumentCount();
    }
    
    return collection.countDocuments(mongoFilter as Filter<Document>);
  }
  
  /**
   * Query with cursor-based pagination
   */
  async paginate(
    filter: Partial<T>,
    pagination?: PaginationInput
  ): Promise<PaginationResult<T>> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    const result = await paginateCollection<T>(collection as any, {
      filter: mongoFilter,
      first: pagination?.first ?? this.config.defaultPageSize,
      after: pagination?.after,
      last: pagination?.last,
      before: pagination?.before,
      sortField: pagination?.sortField ?? this.config.defaultSortField,
      sortDirection: pagination?.sortDirection ?? this.config.defaultSortDirection,
    });
    
    // Transform edges to nodes
    return {
      nodes: result.edges.map(edge => this.normalize(edge.node as any)),
      pageInfo: result.pageInfo,
      totalCount: result.totalCount,
    };
  }
  
  // ───────────────────────────────────────────────────────────────────
  // UPDATE Operations
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update entity by ID
   */
  async update(
    id: string,
    data: Partial<T>,
    options?: WriteOptions
  ): Promise<T | null> {
    const collection = await this.getCollection();
    const filter = this.buildFindFilter({ id } as Partial<T>);
    
    // Build update
    const update: any = { ...data };
    delete update.id;
    delete update.createdAt;
    
    // Add timestamp
    if (this.config.timestamps && !options?.skipTimestamps) {
      update[this.config.updatedAtField] = new Date();
    }
    
    const result = await collection.findOneAndUpdate(
      filter,
      { $set: update },
      { 
        returnDocument: 'after',
        session: options?.session,
      }
    );
    
    if (result) {
      this.logOperation('update', { id });
    }
    
    return result ? this.normalize(result) : null;
  }
  
  /**
   * Update many entities by filter
   */
  async updateMany(
    filter: Partial<T>,
    data: Partial<T>,
    options?: WriteOptions
  ): Promise<number> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    // Build update
    const update: any = { ...data };
    delete update.id;
    delete update.createdAt;
    
    if (this.config.timestamps && !options?.skipTimestamps) {
      update[this.config.updatedAtField] = new Date();
    }
    
    const result = await collection.updateMany(
      mongoFilter,
      { $set: update },
      { session: options?.session }
    );
    
    this.logOperation('updateMany', { count: result.modifiedCount });
    
    return result.modifiedCount;
  }
  
  /**
   * Update with MongoDB update operators ($set, $push, etc.)
   */
  async updateWithOperators(
    id: string,
    update: UpdateFilter<Document>,
    options?: WriteOptions
  ): Promise<T | null> {
    const collection = await this.getCollection();
    const filter = this.buildFindFilter({ id } as Partial<T>);
    
    // Add timestamp to $set if present
    if (this.config.timestamps && !options?.skipTimestamps) {
      if (!update.$set) update.$set = {};
      (update.$set as any)[this.config.updatedAtField] = new Date();
    }
    
    const result = await collection.findOneAndUpdate(
      filter,
      update,
      {
        returnDocument: 'after',
        session: options?.session,
      }
    );
    
    if (result) {
      this.logOperation('updateWithOperators', { id });
    }
    
    return result ? this.normalize(result) : null;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // DELETE Operations
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Delete entity by ID
   */
  async delete(
    id: string,
    options?: WriteOptions
  ): Promise<boolean> {
    const collection = await this.getCollection();
    const filter = { id } as Filter<Document>;
    
    if (this.config.softDelete) {
      // Soft delete
      const update: any = {
        [this.config.softDeleteField]: new Date(),
      };
      
      if (this.config.timestamps) {
        update[this.config.updatedAtField] = new Date();
      }
      
      const result = await collection.updateOne(
        filter,
        { $set: update },
        { session: options?.session }
      );
      
      if (result.modifiedCount > 0) {
        this.logOperation('softDelete', { id });
      }
      
      return result.modifiedCount > 0;
    } else {
      // Hard delete
      const result = await collection.deleteOne(filter, {
        session: options?.session,
      });
      
      if (result.deletedCount > 0) {
        this.logOperation('delete', { id });
      }
      
      return result.deletedCount > 0;
    }
  }
  
  /**
   * Delete many entities by filter
   */
  async deleteMany(
    filter: Partial<T>,
    options?: WriteOptions
  ): Promise<number> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFindFilter(filter);
    
    if (this.config.softDelete) {
      const update: any = {
        [this.config.softDeleteField]: new Date(),
      };
      
      if (this.config.timestamps) {
        update[this.config.updatedAtField] = new Date();
      }
      
      const result = await collection.updateMany(
        mongoFilter,
        { $set: update },
        { session: options?.session }
      );
      
      this.logOperation('softDeleteMany', { count: result.modifiedCount });
      
      return result.modifiedCount;
    } else {
      const result = await collection.deleteMany(mongoFilter, {
        session: options?.session,
      });
      
      this.logOperation('deleteMany', { count: result.deletedCount });
      
      return result.deletedCount;
    }
  }
  
  /**
   * Hard delete (bypasses soft delete)
   */
  async hardDelete(
    id: string,
    options?: WriteOptions
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.deleteOne(
      { id } as Filter<Document>,
      { session: options?.session }
    );
    
    if (result.deletedCount > 0) {
      this.logOperation('hardDelete', { id });
    }
    
    return result.deletedCount > 0;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Aggregation
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Run aggregation pipeline
   */
  async aggregate<R = any>(
    pipeline: Document[],
    options?: WriteOptions
  ): Promise<R[]> {
    const collection = await this.getCollection();
    
    const results = await collection.aggregate(pipeline, {
      session: options?.session,
    }).toArray();
    
    return results as R[];
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Build filter with soft delete handling
   */
  protected buildFindFilter(filter: Partial<T>): Filter<Document> {
    const mongoFilter: any = { ...filter };
    
    // Exclude soft-deleted records
    if (this.config.softDelete) {
      mongoFilter[this.config.softDeleteField] = { $exists: false };
    }
    
    return mongoFilter;
  }
  
  /**
   * Normalize MongoDB document to entity
   */
  protected normalize(doc: Document): T {
    const result = { ...doc };
    delete result._id;
    return result as T;
  }
  
  /**
   * Log repository operation
   */
  protected logOperation(operation: string, data: Record<string, unknown>): void {
    logger.debug(`[${this.collectionName}] ${operation}`, data);
  }
  
  /**
   * Log error
   */
  protected logError(operation: string, error: Error, data?: Record<string, unknown>): void {
    logger.error(`[${this.collectionName}] ${operation} failed`, {
      ...data,
      error: error.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Specialized Base Classes
// ═══════════════════════════════════════════════════════════════════

/**
 * TenantRepository - convenience alias since BaseEntity already has tenantId
 * 
 * All entities in this codebase are tenant-scoped (BaseEntity has tenantId),
 * so this is just an alias for BaseRepository with some helper methods.
 */
export abstract class TenantRepository<T extends BaseEntity> extends BaseRepository<T> {
  /**
   * Find by ID within tenant
   */
  async findByIdInTenant(
    id: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<T | null> {
    return this.findOne({ id, tenantId } as Partial<T>, options);
  }
  
  /**
   * Find many within tenant
   */
  async findManyInTenant(
    tenantId: string,
    filter: Partial<T> = {},
    queryOptions?: QueryOptions<T>
  ): Promise<T[]> {
    return this.findMany({ ...filter, tenantId } as Partial<T>, queryOptions);
  }
  
  /**
   * Count within tenant
   */
  async countInTenant(
    tenantId: string,
    filter: Partial<T> = {}
  ): Promise<number> {
    return this.count({ ...filter, tenantId } as Partial<T>);
  }
  
  /**
   * Paginate within tenant
   */
  async paginateInTenant(
    tenantId: string,
    filter: Partial<T>,
    pagination?: PaginationInput
  ): Promise<PaginationResult<T>> {
    return this.paginate({ ...filter, tenantId } as Partial<T>, pagination);
  }
}

/**
 * UserScopedRepository - for entities owned by a user
 * 
 * Extends TenantRepository with user-specific query helpers.
 * Use this for entities that have both tenantId and userId.
 */
export abstract class UserScopedRepository<T extends UserEntity> extends TenantRepository<T> {
  /**
   * Find by user ID
   */
  async findByUserId(
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<T | null> {
    return this.findOne({ userId, tenantId } as Partial<T>, options);
  }
  
  /**
   * Find many by user ID
   */
  async findManyByUserId(
    userId: string,
    tenantId: string,
    filter: Partial<T> = {},
    queryOptions?: QueryOptions<T>
  ): Promise<T[]> {
    return this.findMany({ ...filter, userId, tenantId } as Partial<T>, queryOptions);
  }
  
  /**
   * Check if user owns entity
   */
  async isOwnedByUser(
    id: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> {
    return this.exists({ id, userId, tenantId } as Partial<T>);
  }
}
