/**
 * MongoDB Utilities
 * 
 * Generic MongoDB helper functions for ObjectId handling, queries, and document lookups.
 * Since core-service already depends on MongoDB, these utilities centralize common patterns
 * and allow other services to use MongoDB without directly depending on it.
 * 
 * All functions are generic and work with any MongoDB collection, not just users.
 */

import { ObjectId, type Collection, type Filter, type Document } from 'mongodb';
import { logger } from './logger.js';

// Re-export MongoDB types for convenience
export { ObjectId } from 'mongodb';
export type { Collection, Filter, Document, ClientSession } from 'mongodb';

// ═══════════════════════════════════════════════════════════════════
// ObjectId Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a string is a valid MongoDB ObjectId
 */
export function isValidObjectId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return ObjectId.isValid(id);
}

/**
 * Convert string to ObjectId if valid, otherwise return null
 */
export function toObjectId(id: string | null | undefined): ObjectId | null {
  if (!isValidObjectId(id)) return null;
  try {
    return new ObjectId(id!);
  } catch {
    return null;
  }
}

/**
 * Convert ObjectId to string, handling both ObjectId and string inputs
 */
export function objectIdToString(id: ObjectId | string | null | undefined): string | null {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id instanceof ObjectId) return id.toString();
  return null;
}

/**
 * Generate a new MongoDB ObjectId and return both the ObjectId and its string representation.
 * Use this for performant inserts - set both _id and id fields in a single operation.
 * 
 * @returns Object with both ObjectId instance and string representation
 * @example
 * const { objectId, idString } = generateMongoId();
 * await collection.insertOne({ _id: objectId, id: idString, ...otherFields });
 */
export function generateMongoId(): { objectId: ObjectId; idString: string } {
  const objectId = new ObjectId();
  return {
    objectId,
    idString: objectId.toString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Query Building Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a MongoDB query that handles both _id (ObjectId) and id (string) fields
 * Tries ObjectId first (most reliable), then falls back to string/id field
 * Generic version that works with any document, not just users
 * 
 * @example
 * const query = buildIdQuery('507f1f77bcf86cd799439011', { tenantId: 'default-tenant' });
 * // Returns: { _id: ObjectId(...), tenantId: 'default-tenant' } or { $or: [...], tenantId: 'default-tenant' }
 */
export function buildIdQuery(
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Filter<any> {
  const query: Filter<any> = { ...additionalFields };
  
  if (!id) {
    return query;
  }
  
  // Try ObjectId first (most reliable)
  const objectId = toObjectId(id);
  if (objectId) {
    query._id = objectId;
  } else {
    // Fallback: try both id field and _id as string
    query.$or = [
      { id },
      { _id: id as any }, // MongoDB driver may auto-convert
    ];
  }
  
  return query;
}

/**
 * Build a MongoDB query that handles both _id (ObjectId) and id (string) fields
 * Always uses $or for maximum compatibility (useful when you need to match either field)
 * 
 * @example
 * const query = buildIdQueryWithOr('507f1f77bcf86cd799439011', { tenantId: 'default-tenant' });
 * // Returns: { $or: [{ _id: ObjectId(...) }, { id: '507f1f77bcf86cd799439011' }], tenantId: 'default-tenant' }
 */
export function buildIdQueryWithOr(
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Filter<any> {
  const query: Filter<any> = { ...additionalFields };
  
  if (!id) {
    return query;
  }
  
  // Try ObjectId first (most reliable)
  const objectId = toObjectId(id);
  if (objectId) {
    query.$or = [
      { _id: objectId },
      { id },
    ];
  } else {
    // Not a valid ObjectId, try id field and _id as string
    query.$or = [
      { id },
      { _id: id as any }, // MongoDB driver may auto-convert
    ];
  }
  
  return query;
}


// ═══════════════════════════════════════════════════════════════════
// Document Lookup Utilities (Generic)
// ═══════════════════════════════════════════════════════════════════

/**
 * Find a document by ID with automatic fallback handling
 * Tries ObjectId first, then id field, then _id as string
 * Generic function that works with any collection
 * 
 * @example
 * const user = await findById(usersCollection, '507f1f77bcf86cd799439011', { tenantId: 'default-tenant' });
 * const transaction = await findById(transactionsCollection, 'tx-123', { status: 'pending' });
 */
export async function findById<T = Document>(
  collection: Collection,
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Promise<T | null> {
  if (!id) return null;
  
  const objectId = toObjectId(id);
  
  // Try ObjectId first (most reliable)
  if (objectId) {
    try {
      const query: Filter<any> = { _id: objectId, ...additionalFields };
      
      const doc = await collection.findOne(query);
      if (doc) {
        logger.debug('Document found by _id (ObjectId)', { id, collection: collection.collectionName });
        return doc as T;
      }
    } catch (error) {
      logger.debug('ObjectId lookup failed, trying fallback', { id, error, collection: collection.collectionName });
    }
  }
  
  // Fallback: Try id field or _id as string
  const query = buildIdQueryWithOr(id, additionalFields);
  const doc = await collection.findOne(query);
  
  if (doc) {
    logger.debug('Document found by fallback query', { id, collection: collection.collectionName });
  }
  
  return doc as T | null;
}

/**
 * Find a document by ID (alias for findById for backward compatibility)
 * @deprecated Use findById instead
 */
export async function findUserById<T = any>(
  collection: Collection,
  userId: string | null | undefined,
  tenantId?: string
): Promise<T | null> {
  const additionalFields = tenantId ? { tenantId } : {};
  return findById<T>(collection, userId, additionalFields);
}

/**
 * Extract document ID from a MongoDB document
 * Returns id field if present, otherwise converts _id to string
 * Returns null if neither id nor _id is present
 * 
 * @example
 * const docId = extractDocumentId(document); // Returns string | null
 * if (docId) {
 *   // Use docId
 * }
 */
export function extractDocumentId<T extends { _id?: any; id?: string }>(doc: T | null | undefined): string | null {
  if (!doc) return null;
  
  if (doc.id) {
    return doc.id;
  }
  
  if (doc._id) {
    return objectIdToString(doc._id) || null;
  }
  
  return null;
}

/**
 * Normalize a MongoDB document: ensure id field exists from _id
 * Handles both ObjectId and string formats
 */
export function normalizeDocument<T extends { _id?: any; id?: string }>(doc: T | null): T | null {
  if (!doc) return null;
  
  // If _id exists but id doesn't, set id from _id
  if (doc._id && !doc.id) {
    doc.id = objectIdToString(doc._id) || undefined;
  }
  
  return doc;
}

/**
 * Normalize multiple documents
 */
export function normalizeDocuments<T extends { _id?: any; id?: string }>(docs: T[]): T[] {
  return docs.map(doc => normalizeDocument(doc)!).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════
// Update Query Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an update query that handles both _id and id fields
 * Returns the query to use with findOneAndUpdate, updateOne, etc.
 * Generic version that works with any document
 * PERFORMANCE: Prefers direct ObjectId query (most efficient) over $or when possible
 * 
 * @example
 * const query = buildUpdateQuery('507f1f77bcf86cd799439011', { tenantId: 'default-tenant' });
 * await collection.updateOne(query, { $set: { status: 'active' } });
 */
export function buildUpdateQuery(
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Filter<any> {
  // PERFORMANCE: Use direct ObjectId query when valid (most efficient, uses index)
  const objectId = toObjectId(id);
  
  if (objectId) {
    return { _id: objectId, ...additionalFields };
  }
  
  // Fallback: use buildIdQuery (which also prefers direct queries when possible)
  return buildIdQuery(id, additionalFields);
}

// ═══════════════════════════════════════════════════════════════════
// Common Operation Utilities (Performance-Optimized)
// ═══════════════════════════════════════════════════════════════════

/**
 * Find one document by ID with automatic ObjectId handling
 * PERFORMANCE: Uses direct ObjectId query when valid (most efficient)
 * 
 * @example
 * const user = await findOneById(usersCollection, userId, { tenantId });
 */
export async function findOneById<T = Document>(
  collection: Collection,
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Promise<T | null> {
  if (!id) return null;
  
  // PERFORMANCE: Use direct ObjectId query when valid (uses index, fastest)
  const objectId = toObjectId(id);
  if (objectId) {
    const query: Filter<any> = { _id: objectId, ...additionalFields };
    return (await collection.findOne(query)) as T | null;
  }
  
  // Fallback: use buildIdQuery (prefers direct queries)
  const query = buildIdQuery(id, additionalFields);
  return (await collection.findOne(query)) as T | null;
}

/**
 * Update one document by ID with automatic ObjectId handling
 * PERFORMANCE: Uses direct ObjectId query when valid (most efficient)
 * 
 * @example
 * const result = await updateOneById(
 *   usersCollection, 
 *   userId, 
 *   { $set: { status: 'active' } },
 *   { tenantId }
 * );
 */
export async function updateOneById(
  collection: Collection,
  id: string | null | undefined,
  update: Record<string, unknown>,
  additionalFields: Record<string, unknown> = {}
): Promise<{ matchedCount: number; modifiedCount: number }> {
  if (!id) {
    return { matchedCount: 0, modifiedCount: 0 };
  }
  
  const query = buildUpdateQuery(id, additionalFields);
  const result = await collection.updateOne(query, update);
  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

/**
 * Delete one document by ID with automatic ObjectId handling
 * PERFORMANCE: Uses direct ObjectId query when valid (most efficient)
 * 
 * @example
 * const result = await deleteOneById(usersCollection, userId, { tenantId });
 */
export async function deleteOneById(
  collection: Collection,
  id: string | null | undefined,
  additionalFields: Record<string, unknown> = {}
): Promise<boolean> {
  if (!id) return false;
  
  const query = buildUpdateQuery(id, additionalFields);
  const result = await collection.deleteOne(query);
  return result.deletedCount > 0;
}

/**
 * Find one and update document by ID with automatic ObjectId handling
 * PERFORMANCE: Uses direct ObjectId query when valid (most efficient)
 * 
 * @example
 * const result = await findOneAndUpdateById(
 *   usersCollection,
 *   userId,
 *   { $set: { status: 'active' } },
 *   { tenantId },
 *   { returnDocument: 'after' }
 * );
 */
export async function findOneAndUpdateById<T = Document>(
  collection: Collection,
  id: string | null | undefined,
  update: Record<string, unknown>,
  additionalFields: Record<string, unknown> = {},
  options: { returnDocument?: 'before' | 'after' } = {}
): Promise<T | null> {
  if (!id) return null;
  
  const query = buildUpdateQuery(id, additionalFields);
  const result = await collection.findOneAndUpdate(
    query,
    update,
    { returnDocument: options.returnDocument || 'after' }
  );
  
  return (result?.value as T) || null;
}
