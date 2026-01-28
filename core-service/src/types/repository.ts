/**
 * Repository Types
 * 
 * Generic MongoDB repository with caching, pagination, and transactions
 */

import type { ClientSession, Db } from 'mongodb';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';

// Re-export for convenience
export type { DatabaseContext } from '../databases/strategy.js';

// ═══════════════════════════════════════════════════════════════════
// Write Options (transactions)
// ═══════════════════════════════════════════════════════════════════

/** Options for repository write operations */
export interface WriteOptions {
  /** MongoDB session for transactional operations */
  session?: ClientSession;
  /** Skip automatic timestamp updates for this operation */
  skipTimestamps?: boolean;
  /** Database context for strategy resolution (service, brand, tenantId, shardKey) */
  context?: DatabaseContext;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Interface
// ═══════════════════════════════════════════════════════════════════

export interface Repository<T> {
  // Read operations (lean - no _id, optimized projection)
  findById(id: string, options?: WriteOptions): Promise<T | null>;
  findMany(options: FindManyOptions): Promise<{ items: T[]; total: number }>;
  findOne(filter: Partial<T>, options?: WriteOptions): Promise<T | null>;
  findByIds(ids: string[], options?: WriteOptions): Promise<T[]>;
  exists(filter: Partial<T>, options?: WriteOptions): Promise<boolean>;
  count(filter?: Partial<T>, options?: WriteOptions): Promise<number>;
  
  // Cursor-based pagination (optimized for large datasets)
  paginate(options: CursorPaginationOptions): Promise<CursorPaginationResult<T>>;
  
  // Write operations (support transactional sessions)
  create(entity: T, options?: WriteOptions): Promise<T>;
  update(id: string, data: Partial<T>, options?: WriteOptions): Promise<T | null>;
  delete(id: string, options?: WriteOptions): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════════
// Query Options
// ═══════════════════════════════════════════════════════════════════

export interface FindManyOptions {
  filter?: Record<string, unknown>;
  skip?: number;
  take?: number;
  sort?: Record<string, 1 | -1>;
  /** Select specific fields only (projection) */
  fields?: string[];
  /** Database context for strategy resolution (service, brand, tenantId, shardKey) */
  context?: DatabaseContext;
}

// ═══════════════════════════════════════════════════════════════════
// Cursor-Based Pagination
// ═══════════════════════════════════════════════════════════════════

export interface CursorPaginationOptions {
  /** Number of items to return (default: 20) */
  first?: number;
  /** Cursor to start after (for forward pagination) */
  after?: string;
  /** Number of items to return from end (for backward pagination) */
  last?: number;
  /** Cursor to start before (for backward pagination) */
  before?: string;
  /** Filter conditions */
  filter?: Record<string, unknown>;
  /** Sort field and direction (default: createdAt DESC) */
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  /** Select specific fields only */
  fields?: string[];
  /** Database context for strategy resolution (service, brand, tenantId, shardKey) */
  context?: DatabaseContext;
}

export interface CursorPaginationResult<T> {
  edges: Array<{
    node: T;
    cursor: string;
  }>;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// Index Configuration
// ═══════════════════════════════════════════════════════════════════

export interface IndexConfig {
  fields: Record<string, 1 | -1>;
  options?: { 
    unique?: boolean; 
    sparse?: boolean;
    expireAfterSeconds?: number;
    name?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cache Configuration
// ═══════════════════════════════════════════════════════════════════

export interface CacheTTLConfig {
  /** TTL for single item queries (default: 300 = 5 minutes) */
  single?: number;
  /** TTL for list queries (default: 60 = 1 minute) */
  list?: number;
  /** TTL for count queries (default: 30 seconds) */
  count?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Timestamp Configuration (like Mongoose)
// ═══════════════════════════════════════════════════════════════════

export interface TimestampConfig {
  /** Field name for creation timestamp (default: 'createdAt') */
  createdAt?: string | false;
  /** Field name for update timestamp (default: 'updatedAt') */
  updatedAt?: string | false;
  /** Use current time or custom function */
  currentTime?: () => Date;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Options
// ═══════════════════════════════════════════════════════════════════

export interface RepositoryOptions {
  /** Index configurations */
  indexes?: IndexConfig[];
  /** Cache TTL settings (set to null to disable caching) */
  cacheTTL?: CacheTTLConfig | null;
  /** Custom cache key prefix (default: collection name) */
  cachePrefix?: string;
  /** Fields to always exclude from queries (default: ['_id']) */
  excludeFields?: string[];
  /** Default batch size for cursors (default: 100) */
  batchSize?: number;
  /** 
   * Automatic timestamps (like Mongoose's timestamps option)
   * - true: Enable timestamps with default field names (createdAt, updatedAt)
   * - false: Disable automatic timestamps
   * - object: Custom configuration for field names
   * Default: true
   */
  timestamps?: boolean | TimestampConfig;
  /** 
   * Database instance (if provided, uses this directly)
   * If not provided, uses getDatabase() or databaseStrategy
   */
  database?: Db;
  /** 
   * Database strategy resolver (for dynamic database resolution)
   * Takes precedence over database option
   */
  databaseStrategy?: DatabaseStrategyResolver;
  /** 
   * Default database context for strategy resolution
   * Used when context is not provided in individual operations
   */
  defaultContext?: DatabaseContext;
}

