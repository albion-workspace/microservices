/**
 * Pagination Utilities
 * 
 * Cursor-based pagination helpers for MongoDB queries
 * Optimized for performance and sharding compatibility
 */

import type { Collection, Filter, Document, FindOptions } from 'mongodb';
import { logger } from './logger.js';

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
  totalCount?: number;
}

/**
 * Encode cursor from field and value
 */
function encodeCursor(field: string, value: unknown): string {
  const data = JSON.stringify({ f: field, v: value });
  return Buffer.from(data).toString('base64url');
}

/**
 * Decode cursor to field and value
 */
function decodeCursor(cursor: string): { field: string; value: unknown } {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { field: data.f, value: data.v };
  } catch {
    throw new Error('Invalid cursor');
  }
}

/**
 * Paginate a MongoDB collection using cursor-based pagination
 * 
 * PERFORMANCE BENEFITS:
 * - O(1) performance regardless of page number (offset pagination is O(n))
 * - Works efficiently with sharded collections
 * - Consistent results even when data changes during pagination
 * 
 * @example
 * const result = await paginateCollection(
 *   db.collection('users'),
 *   { first: 20, after: cursor, filter: { tenantId: 'default' } }
 * );
 */
export async function paginateCollection<T = Document>(
  collection: Collection,
  options: CursorPaginationOptions
): Promise<CursorPaginationResult<T>> {
  const {
    first = 20,
    after,
    last,
    before,
    filter = {},
    sortField = 'createdAt',
    sortDirection = 'desc',
    fields,
  } = options;

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

  // Build find options with projection for performance
  const findOptions: FindOptions = {};
  if (fields) {
    findOptions.projection = Object.fromEntries(
      fields.map(f => [f, 1])
    );
    // Always include sortField for cursor generation
    findOptions.projection[sortField] = 1;
  }

  // Fetch limit + 1 to determine if there are more pages
  const sortSpec = { [sortField]: effectiveDir } as Record<string, 1 | -1>;
  const docs = await collection
    .find(cursorFilter as Filter<Document>, findOptions)
    .sort(sortSpec)
    .limit(limit + 1)
    .toArray();

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

  // Optional: Get total count (can be expensive, skip if not needed)
  let totalCount: number | undefined;
  if (Object.keys(filter).length === 0) {
    // Only count if no filters (faster)
    totalCount = await collection.estimatedDocumentCount();
  } else {
    // With filters, countDocuments is more accurate but slower
    // Skip by default for performance - can be enabled if needed
    totalCount = undefined;
  }

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
}

/**
 * Convert offset-based pagination to cursor-based
 * Helper for migrating existing code
 */
export function convertOffsetToCursor(
  offset: number,
  limit: number,
  sortField: string = 'createdAt',
  sortDirection: 'asc' | 'desc' = 'desc'
): { first: number; after?: string } {
  // For offset-based, we can't generate a cursor without fetching data
  // This is a placeholder - actual migration requires fetching the item at offset
  return {
    first: limit,
    // Note: after cursor would need to be generated from the item at (offset - 1)
  };
}
