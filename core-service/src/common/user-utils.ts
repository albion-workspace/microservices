/**
 * User Utilities
 * 
 * Generic utilities for querying users across services.
 * Supports role-based user lookup for flexible system user management.
 */

import { getClient } from './database.js';
import { logger } from './logger.js';

export interface FindUserByRoleOptions {
  /**
   * Role to search for (e.g., 'system', 'payment-provider')
   */
  role: string;
  
  /**
   * Optional tenant ID to filter by
   */
  tenantId?: string;
  
  /**
   * Database name (defaults to 'auth_service')
   */
  database?: string;
  
  /**
   * Whether to throw an error if no user is found (default: true)
   */
  throwIfNotFound?: boolean;
}

/**
 * Find a user by role
 * 
 * This is a generic utility that queries the auth database for users with a specific role.
 * Useful for finding system users, provider users, or any role-based actors.
 * 
 * @example
 * ```typescript
 * // Find system user
 * const systemUserId = await findUserIdByRole({ role: 'system' });
 * 
 * // Find payment provider user for a specific tenant
 * const providerUserId = await findUserIdByRole({ 
 *   role: 'payment-provider',
 *   tenantId: 'tenant-123'
 * });
 * ```
 * 
 * @param options - Search options
 * @returns User ID (string)
 * @throws Error if no user found and throwIfNotFound is true
 */
export async function findUserIdByRole(options: FindUserByRoleOptions): Promise<string> {
  const {
    role,
    tenantId,
    database = 'auth_service',
    throwIfNotFound = true,
  } = options;

  try {
    const client = getClient();
    const authDb = client.db(database);
    const usersCollection = authDb.collection('users');

    // Build query: find user with the specified role
    // Handle both UserRole[] objects and string[] arrays
    const query: Record<string, unknown> = {
      $or: [
        // Match UserRole[] objects: { role: "system", active: true, ... }
        { roles: { $elemMatch: { role: role, active: { $ne: false } } } },
        // Match string[] arrays: ["system", "user"]
        { roles: role },
      ],
    };

    // Add tenant filter if provided
    if (tenantId) {
      query.tenantId = tenantId;
    }

    logger.debug('Finding user by role', { role, tenantId, database });

    // Find first user matching the role
    const user = await usersCollection.findOne(query);

    if (!user) {
      const errorMsg = `No user found with role "${role}"${tenantId ? ` for tenant "${tenantId}"` : ''}`;
      
      if (throwIfNotFound) {
        logger.error(errorMsg);
        throw new Error(errorMsg);
      } else {
        logger.warn(errorMsg);
        return '';
      }
    }

    const userId = user._id?.toString() || user.id;
    
    if (!userId) {
      const errorMsg = `User found but has no valid ID (role: "${role}")`;
      logger.error(errorMsg, { user });
      throw new Error(errorMsg);
    }

    logger.debug('User found by role', { 
      userId, 
      role, 
      email: user.email,
      tenantId: user.tenantId 
    });

    return userId;
  } catch (error) {
    logger.error('Error finding user by role', { 
      role, 
      tenantId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

/**
 * Find multiple users by role
 * 
 * Returns all users with the specified role (useful when multiple system users exist).
 * 
 * @param options - Search options
 * @returns Array of user IDs
 */
export async function findUserIdsByRole(options: FindUserByRoleOptions): Promise<string[]> {
  const {
    role,
    tenantId,
    database = 'auth_service',
  } = options;

  try {
    const client = getClient();
    const authDb = client.db(database);
    const usersCollection = authDb.collection('users');

    // Build query: find users with the specified role
    const query: Record<string, unknown> = {
      $or: [
        { roles: { $elemMatch: { role: role, active: { $ne: false } } } },
        { roles: role },
      ],
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    logger.debug('Finding users by role', { role, tenantId, database });

    const users = await usersCollection.find(query).toArray();

    const userIds = users
      .map(user => user._id?.toString() || user.id)
      .filter((id): id is string => Boolean(id));

    logger.debug('Users found by role', { 
      count: userIds.length, 
      role, 
      tenantId 
    });

    return userIds;
  } catch (error) {
    logger.error('Error finding users by role', { 
      role, 
      tenantId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}
