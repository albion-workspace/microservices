/**
 * URN Permission System
 * 
 * This module re-exports access-engine utilities through core-service/access.
 * All URN parsing, matching, and role checking should use access-engine via core-service/access.
 */

// Import from core-service/access (which wraps access-engine)
import {
  // URN utilities
  matchAnyUrn,
  // Permission rules
  allow,
  deny,
  isAuthenticated as isAuthenticatedEngine,
  hasRole as hasRoleEngine,
  hasAnyRole as hasAnyRoleEngine,
  can as canEngine,
  and as andEngine,
  or as orEngine,
  isOwner as isOwnerEngine,
  sameTenant as sameTenantEngine,
  type PermissionRule,
} from '../../access/index.js';

import type { UserContext } from '../../types/index.js';

// Re-export everything from core-service/access for consistency
export {
  // URN utilities
  parseUrn,
  buildUrn,
  matchUrn,
  matchAnyUrn,
  isValidUrn,
  normalizeUrn,
  getMatchingPatterns,
  getResource,
  getAction,
  getTarget,
  isOwnTarget,
  isTenantTarget,
  hasWildcard,
  createResourceUrn,
  StandardActions,
  StandardTargets,
  
  // Permission rules
  allow,
  deny,
  isGuest,
  hasAllRoles,
  canAny,
  canAll,
  canOn,
  hasAttribute,
  attributeIn,
  attributeMatches,
  not,
  duringHours,
  onDays,
  rateLimit,
  custom,
  rule,
} from '../../access/index.js';

/**
 * Check if user is authenticated
 * Compatible with core-service UserContext type
 */
export const isAuthenticated: PermissionRule = (user) => {
  return isAuthenticatedEngine(user as any);
};

/**
 * Check if user has a specific role
 * Compatible with core-service UserContext type and handles both string[] and UserRole[] formats
 */
export function hasRole(role: string): PermissionRule {
  return (user) => {
    if (!user) return false;
    const userRoles = Array.isArray(user.roles) 
      ? (typeof user.roles[0] === 'string' 
          ? user.roles as string[]
          : (user.roles as any[]).map((r: any) => r.role || r).filter(Boolean))
      : [];
    return hasRoleEngine(role)({ ...user, roles: userRoles } as any);
  };
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(...roles: string[]): PermissionRule {
  return (user) => {
    if (!user) return false;
    const userRoles = Array.isArray(user.roles) 
      ? (typeof user.roles[0] === 'string' 
          ? user.roles as string[]
          : (user.roles as any[]).map((r: any) => r.role || r).filter(Boolean))
      : [];
    return hasAnyRoleEngine(roles)({ ...user, roles: userRoles } as any);
  };
}

/**
 * Check if user has a specific permission
 * Compatible with core-service UserContext type
 */
export function hasPermission(user: UserContext | null, resource: string, action: string, resourceId = '*'): boolean {
  if (!user) return false;
  return matchAnyUrn(user.permissions || [], `${resource}:${action}:${resourceId}`);
}

/**
 * Check permission using URN format
 */
export function can(resource: string, action: string): PermissionRule {
  return (user, args) => {
    const resourceId = (args?.id as string) || '*';
    return hasPermission(user as UserContext | null, resource, action, resourceId);
  };
}

/**
 * Combine multiple rules with AND logic
 */
export const and = andEngine;

/**
 * Combine multiple rules with OR logic
 */
export const or = orEngine;

/**
 * Check if user owns the resource
 */
export const isOwner = isOwnerEngine;

/**
 * Check if resource belongs to same tenant
 */
export const sameTenant = sameTenantEngine;

/**
 * Check if user has system role (full system access)
 * This is the only role that should have unrestricted access
 * All other roles (admin, moderator, etc.) are business logic and use permissions
 */
export const isSystem = (): PermissionRule => hasRole('system');

/**
 * Check if user has system role or specific permission (URN: resource:action:target).
 * Use in resolvers for "system or permission" checks. Only 'system' role has full access;
 * other roles use permissions via access-engine URN format.
 */
export function checkSystemOrPermission(
  user: UserContext | null,
  resource: string,
  action: string,
  target: string = '*'
): boolean {
  if (!user) return false;
  if (hasRole('system')(user)) return true;
  return matchAnyUrn(user.permissions || [], `${resource}:${action}:${target}`);
}
