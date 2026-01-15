/**
 * URN Permission System
 */

import type { Permission, PermissionRule, UserContext } from '../types/index.js';

export function parseUrn(urn: string): Permission {
  const [resource = '*', resourceId = '*', action = '*'] = urn.split(':');
  return { resource, resourceId, action };
}

export function matchUrn(userPerm: string, required: string): boolean {
  const user = parseUrn(userPerm);
  const req = parseUrn(required);
  return (
    (user.resource === '*' || user.resource === req.resource) &&
    (user.resourceId === '*' || user.resourceId === req.resourceId) &&
    (user.action === '*' || user.action === req.action)
  );
}

export function hasPermission(user: UserContext | null, resource: string, action: string, resourceId = '*'): boolean {
  if (!user) return false;
  return user.permissions.some(p => matchUrn(p, `${resource}:${resourceId}:${action}`));
}

// Built-in rules
export const allow: PermissionRule = () => true;
export const deny: PermissionRule = () => false;
export const isAuthenticated: PermissionRule = (user) => user !== null;

export const hasRole = (role: string): PermissionRule => (user) => {
  if (!user) return false;
  // Check if user has the role
  if (user.roles?.includes(role)) return true;
  // Also check if user has wildcard permissions (*:*:*), which grants all roles
  if (user.permissions?.some(p => p === '*:*:*' || p === '*')) return true;
  return false;
};
export const hasAnyRole = (...roles: string[]): PermissionRule => (user) => roles.some(r => user?.roles.includes(r)) ?? false;
export const can = (resource: string, action: string): PermissionRule => (user, args) => hasPermission(user, resource, action, (args.id as string) || '*');

export const and = (...rules: PermissionRule[]): PermissionRule => async (user, args) => {
  for (const rule of rules) {
    if (!(await rule(user, args))) return false;
  }
  return true;
};

export const or = (...rules: PermissionRule[]): PermissionRule => async (user, args) => {
  for (const rule of rules) {
    if (await rule(user, args)) return true;
  }
  return false;
};

export const isOwner = (field = 'createdBy'): PermissionRule => (user, args) => user?.userId === args[field];
export const sameTenant = (field = 'tenantId'): PermissionRule => (user, args) => user?.tenantId === args[field];
