/**
 * MongoDB Error Handling Utilities
 * 
 * Centralized error handling for MongoDB operations, optimized for sharding
 * and race condition scenarios (duplicate key errors, etc.)
 */

import type { Collection, Filter, Document } from 'mongodb';
import { logger } from './logger.js';

export interface DuplicateKeyErrorOptions {
  /** Field to query for existing document (e.g., 'externalRef') */
  lookupField: string;
  /** Value to lookup */
  lookupValue: string;
  /** Additional filter conditions for lookup */
  additionalFilter?: Record<string, unknown>;
  /** Maximum retry attempts (default: 2) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 100ms, increases exponentially) */
  retryDelay?: number;
  /** Projection for lookup query (optimize for performance) */
  projection?: Record<string, 1 | 0>;
}

/**
 * Check if error is a MongoDB duplicate key error (E11000)
 * Handles various error formats for compatibility
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  
  const err = error as any;
  
  // Standard MongoDB duplicate key error codes
  if (err.code === 11000 || err.code === 11001) return true;
  if (err.codeName === 'DuplicateKey') return true;
  
  // Check error message
  const message = err.message || String(err);
  if (typeof message === 'string') {
    if (message.includes('duplicate key') || 
        message.includes('E11000') ||
        message.includes('E11001')) {
      return true;
    }
  }
  
  // Check error name
  const name = err.name || '';
  if (name === 'MongoServerError' && message?.includes('E11000')) {
    return true;
  }
  
  return false;
}

/**
 * Handle duplicate key error by fetching existing document
 * Optimized for sharding: uses direct queries with minimal projection
 * 
 * This is useful for idempotent operations where duplicate key errors
 * indicate a race condition and we should return the existing document.
 * 
 * @example
 * try {
 *   await collection.insertOne(doc);
 * } catch (error) {
 *   if (isDuplicateKeyError(error)) {
 *     const existing = await handleDuplicateKeyError(
 *       collection,
 *       error,
 *       { lookupField: 'externalRef', lookupValue: doc.externalRef }
 *     );
 *     if (existing) return existing;
 *   }
 *   throw error;
 * }
 */
export async function handleDuplicateKeyError<T = Document>(
  collection: Collection,
  error: unknown,
  options: DuplicateKeyErrorOptions
): Promise<T | null> {
  if (!isDuplicateKeyError(error)) {
    return null;
  }
  
  const {
    lookupField,
    lookupValue,
    additionalFilter = {},
    maxRetries = 2,
    retryDelay = 100,
    projection = { _id: 1 },
  } = options;
  
  // Build query with minimal projection for performance (sharding-friendly)
  const query: Filter<any> = {
    [lookupField]: lookupValue,
    ...additionalFilter,
  };
  
  // Try immediate lookup (most common case - document was just inserted)
  let existing = await collection.findOne(query, { projection }) as T | null;
  if (existing) {
    logger.debug('Duplicate key resolved: found existing document', {
      collection: collection.collectionName,
      lookupField,
      lookupValue,
    });
    return existing;
  }
  
  // Retry with exponential backoff (for eventual consistency in sharded clusters)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
    await new Promise(resolve => setTimeout(resolve, delay));
    
    existing = await collection.findOne(query, { projection }) as T | null;
    if (existing) {
      logger.info('Duplicate key resolved after retry', {
        collection: collection.collectionName,
        lookupField,
        lookupValue,
        attempt,
        delay,
      });
      return existing;
    }
  }
  
  // Document not found after retries (shouldn't happen, but handle gracefully)
  logger.warn('Duplicate key error but document not found after retries', {
    collection: collection.collectionName,
    lookupField,
    lookupValue,
    maxRetries,
  });
  
  return null;
}

/**
 * Execute operation with automatic duplicate key error handling
 * Wraps insert/update operations to handle race conditions gracefully
 * 
 * @example
 * const result = await executeWithDuplicateHandling(
 *   () => collection.insertOne(doc),
 *   collection,
 *   { lookupField: 'externalRef', lookupValue: doc.externalRef }
 * );
 */
export async function executeWithDuplicateHandling<T>(
  operation: () => Promise<T>,
  collection: Collection,
  options: DuplicateKeyErrorOptions
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await handleDuplicateKeyError(collection, error, options);
      if (existing) {
        // Return existing document as if operation succeeded (idempotent)
        return existing as unknown as T;
      }
    }
    // Re-throw if not duplicate key or document not found
    throw error;
  }
}
