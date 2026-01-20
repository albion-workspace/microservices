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

import { getClient, findById, logger } from 'core-service';

/**
 * Get user status flags from auth-service database
 * Queries user.metadata directly (consistent with payment-service pattern)
 */
async function getUserFromAuthService(
  userId: string,
  tenantId: string = 'default'
): Promise<any> {
  try {
    // Query auth_service database directly (both services share MongoDB instance)
    // Same pattern as payment-service/src/services/wallet.ts (unified wallet operations)
    const client = getClient();
    const authDb = client.db('auth_service');
    const authUsersCollection = authDb.collection('users');
    
    // Use findById utility (handles both _id and id fields automatically)
    const user = await findById(authUsersCollection, userId, { tenantId });
    
    if (!user) {
      logger.warn('User not found in auth_service', { userId, tenantId });
      return null;
    }
    
    return user;
  } catch (error) {
    logger.error('Failed to query auth_service database', { error, userId, tenantId });
    return null;
  }
}

/**
 * Note: User metadata updates are handled by auth-service via event listeners.
 * Auth-service listens to wallet.deposit.completed events and updates user.metadata.
 * Bonus-service only queries user metadata (read-only access).
 */

/**
 * Check if user has made their first deposit (fast check)
 * Queries user.metadata from auth-service database
 */
export async function hasMadeFirstDeposit(
  userId: string,
  tenantId: string = 'default'
): Promise<boolean> {
  const user = await getUserFromAuthService(userId, tenantId);
  if (!user || !user.metadata) {
    return false;
  }
  return user.metadata.hasMadeFirstDeposit === true;
}

/**
 * Check if user has made their first purchase (fast check)
 * Queries user.metadata from auth-service database
 */
export async function hasMadeFirstPurchase(
  userId: string,
  tenantId: string = 'default'
): Promise<boolean> {
  const user = await getUserFromAuthService(userId, tenantId);
  if (!user || !user.metadata) {
    return false;
  }
  return user.metadata.hasMadeFirstPurchase === true;
}

/**
 * Check if user has completed their first action (fast check)
 * Queries user.metadata from auth-service database
 */
export async function hasCompletedFirstAction(
  userId: string,
  tenantId: string = 'default'
): Promise<boolean> {
  const user = await getUserFromAuthService(userId, tenantId);
  if (!user || !user.metadata) {
    return false;
  }
  return user.metadata.hasCompletedFirstAction === true;
}
