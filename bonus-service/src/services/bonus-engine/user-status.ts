/**
 * User Status Tracking - Performance-Optimized Flags
 * 
 * Instead of querying large transaction tables, we query user metadata
 * from auth-service database (consistent with payment-service architecture).
 * 
 * User status flags are stored in user.metadata in auth-service:
 * - metadata.hasMadeFirstDeposit
 * - metadata.hasMadeFirstPurchase
 * - metadata.hasCompletedFirstAction
 * 
 * This is especially important for FTD (First Time Deposit) bonuses where
 * we need to check if a user has made a deposit without scanning transactions.
 * 
 * Architecture: Bonus-service queries auth-service database directly
 * (same pattern as payment-service) since both services share MongoDB.
 */

import { resolveDatabase, findById, logger, type DatabaseResolutionOptions, type Db, CORE_DATABASE_NAME } from 'core-service';
import { db } from '../../accessors.js';

export interface UserStatusOptions extends DatabaseResolutionOptions {
  // Can extend with user-status-specific options if needed
}

// Helper to resolve core-service database for cross-service access to users
// Uses db.getClient().db(CORE_DATABASE_NAME) pattern for cross-service database access
async function resolveCoreServiceDatabase(options: UserStatusOptions, tenantId?: string): Promise<Db> {
  // Option 1: Use database strategy if provided
  if (options.databaseStrategy || options.database) {
    return await resolveDatabase(options, 'auth-service', tenantId);
  }
  
  // Option 2: Cross-service access using db.getClient()
  // Use db.getClient().db(CORE_DATABASE_NAME) for accessing other service databases
  const client = db.getClient();
  return client.db(CORE_DATABASE_NAME);
}

/**
 * Get user status flags from auth-service database
 * Queries user.metadata directly (consistent with payment-service pattern)
 */
async function getUserFromAuthService(
  userId: string,
  options: UserStatusOptions,
  tenantId: string = 'default'
): Promise<any> {
  try {
    // Resolve core-service database for cross-service access to users
    // Uses db.getClient().db(CORE_DATABASE_NAME) pattern for cross-service database access
    const coreDb = await resolveCoreServiceDatabase(options, tenantId);
    const coreUsersCollection = coreDb.collection('users');
    
    // Use findById utility (handles both _id and id fields automatically)
    const user = await findById(coreUsersCollection, userId, { tenantId });
    
    if (!user) {
      logger.warn('User not found in core_service', { userId, tenantId });
      return null;
    }
    
    return user;
  } catch (error) {
    logger.error('Failed to query core_service database', { error, userId, tenantId });
    return null;
  }
}

/**
 * Note: User metadata updates are handled by auth-service via event listeners.
 * Auth-service listens to wallet.deposit.completed events and updates user.metadata.
 * Bonus-service only queries user metadata (read-only access).
 */

/**
 * Create user status functions with database strategy support
 */
export function createUserStatusFunctions(options: UserStatusOptions) {
  return {
    /**
     * Check if user has made their first deposit (fast check)
     * Queries user.metadata from auth-service database
     */
    async hasMadeFirstDeposit(
      userId: string,
      tenantId: string = 'default'
    ): Promise<boolean> {
      const user = await getUserFromAuthService(userId, options, tenantId);
      if (!user || !user.metadata) {
        return false;
      }
      return user.metadata.hasMadeFirstDeposit === true;
    },

    /**
     * Check if user has made their first purchase (fast check)
     * Queries user.metadata from auth-service database
     */
    async hasMadeFirstPurchase(
      userId: string,
      tenantId: string = 'default'
    ): Promise<boolean> {
      const user = await getUserFromAuthService(userId, options, tenantId);
      if (!user || !user.metadata) {
        return false;
      }
      return user.metadata.hasMadeFirstPurchase === true;
    },

    /**
     * Check if user has completed their first action (fast check)
     * Queries user.metadata from auth-service database
     */
    async hasCompletedFirstAction(
      userId: string,
      tenantId: string = 'default'
    ): Promise<boolean> {
      const user = await getUserFromAuthService(userId, options, tenantId);
      if (!user || !user.metadata) {
        return false;
      }
      return user.metadata.hasCompletedFirstAction === true;
    },
  };
}

