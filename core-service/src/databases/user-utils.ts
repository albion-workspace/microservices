/**
 * User Utilities
 * 
 * Generic utilities for querying users across services.
 * Supports role-based user lookup for flexible system user management.
 */

import type { MongoClient, Db, Document } from 'mongodb';
import { logger } from '../common/logger.js';
import { getErrorMessage } from '../common/errors.js';
import { CORE_DATABASE_NAME } from './core-database.js';
import type { DatabaseStrategyResolver, DatabaseContext } from './strategy.js';

export interface FindUserByRoleOptions {
  /** Role to search for (e.g., 'system', 'payment-provider') */
  role: string;
  /** Optional tenant ID to filter by */
  tenantId?: string;
  /** Database name (defaults to 'core_service') */
  database?: string;
  /** Whether to throw an error if no user is found (default: true) */
  throwIfNotFound?: boolean;
  /** MongoDB client (for direct database access) */
  client?: MongoClient;
  /** Database instance (for direct database access) */
  databaseInstance?: Db;
  /** Database strategy resolver */
  databaseStrategy?: DatabaseStrategyResolver;
  /** Database context for strategy resolution */
  context?: DatabaseContext;
}

// ═══════════════════════════════════════════════════════════════════
// Internal Helper - Shared logic for user queries
// ═══════════════════════════════════════════════════════════════════

interface InternalFindOptions extends FindUserByRoleOptions {
  findOne: boolean;
}

/**
 * Internal function that handles both single and multiple user queries
 * Eliminates code duplication between findUserIdByRole and findUserIdsByRole
 */
async function findUsersByRoleInternal(options: InternalFindOptions): Promise<string[]> {
  const {
    role,
    tenantId,
    database = CORE_DATABASE_NAME,
    throwIfNotFound = true,
    findOne,
  } = options;

  try {
    // Resolve MongoDB client
    const client = resolveMongoClient(options);
    const authDb = client.db(database);
    const usersCollection = authDb.collection('users');

    // Build query: find user(s) with the specified role
    // Handle both UserRole[] objects and string[] arrays
    const query = buildRoleQuery(role, tenantId);

    logger.debug(`Finding user${findOne ? '' : 's'} by role`, { role, tenantId, database });

    // Execute query based on mode
    const users = findOne
      ? await usersCollection.findOne(query).then(user => user ? [user] : [])
      : await usersCollection.find(query).toArray();

    // Extract user IDs
    const userIds = users
      .map(user => extractUserId(user))
      .filter((id): id is string => Boolean(id));

    // Handle empty results
    if (userIds.length === 0) {
      const errorMsg = `No user found with role "${role}"${tenantId ? ` for tenant "${tenantId}"` : ''}`;
      
      if (throwIfNotFound && findOne) {
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      logger.warn(errorMsg);
    } else {
      logger.debug(`User${findOne ? '' : 's'} found by role`, { 
        count: userIds.length, 
        role, 
        tenantId,
        ...(findOne && users[0] ? { email: (users[0] as Document).email } : {}),
      });
    }

    return userIds;
  } catch (error) {
    logger.error(`Error finding user${findOne ? '' : 's'} by role`, { 
      role, 
      tenantId, 
      error: getErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Resolve MongoDB client from options
 */
function resolveMongoClient(options: FindUserByRoleOptions): MongoClient {
  if (options.client) {
    return options.client;
  }
  
  if (options.databaseStrategy && options.context) {
    // Note: This is synchronous access to the client from strategy
    // The caller should ensure the strategy is initialized
    throw new Error('findUserIdByRole requires client option when using databaseStrategy');
  }
  
  throw new Error('findUserIdByRole requires either client or databaseStrategy with context');
}

/**
 * Build MongoDB query for role matching
 * Handles both UserRole[] objects and string[] arrays
 */
function buildRoleQuery(role: string, tenantId?: string): Record<string, unknown> {
  const query: Record<string, unknown> = {
    $or: [
      // Match UserRole[] objects: { role: "system", active: true, ... }
      { roles: { $elemMatch: { role, active: { $ne: false } } } },
      // Match string[] arrays: ["system", "user"]
      { roles: role },
    ],
  };

  if (tenantId) {
    query.tenantId = tenantId;
  }

  return query;
}

/**
 * Extract user ID from document
 */
function extractUserId(user: Document): string | null {
  return user._id?.toString() || user.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * Find a user by role
 * 
 * This is a generic utility that queries the auth database for users with a specific role.
 * Useful for finding system users, provider users, or any role-based actors.
 * 
 * @example
 * ```typescript
 * // Find system user
 * const systemUserId = await findUserIdByRole({ role: 'system', client });
 * 
 * // Find payment provider user for a specific tenant
 * const providerUserId = await findUserIdByRole({ 
 *   role: 'payment-provider',
 *   tenantId: 'tenant-123',
 *   client,
 * });
 * ```
 * 
 * @param options - Search options
 * @returns User ID (string)
 * @throws Error if no user found and throwIfNotFound is true
 */
export async function findUserIdByRole(options: FindUserByRoleOptions): Promise<string> {
  const results = await findUsersByRoleInternal({ ...options, findOne: true });
  return results[0] || '';
}

/**
 * Find multiple users by role
 * 
 * Returns all users with the specified role (useful when multiple system users exist).
 * 
 * @example
 * ```typescript
 * // Find all admin users
 * const adminIds = await findUserIdsByRole({ role: 'admin', client });
 * ```
 * 
 * @param options - Search options
 * @returns Array of user IDs
 */
export async function findUserIdsByRole(options: FindUserByRoleOptions): Promise<string[]> {
  return findUsersByRoleInternal({ ...options, findOne: false, throwIfNotFound: false });
}
