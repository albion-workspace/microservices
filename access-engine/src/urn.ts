/**
 * access-engine - URN Utilities
 * 
 * Uniform Resource Name (URN) parsing, matching, and building utilities.
 * 
 * URN Format: resource:action:target
 * Examples:
 *   - user:read:own      - Read own user data
 *   - user:read:*        - Read any user data
 *   - wallet:*:own       - All actions on own wallet
 *   - *:*:*              - Super admin (all permissions)
 *   - transaction:read:tenant - Read transactions in tenant
 */

import type { ParsedUrn } from './types.js';

/**
 * Standard actions for consistency
 */
export const StandardActions = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  EXECUTE: 'execute',
  APPROVE: 'approve',
  REJECT: 'reject',
  EXPORT: 'export',
  IMPORT: 'import',
  WILDCARD: '*',
} as const;

/**
 * Standard targets for consistency
 */
export const StandardTargets = {
  OWN: 'own',        // User's own resources
  TENANT: 'tenant',  // All resources in tenant
  ALL: '*',          // All resources globally
} as const;

/**
 * Parse a URN string into components
 * 
 * @example
 * parseUrn('user:read:own')
 * // { resource: 'user', action: 'read', target: 'own', original: 'user:read:own', valid: true }
 */
export function parseUrn(urn: string): ParsedUrn {
  if (!urn || typeof urn !== 'string') {
    return {
      resource: '',
      action: '',
      target: '',
      original: urn || '',
      valid: false,
    };
  }

  const parts = urn.split(':');
  
  if (parts.length !== 3) {
    return {
      resource: parts[0] || '',
      action: parts[1] || '',
      target: parts[2] || '',
      original: urn,
      valid: false,
    };
  }

  const [resource, action, target] = parts;

  return {
    resource: resource || '',
    action: action || '',
    target: target || '',
    original: urn,
    valid: Boolean(resource && action && target),
  };
}

/**
 * Build a URN from components
 * 
 * @example
 * buildUrn('user', 'read', 'own') // 'user:read:own'
 * buildUrn({ resource: 'wallet', action: 'update', target: 'tenant' }) // 'wallet:update:tenant'
 */
export function buildUrn(
  resourceOrComponents: string | { resource: string; action: string; target: string },
  action?: string,
  target?: string
): string {
  if (typeof resourceOrComponents === 'object') {
    const { resource, action: a, target: t } = resourceOrComponents;
    return `${resource}:${a}:${t}`;
  }
  
  return `${resourceOrComponents}:${action}:${target}`;
}

/**
 * Check if a permission URN matches a required URN
 * Supports wildcards (*) in permission patterns
 * 
 * @param permissionUrn - The permission the user has
 * @param requiredUrn - The permission required for the action
 * @returns true if permission grants access
 * 
 * @example
 * matchUrn('user:*:own', 'user:read:own')     // true
 * matchUrn('user:read:*', 'user:read:own')    // true
 * matchUrn('*:*:*', 'anything:here:works')    // true
 * matchUrn('user:read:own', 'user:write:own') // false
 */
export function matchUrn(permissionUrn: string, requiredUrn: string): boolean {
  const permission = parseUrn(permissionUrn);
  const required = parseUrn(requiredUrn);

  // Invalid URNs don't match
  if (!permission.valid || !required.valid) {
    return false;
  }

  // Check each component with wildcard support
  const resourceMatch = permission.resource === '*' || permission.resource === required.resource;
  const actionMatch = permission.action === '*' || permission.action === required.action;
  const targetMatch = permission.target === '*' || permission.target === required.target;

  return resourceMatch && actionMatch && targetMatch;
}

/**
 * Check if any permission in a list matches the required URN
 * 
 * @example
 * matchAnyUrn(['user:read:own', 'wallet:*:own'], 'wallet:update:own') // true
 */
export function matchAnyUrn(permissions: string[], requiredUrn: string): boolean {
  return permissions.some(p => matchUrn(p, requiredUrn));
}

/**
 * Validate a URN format
 * 
 * @example
 * isValidUrn('user:read:own') // true
 * isValidUrn('invalid')       // false
 * isValidUrn('a:b:c:d')       // false
 */
export function isValidUrn(urn: string): boolean {
  return parseUrn(urn).valid;
}

/**
 * Normalize a URN (lowercase, trim)
 */
export function normalizeUrn(urn: string): string {
  return urn.toLowerCase().trim();
}

/**
 * Get all possible URN patterns that could match a specific URN
 * Useful for caching and pre-computing permissions
 * 
 * @example
 * getMatchingPatterns('user:read:123')
 * // ['user:read:123', 'user:read:*', 'user:*:123', 'user:*:*', '*:read:123', '*:read:*', '*:*:123', '*:*:*']
 */
export function getMatchingPatterns(urn: string): string[] {
  const parsed = parseUrn(urn);
  if (!parsed.valid) return [];

  const { resource, action, target } = parsed;
  const patterns: string[] = [];

  // Generate all combinations with wildcards
  const resources = [resource, '*'];
  const actions = [action, '*'];
  const targets = [target, '*'];

  for (const r of resources) {
    for (const a of actions) {
      for (const t of targets) {
        patterns.push(buildUrn(r, a, t));
      }
    }
  }

  return patterns;
}

/**
 * Extract resource type from URN
 */
export function getResource(urn: string): string {
  return parseUrn(urn).resource;
}

/**
 * Extract action from URN
 */
export function getAction(urn: string): string {
  return parseUrn(urn).action;
}

/**
 * Extract target from URN
 */
export function getTarget(urn: string): string {
  return parseUrn(urn).target;
}

/**
 * Check if a target represents "own" resources
 */
export function isOwnTarget(urn: string): boolean {
  return getTarget(urn) === StandardTargets.OWN;
}

/**
 * Check if a target represents tenant-scoped resources
 */
export function isTenantTarget(urn: string): boolean {
  return getTarget(urn) === StandardTargets.TENANT;
}

/**
 * Check if URN has any wildcards
 */
export function hasWildcard(urn: string): boolean {
  return urn.includes('*');
}

/**
 * Create URN helpers for a specific resource type
 * 
 * @example
 * const userUrn = createResourceUrn('user');
 * userUrn.read('own')    // 'user:read:own'
 * userUrn.create('*')    // 'user:create:*'
 * userUrn.any()          // 'user:*:*'
 */
export function createResourceUrn(resource: string) {
  return {
    create: (target: string = '*') => buildUrn(resource, 'create', target),
    read: (target: string = '*') => buildUrn(resource, 'read', target),
    update: (target: string = '*') => buildUrn(resource, 'update', target),
    delete: (target: string = '*') => buildUrn(resource, 'delete', target),
    list: (target: string = '*') => buildUrn(resource, 'list', target),
    execute: (target: string = '*') => buildUrn(resource, 'execute', target),
    action: (action: string, target: string = '*') => buildUrn(resource, action, target),
    any: () => buildUrn(resource, '*', '*'),
  };
}
