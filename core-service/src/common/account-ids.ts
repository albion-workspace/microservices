/**
 * Simplified Account ID Management System
 * 
 * Everything is a user account. Roles and permissions determine capabilities.
 * System, provider, and end-user are all just users with different roles.
 */

export interface AccountIdOptions {
  tenantId?: string;
  currency?: string;
}

/**
 * Generate user account ID
 * 
 * Format: user:{userId}:{subtype}
 * 
 * All accounts are user accounts. Roles/permissions determine:
 * - Whether they can go negative
 * - What operations they can perform
 */
export function getUserAccountId(
  userId: string,
  subtype: string,
  options: AccountIdOptions = {}
): string {
  // Simple format: user:{userId}:{subtype}
  // No currency in ID - accounts are currency-specific via the account document
  return `user:${userId}:${subtype}`;
}

/**
 * Parse account ID to extract components
 */
export function parseAccountId(accountId: string): {
  userId: string;
  subtype: string;
} | null {
  const parts = accountId.split(':');
  
  if (parts[0] === 'user' && parts.length === 3) {
    return {
      userId: parts[1],
      subtype: parts[2],
    };
  }
  
  return null;
}

/**
 * Legacy compatibility: getSystemAccountId -> getUserAccountId
 * System users are just users with special roles
 */
export function getSystemAccountId(
  userId: string,
  options: AccountIdOptions = {}
): string {
  return getUserAccountId(userId, 'system', options);
}

/**
 * Legacy compatibility: getProviderAccountId -> getUserAccountId
 * Provider users are just users with provider roles
 */
export function getProviderAccountId(
  userId: string,
  subtype: 'deposit' | 'withdrawal',
  options: AccountIdOptions = {}
): string {
  return getUserAccountId(userId, subtype, options);
}
