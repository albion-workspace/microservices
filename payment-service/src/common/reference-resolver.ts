/**
 * Generic Reference Resolver.
 * 
 * Inspired by Mongoose's refPath/populate, but optimized for:
 * - MongoDB driver (no Mongoose overhead)
 * - UUIDs (not ObjectIds)
 * - Microservices (cross-service references)
 * 
 * DATABASE ACCESS PATTERN:
 * - Uses db.getClient().db(CORE_DATABASE_NAME) to access other service databases
 * - Uses service database accessor (db.getDb()) for same-service database access
 */

import { logger, findOneById, CORE_DATABASE_NAME } from 'core-service';
import { db } from '../database.js';

/**
 * Collection mapping for reference types
 * Add new entity types here as your system grows
 */
const COLLECTION_MAP: Record<string, string> = {
  // Bonuses
  'bonus': 'bonuses',
  
  // Gaming
  'bet': 'bets',
  'game': 'game_rounds',
  'jackpot': 'jackpots',
  
  // Payments
  'transaction': 'deposits',  // Could also be 'withdrawals'
  'deposit': 'deposits',
  'withdrawal': 'withdrawals',
  
  // Marketing
  'promotion': 'promotions',
  'promo': 'promotions',
  'campaign': 'campaigns',
  
  // Users
  'user': 'users',
  'player': 'users',
};

/**
 * Resolve a single reference
 * Like Mongoose populate but for MongoDB driver + UUIDs
 * 
 * @example
 * const tx = await txRepo.findById('tx-id');
 * const bonus = await resolveReference(tx.refId, tx.refType);
 */
export async function resolveReference(
  refId: string | undefined | null,
  refType: string | undefined | null
): Promise<any | null> {
  if (!refId || !refType) return null;
  
  // CRITICAL: User references must come from core_service database, not payment_service
  // All other references come from payment_service database
  if (refType === 'user' || refType === 'player') {
    try {
      const client = db.getClient();
      const coreDb = client.db(CORE_DATABASE_NAME);
      const usersCollection = coreDb.collection('users');
      // Use optimized findOneById utility (performance-optimized)
      const doc = await findOneById(usersCollection, refId, {});
      if (doc) {
        // Remove _id from projection
        const { _id, ...rest } = doc as any;
        return rest;
      }
      return null;
    } catch (error) {
      logger.error(`Failed to resolve user reference ${refId} from ${CORE_DATABASE_NAME}`, { error });
      return null;
    }
  }
  
  // All other references come from payment_service database
  const database = await db.getDb();
  const collectionName = COLLECTION_MAP[refType] || refType;
  const collection = database.collection(collectionName);
  
  try {
    // Use optimized findOneById utility (performance-optimized)
    const doc = await findOneById(collection, refId, {});
    if (doc) {
      // Remove _id from projection
      const { _id, ...rest } = doc as any;
      return rest;
    }
    return null;
  } catch (error) {
    logger.error(`Failed to resolve reference ${refType}:${refId}`, { error });
    return null;
  }
}

/**
 * Resolve multiple references in parallel
 * 
 * @example
 * const transactions = await txRepo.findMany({ userId: 'user-123' });
 * const populated = await resolveReferences(transactions, 'refId', 'refType');
 */
export async function resolveReferences<T extends Record<string, any>>(
  documents: T[],
  refIdField: keyof T = 'refId',
  refTypeField: keyof T = 'refType'
): Promise<(T & { _ref?: any })[]> {
  if (!documents.length) return [];
  
  // Resolve all references in parallel
  const results = await Promise.all(
    documents.map(async (doc) => {
      const ref = await resolveReference(
        doc[refIdField] as string,
        doc[refTypeField] as string
      );
      return { ...doc, _ref: ref };
    })
  );
  
  return results;
}

/**
 * Batch resolve references by type for efficiency
 * Groups by refType and fetches in batches
 * 
 * @example
 * const transactions = await txRepo.findMany({ userId: 'user-123' });
 * const populated = await batchResolveReferences(transactions);
 */
export async function batchResolveReferences<T extends Record<string, any>>(
  documents: T[],
  refIdField: keyof T = 'refId',
  refTypeField: keyof T = 'refType'
): Promise<(T & { _ref?: any })[]> {
  if (!documents.length) return [];
  
  const database = await db.getDb();
  
  // Group by refType
  const grouped = new Map<string, Array<{ doc: T; refId: string }>>();
  
  for (const doc of documents) {
    const refType = doc[refTypeField] as string;
    const refId = doc[refIdField] as string;
    
    if (!refType || !refId) continue;
    
    if (!grouped.has(refType)) {
      grouped.set(refType, []);
    }
    grouped.get(refType)!.push({ doc, refId });
  }
  
  // Fetch each type in batch
  const refCache = new Map<string, any>();
  
  for (const [refType, items] of grouped.entries()) {
    const ids = items.map(item => item.refId);
    
    try {
      let refs: any[] = [];
      
      // CRITICAL: User references must come from core_service database
      if (refType === 'user' || refType === 'player') {
        const client = db.getClient();
        const coreDb = client.db(CORE_DATABASE_NAME);
        const usersCollection = coreDb.collection('users');
        // Batch lookup: use $in query (efficient for multiple IDs)
        const docs = await usersCollection
          .find({ id: { $in: ids } }, { projection: { _id: 0 } })
          .toArray();
        refs = docs;
      } else {
        // All other references come from payment_service database
        const collectionName = COLLECTION_MAP[refType] || refType;
        const collection = database.collection(collectionName);
        // Batch lookup: use $in query (efficient for multiple IDs)
        const docs = await collection
          .find({ id: { $in: ids } }, { projection: { _id: 0 } })
          .toArray();
        refs = docs;
      }
      
      // Cache by ID
      for (const ref of refs) {
        refCache.set(`${refType}:${ref.id}`, ref);
      }
    } catch (err) {
      logger.error(`Failed to batch resolve ${refType} references`, { error: err });
    }
  }
  
  // Attach refs to docs
  return documents.map(doc => {
    const refType = doc[refTypeField] as string;
    const refId = doc[refIdField] as string;
    const key = `${refType}:${refId}`;
    
    return {
      ...doc,
      _ref: refCache.get(key) || null
    };
  });
}

/**
 * Check if a reference exists (efficient)
 * 
 * @example
 * const exists = await referenceExists('bonus-123', 'bonus');
 */
export async function referenceExists(
  refId: string,
  refType: string
): Promise<boolean> {
  if (!refId || !refType) return false;
  
  try {
    // CRITICAL: User references must come from core_service database
    if (refType === 'user' || refType === 'player') {
      const client = db.getClient();
      const coreDb = client.db(CORE_DATABASE_NAME);
      const usersCollection = coreDb.collection('users');
      // Use optimized findOneById utility (performance-optimized)
      const doc = await findOneById(usersCollection, refId, {});
      return doc !== null;
    }
    
    // All other references come from payment_service database
    const database = await db.getDb();
    const collectionName = COLLECTION_MAP[refType] || refType;
    const collection = database.collection(collectionName);
    // Use optimized findOneById utility (performance-optimized)
    const doc = await findOneById(collection, refId, {});
    return doc !== null;
  } catch {
    return false;
  }
}

/**
 * Validate references before creating a transaction
 * 
 * @example
 * await validateReference('bonus-123', 'bonus'); // throws if not found
 */
export async function validateReference(
  refId: string,
  refType: string
): Promise<void> {
  const exists = await referenceExists(refId, refType);
  if (!exists) {
    throw new Error(`Reference not found: ${refType}:${refId}`);
  }
}

/**
 * Register a new reference type dynamically
 * Useful for plugins/extensions
 * 
 * @example
 * registerReferenceType('tournament', 'tournaments');
 */
export function registerReferenceType(
  refType: string,
  collectionName: string
): void {
  COLLECTION_MAP[refType] = collectionName;
}

/**
 * Get all registered reference types
 */
export function getRegisteredReferenceTypes(): string[] {
  return Object.keys(COLLECTION_MAP);
}
