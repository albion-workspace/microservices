/**
 * Client-Side Access Control Utilities
 * 
 * Wraps access-engine for use in React components.
 * Provides consistent role and permission checking across client and server.
 */

import {
  hasRole as hasRoleEngine,
  hasAnyRole as hasAnyRoleEngine,
  can as canEngine,
  canAny as canAnyEngine,
  canAll as canAllEngine,
  matchUrn,
  parseUrn,
  type User as AccessEngineUser,
} from 'access-engine';

import type { User } from './auth-context';

/**
 * Normalize user roles to string array
 * Handles both legacy format (string[]) and new format (UserRole[])
 */
export function getRoleNames(roles: any): string[] {
  if (!roles || !Array.isArray(roles)) return [];
  if (roles.length === 0) return [];
  
  // If first element is a string, it's already a string array
  if (typeof roles[0] === 'string') {
    return roles as string[];
  }
  
  // If first element is an object, extract role names from UserRole[]
  if (typeof roles[0] === 'object' && roles[0].role) {
    return roles
      .filter((r: any) => r.active !== false)
      .filter((r: any) => !r.expiresAt || new Date(r.expiresAt) > new Date())
      .map((r: any) => r.role)
      .filter((role: string) => role !== undefined && role !== null);
  }
  
  return [];
}

/**
 * Convert React User to access-engine User format
 */
function toAccessEngineUser(user: User | null | undefined): AccessEngineUser | null {
  if (!user) return null;
  
  return {
    userId: user.id,
    tenantId: user.tenantId,
    roles: getRoleNames(user.roles),
    permissions: user.permissions || [],
    metadata: user.metadata,
  };
}

/**
 * Check if user has a specific role
 * Uses access-engine's hasRole rule
 * 
 * @example
 * hasRole(user?.roles, 'system')
 * hasRole(user?.roles, 'admin')
 */
export function hasRole(roles: any, roleName: string): boolean {
  const roleNames = getRoleNames(roles);
  // Use access-engine's hasRole rule
  const rule = hasRoleEngine(roleName);
  // Create a temporary user object with normalized roles
  const tempUser: AccessEngineUser = {
    userId: '',
    roles: roleNames,
    permissions: [],
  };
  const result = rule(tempUser);
  // Handle both sync and async results
  return result instanceof Promise ? false : result;
}

/**
 * Check if user has any of the specified roles
 * Uses access-engine's hasAnyRole rule
 * 
 * @example
 * hasAnyRole(user?.roles, ['system', 'admin'])
 */
export function hasAnyRole(roles: any, roleNames: string[]): boolean {
  const userRoles = getRoleNames(roles);
  // Use access-engine's hasAnyRole rule
  const rule = hasAnyRoleEngine(roleNames);
  // Create a temporary user object with normalized roles
  const tempUser: AccessEngineUser = {
    userId: '',
    roles: userRoles,
    permissions: [],
  };
  const result = rule(tempUser);
  // Handle both sync and async results
  return result instanceof Promise ? false : result;
}

/**
 * Check if user has a specific permission (URN format)
 * Uses access-engine's can rule
 * 
 * @example
 * can(user, 'user:read:own')
 * can(user, 'wallet:*:*')
 */
export function can(user: User | null | undefined, permissionUrn: string): boolean {
  if (!user) return false;
  // Use access-engine's can rule
  const rule = canEngine(permissionUrn);
  const accessUser = toAccessEngineUser(user);
  if (!accessUser) return false;
  const result = rule(accessUser);
  // Handle both sync and async results
  return result instanceof Promise ? false : result;
}

/**
 * Check if user has any of the specified permissions
 * Uses access-engine's canAny rule
 * 
 * @example
 * canAny(user, ['user:read:*', 'wallet:*:*'])
 */
export function canAny(user: User | null | undefined, permissionUrns: string[]): boolean {
  if (!user) return false;
  // Use access-engine's canAny rule
  const rule = canAnyEngine(permissionUrns);
  const accessUser = toAccessEngineUser(user);
  if (!accessUser) return false;
  const result = rule(accessUser);
  // Handle both sync and async results
  return result instanceof Promise ? false : result;
}

/**
 * Check if user has all of the specified permissions
 * Uses access-engine's canAll rule
 * 
 * @example
 * canAll(user, ['user:read:own', 'wallet:read:own'])
 */
export function canAll(user: User | null | undefined, permissionUrns: string[]): boolean {
  if (!user) return false;
  // Use access-engine's canAll rule
  const rule = canAllEngine(permissionUrns);
  const accessUser = toAccessEngineUser(user);
  if (!accessUser) return false;
  const result = rule(accessUser);
  // Handle both sync and async results
  return result instanceof Promise ? false : result;
}

/**
 * Parse a URN into its components
 * 
 * @example
 * const parsed = parsePermissionUrn('user:read:own')
 * // { resource: 'user', action: 'read', target: 'own', valid: true }
 */
export { parseUrn as parsePermissionUrn };

/**
 * Check if a permission URN matches a required URN (with wildcard support)
 * 
 * @example
 * matchPermission('user:*:own', 'user:read:own') // true
 * matchPermission('*:*:*', 'anything:here:works') // true
 */
export { matchUrn as matchPermission };

/**
 * Check if user has system role (full system access)
 */
export function isSystem(user: User | null | undefined): boolean {
  return hasRole(user?.roles, 'system');
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(user: User | null | undefined): boolean {
  return user !== null && user !== undefined;
}
