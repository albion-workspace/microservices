/**
 * Generic MongoDB Repository - Optimized with lean queries and caching
 * Supports MongoDB sessions for transactional operations
 */

import { Collection, Document, Filter, FindOptions, ClientSession, Db } from 'mongodb';
import { randomUUID } from 'node:crypto';

import { getDatabase } from './connection.js';
import { cached, deleteCache, deleteCachePattern } from '../cache.js';
import { logger } from '../../common/logger.js';
import { normalizeDocument, generateMongoId } from './utils.js';
import type { 
  Repository, 
  FindManyOptions, 
  IndexConfig, 
  CursorPaginationOptions, 
  CursorPaginationResult, 
  WriteOptions,
  CacheTTLConfig,
  RepositoryOptions,
  TimestampConfig,
} from '../../types/index.js';
import type { DatabaseStrategyResolver, DatabaseContext } from './strategy.js';

export const generateId = () => randomUUID();

// Re-export types
export type { CacheTTLConfig, RepositoryOptions };

const DEFAULT_CACHE_TTL: Required<CacheTTLConfig> = {
  single: 300,    // 5 minutes for single item
  list: 60,       // 1 minute for lists
  count: 30,      // 30 seconds for counts
};

// Lean projection - exclude _id by default (we use custom id field)
const LEAN_PROJECTION = { _id: 0 } as const;

export function createRepository<T extends { id: string }>(
  collectionName: string,
  options: RepositoryOptions = {}
): Repository<T> {
  const { 
    indexes, 
    cacheTTL, 
    cachePrefix = collectionName,
    excludeFields = ['_id'],
    batchSize = 100,
    timestamps = true,  // Default: enabled like Mongoose
    database,
    databaseStrategy,
    defaultContext,
  } = options;
  const ttl = cacheTTL === null ? null : { ...DEFAULT_CACHE_TTL, ...cacheTTL };
  let collection: Collection<Document> | null = null;
  let db: Db | null = database || null;
  const strategy: DatabaseStrategyResolver | undefined = databaseStrategy;
  const defaultCtx: DatabaseContext | undefined = defaultContext;
  
  // Parse timestamp configuration (like Mongoose)
  const tsConfig: { 
    enabled: boolean;
    createdAt: string | false;
    updatedAt: string | false;
    currentTime: () => Date;
  } = {
    enabled: timestamps !== false,
    createdAt: timestamps === false ? false : 
      (typeof timestamps === 'object' ? (timestamps.createdAt ?? 'createdAt') : 'createdAt'),
    updatedAt: timestamps === false ? false :
      (typeof timestamps === 'object' ? (timestamps.updatedAt ?? 'updatedAt') : 'updatedAt'),
    currentTime: (typeof timestamps === 'object' && timestamps.currentTime) 
      ? timestamps.currentTime 
      : () => new Date(),
  };
  
  // Build projection from excluded fields
  const projection: Record<string, 0> = {};
  for (const field of excludeFields) {
    projection[field] = 0;
  }

  const getCollection = async (context?: DatabaseContext): Promise<Collection<Document>> => {
    // Resolve database instance
    if (!db) {
      if (strategy) {
        const resolvedContext = context || defaultCtx;
        if (resolvedContext) {
          db = await strategy.resolve(resolvedContext);
        } else {
          db = getDatabase(); // Fallback to default
        }
      } else {
        db = getDatabase(); // Fallback to default
      }
    }
    
    if (!collection) {
      collection = db.collection(collectionName);
      if (indexes) {
        for (const idx of indexes) {
          await collection.createIndex(idx.fields, idx.options).catch(() => {});
        }
      }
    }
    return collection;
  };

  // Helper for conditional caching
  const withCache = async <R>(key: string, ttlSeconds: number, fn: () => Promise<R>): Promise<R> => {
    if (!ttl) return fn(); // Caching disabled
    return cached(key, ttlSeconds, fn);
  };

  return {
    // ═══════════════════════════════════════════════════════════════
    // READ Operations - Optimized with lean queries
    // ═══════════════════════════════════════════════════════════════
    
    async findById(id: string, options?: WriteOptions): Promise<T | null> {
      // Skip cache when using session (transactional read)
      if (options?.session) {
        const col = await getCollection(options?.context);
        const doc = await col.findOne(
          { id }, 
          { projection: LEAN_PROJECTION, session: options.session }
        );
        return doc as T | null;
      }
      
      const cacheKey = `${cachePrefix}:id:${id}`;
      
      return withCache(cacheKey, ttl?.single ?? 300, async () => {
        const col = await getCollection(options?.context);
        // Lean query: exclude _id, return raw document
        const doc = await col.findOne(
          { id }, 
          { projection: LEAN_PROJECTION }
        );
        return doc as T | null;
      });
    },

    async findMany(opts: FindManyOptions): Promise<{ items: T[]; total: number }> {
      const { filter = {}, take = 20, sort, fields } = opts;
      const cacheKey = `${cachePrefix}:list:${JSON.stringify({ filter, take, sort, fields })}`;

      return withCache(cacheKey, ttl?.list ?? 60, async () => {
        const col = await getCollection(opts.context);
        const mongoFilter = filter as Filter<Document>;
        
        // Build find options with lean projection
        const findOptions: FindOptions = {
          projection: fields 
            ? { ...LEAN_PROJECTION, ...Object.fromEntries(fields.map(f => [f, 1])) }
            : LEAN_PROJECTION,
          batchSize, // Optimize cursor batch size
        };

        // Use Promise.all for parallel execution
        // Note: For pagination, use cursor-based pagination (paginateCollection) instead
        const [items, total] = await Promise.all([
          col.find(mongoFilter, findOptions)
            .sort(sort || { createdAt: -1 })
            .limit(take)
            .toArray(),
          // Use estimatedDocumentCount when no filter (much faster)
          Object.keys(filter).length === 0
            ? col.estimatedDocumentCount()
            : col.countDocuments(mongoFilter),
        ]);

        return { items: items as unknown as T[], total };
      });
    },

    // Optimized: Find one by any field (lean)
    async findOne(filter: Partial<T>, options?: WriteOptions): Promise<T | null> {
      const col = await getCollection(options?.context);
      const doc = await col.findOne(
        filter as Filter<Document>,
        { projection: LEAN_PROJECTION, session: options?.session }
      );
      return doc as T | null;
    },

    // Optimized: Check existence without fetching data
    async exists(filter: Partial<T>, options?: WriteOptions): Promise<boolean> {
      const col = await getCollection(options?.context);
      // Use projection to fetch minimal data
      const doc = await col.findOne(
        filter as Filter<Document>,
        { projection: { id: 1 }, session: options?.session }
      );
      return doc !== null;
    },

    // Optimized: Count with caching
    async count(filter: Partial<T> = {}, options?: WriteOptions): Promise<number> {
      const cacheKey = `${cachePrefix}:count:${JSON.stringify(filter)}`;
      
      return withCache(cacheKey, ttl?.count ?? 30, async () => {
        const col = await getCollection(options?.context);
        // Use estimatedDocumentCount when no filter (instant, uses metadata)
        if (Object.keys(filter).length === 0) {
          return col.estimatedDocumentCount();
        }
        return col.countDocuments(filter as Filter<Document>);
      });
    },

    // ═══════════════════════════════════════════════════════════════
    // WRITE Operations (with cache invalidation and session support)
    // ═══════════════════════════════════════════════════════════════

    async create(entity: T, options?: WriteOptions): Promise<T> {
      const col = await getCollection(options?.context);
      // Remove id if present - we'll generate it using MongoDB ObjectId
      const { id, ...entityWithoutId } = entity as any;
      
      // Generate MongoDB ObjectId for performant single-insert operation
      const { objectId, idString } = generateMongoId();
      
      let doc = {
        _id: objectId,
        id: idString,
        ...entityWithoutId,
      };
      
      // Apply timestamps (like Mongoose) unless skipped
      if (tsConfig.enabled && !options?.skipTimestamps) {
        const now = tsConfig.currentTime();
        if (tsConfig.createdAt && !(entity as any)[tsConfig.createdAt]) {
          (doc as any)[tsConfig.createdAt] = now;
        }
        if (tsConfig.updatedAt) {
          (doc as any)[tsConfig.updatedAt] = now;
        }
      }
      
      // Single insert operation - much more performant than insert + update
      await col.insertOne(doc as unknown as Document, { session: options?.session });
      
      // Invalidate list and count caches (skip during transaction - will be invalidated on commit)
      if (!options?.session) {
        deleteCachePattern(`${cachePrefix}:list:*`);
        deleteCachePattern(`${cachePrefix}:count:*`);
      }
      
      return doc as T;
    },

    async update(id: string, data: Partial<T>, options?: WriteOptions): Promise<T | null> {
      const col = await getCollection(options?.context);
      
      // Prepare update data with optional timestamp
      let updateData = { ...data };
      if (tsConfig.enabled && tsConfig.updatedAt && !options?.skipTimestamps) {
        (updateData as any)[tsConfig.updatedAt] = tsConfig.currentTime();
      }
      
      const result = await col.findOneAndUpdate(
        { id },
        { $set: updateData },
        { 
          returnDocument: 'after',
          projection: LEAN_PROJECTION, // Lean return
          session: options?.session,
        }
      );

      if (result && !options?.session) {
        // Invalidate caches (skip during transaction)
        deleteCache(`${cachePrefix}:id:${id}`);
        deleteCachePattern(`${cachePrefix}:list:*`);
      }

      return result as T | null;
    },

    async delete(id: string, options?: WriteOptions): Promise<boolean> {
      const col = await getCollection(options?.context);
      const result = await col.deleteOne({ id }, { session: options?.session });
      
      if (result.deletedCount > 0 && !options?.session) {
        // Invalidate caches (skip during transaction)
        deleteCache(`${cachePrefix}:id:${id}`);
        deleteCachePattern(`${cachePrefix}:list:*`);
        deleteCachePattern(`${cachePrefix}:count:*`);
      }

      return result.deletedCount > 0;
    },

    // ═══════════════════════════════════════════════════════════════
    // Batch Operations (optimized)
    // ═══════════════════════════════════════════════════════════════

    async findByIds(ids: string[], options?: WriteOptions): Promise<T[]> {
      if (ids.length === 0) return [];
      
      const col = await getCollection(options?.context);
      const docs = await col.find(
        { id: { $in: ids } },
        { projection: LEAN_PROJECTION, batchSize }
      ).toArray();
      
      return docs as unknown as T[];
    },

    // ═══════════════════════════════════════════════════════════════
    // Cursor-Based Pagination (O(1) performance, consistent for any page)
    // ═══════════════════════════════════════════════════════════════

    async paginate(opts: CursorPaginationOptions): Promise<CursorPaginationResult<T>> {
      const {
        first = 20,
        after,
        last,
        before,
        filter = {},
        sortField = 'createdAt',
        sortDirection = 'desc',
        fields,
      } = opts;

      const col = await getCollection(opts.context);
      const limit = last ?? first;
      const isBackward = !!last || !!before;
      
      // Build cursor filter
      const cursorFilter: Record<string, unknown> = { ...filter };
      const sortDir = sortDirection === 'asc' ? 1 : -1;
      const effectiveDir = isBackward ? -sortDir : sortDir;
      
      // Decode cursor and add range condition
      if (after) {
        const decoded = decodeCursor(after);
        cursorFilter[sortField] = sortDir === 1 
          ? { $gt: decoded.value }
          : { $lt: decoded.value };
      } else if (before) {
        const decoded = decodeCursor(before);
        cursorFilter[sortField] = sortDir === 1
          ? { $lt: decoded.value }
          : { $gt: decoded.value };
      }

      // Build find options
      const findOptions: FindOptions = {
        projection: fields 
          ? { ...LEAN_PROJECTION, ...Object.fromEntries(fields.map(f => [f, 1])), [sortField]: 1 }
          : LEAN_PROJECTION,
        batchSize,
      };

      // Fetch limit + 1 to determine if there are more pages
      const sortSpec = { [sortField]: effectiveDir } as Record<string, 1 | -1>;
      const [docs, totalCount] = await Promise.all([
        col.find(cursorFilter as Filter<Document>, findOptions)
          .sort(sortSpec)
          .limit(limit + 1)
          .toArray(),
        Object.keys(filter).length === 0
          ? col.estimatedDocumentCount()
          : col.countDocuments(filter as Filter<Document>),
      ]);

      // Check if there are more items
      const hasMore = docs.length > limit;
      if (hasMore) docs.pop(); // Remove the extra item

      // Reverse if backward pagination
      if (isBackward) docs.reverse();

      // Build edges with cursors
      const edges = docs.map(doc => ({
        node: doc as unknown as T,
        cursor: encodeCursor(sortField, (doc as Record<string, unknown>)[sortField]),
      }));

      // Determine page info
      const hasNextPage = isBackward ? !!before : hasMore;
      const hasPreviousPage = isBackward ? hasMore : !!after;

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage,
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges[edges.length - 1]?.cursor ?? null,
        },
        totalCount,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cursor Encoding/Decoding (base64 for opaque cursors)
// ═══════════════════════════════════════════════════════════════════

function encodeCursor(field: string, value: unknown): string {
  const data = JSON.stringify({ f: field, v: value });
  return Buffer.from(data).toString('base64url');
}

function decodeCursor(cursor: string): { field: string; value: unknown } {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { field: data.f, value: data.v };
  } catch {
    throw new Error('Invalid cursor');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Bulk Operations (for high-volume scenarios)
// ═══════════════════════════════════════════════════════════════════

export async function bulkInsert<T extends { id: string }>(
  collectionName: string,
  entities: T[],
  options?: { ordered?: boolean }
): Promise<number> {
  if (entities.length === 0) return 0;
  
  const col = getDatabase().collection(collectionName);
  const now = new Date();
  const docs = entities.map(e => ({ ...e, createdAt: now, updatedAt: now }));
  
  // Use unordered for parallel inserts (faster)
  const result = await col.insertMany(docs as unknown as Document[], {
    ordered: options?.ordered ?? false,
  });
  
  // Invalidate list caches
  deleteCachePattern(`${collectionName}:list:*`);
  deleteCachePattern(`${collectionName}:count:*`);
  
  logger.info('Bulk insert completed', { 
    collection: collectionName, 
    count: result.insertedCount 
  });
  
  return result.insertedCount;
}

export async function bulkUpdate<T extends { id: string }>(
  collectionName: string,
  updates: { id: string; data: Partial<T> }[],
  options?: { ordered?: boolean }
): Promise<number> {
  if (updates.length === 0) return 0;
  
  const col = getDatabase().collection(collectionName);
  const now = new Date();
  
  const bulkOps = updates.map(({ id, data }) => ({
    updateOne: {
      filter: { id },
      update: { $set: { ...data, updatedAt: now } },
    },
  }));
  
  // Use unordered for parallel updates (faster)
  const result = await col.bulkWrite(bulkOps, {
    ordered: options?.ordered ?? false,
  });
  
  // Invalidate all caches for this collection
  deleteCachePattern(`${collectionName}:*`);
  
  logger.info('Bulk update completed', { 
    collection: collectionName, 
    modified: result.modifiedCount 
  });
  
  return result.modifiedCount;
}

// ═══════════════════════════════════════════════════════════════════
// Aggregation Helper (for complex queries)
// ═══════════════════════════════════════════════════════════════════

export async function aggregate<T>(
  collectionName: string,
  pipeline: Document[],
  options?: { batchSize?: number }
): Promise<T[]> {
  const col = getDatabase().collection(collectionName);
  const results = await col.aggregate(pipeline, { 
    batchSize: options?.batchSize ?? 100 
  }).toArray();
  return results as unknown as T[];
}
