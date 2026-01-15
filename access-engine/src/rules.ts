/**
 * access-engine - Permission Rules
 * 
 * Pre-built permission rule helpers for common authorization patterns.
 * These can be used standalone or with the AccessEngine.
 */

import type { User, PermissionRule } from './types.js';
import { matchAnyUrn } from './urn.js';

// ─────────────────────────────────────────────────────────────────────────────
// Basic Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Always allow access
 */
export const allow: PermissionRule = () => true;

/**
 * Always deny access
 */
export const deny: PermissionRule = () => false;

/**
 * Allow if user is authenticated (has userId)
 */
export const isAuthenticated: PermissionRule = (user) => {
  return Boolean(user?.userId);
};

/**
 * Allow if user is NOT authenticated (for public endpoints)
 */
export const isGuest: PermissionRule = (user) => {
  return !user?.userId;
};

// ─────────────────────────────────────────────────────────────────────────────
// Role-based Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allow if user has a specific role
 * 
 * @example
 * hasRole('admin')
 */
export function hasRole(role: string): PermissionRule {
  return (user) => {
    return user?.roles?.includes(role) ?? false;
  };
}

/**
 * Allow if user has any of the specified roles
 * 
 * @example
 * hasAnyRole(['admin', 'manager'])
 */
export function hasAnyRole(roles: string[]): PermissionRule {
  return (user) => {
    return roles.some(role => user?.roles?.includes(role)) ?? false;
  };
}

/**
 * Allow if user has all of the specified roles
 * 
 * @example
 * hasAllRoles(['verified', 'premium'])
 */
export function hasAllRoles(roles: string[]): PermissionRule {
  return (user) => {
    return roles.every(role => user?.roles?.includes(role)) ?? false;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission-based Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allow if user has a specific permission URN
 * 
 * @example
 * can('user:read:own')
 */
export function can(urn: string): PermissionRule {
  return (user) => {
    return matchAnyUrn(user?.permissions ?? [], urn);
  };
}

/**
 * Allow if user has any of the specified permission URNs
 * 
 * @example
 * canAny(['user:read:*', 'user:list:*'])
 */
export function canAny(urns: string[]): PermissionRule {
  return (user) => {
    const permissions = user?.permissions ?? [];
    return urns.some(urn => matchAnyUrn(permissions, urn));
  };
}

/**
 * Allow if user has all of the specified permission URNs
 * 
 * @example
 * canAll(['wallet:read:own', 'transaction:read:own'])
 */
export function canAll(urns: string[]): PermissionRule {
  return (user) => {
    const permissions = user?.permissions ?? [];
    return urns.every(urn => matchAnyUrn(permissions, urn));
  };
}

/**
 * Allow if user can perform action on a resource with ownership check
 * 
 * @example
 * canOn('wallet:update', { userId: '123' }) // Checks if user 123 can update
 */
export function canOn(urn: string, resource: Record<string, unknown>): PermissionRule {
  return (user) => {
    const permissions = user?.permissions ?? [];
    
    // Check wildcard permission first
    if (matchAnyUrn(permissions, urn.replace(/:$/, ':*'))) {
      return true;
    }

    // Check :own permission
    const ownUrn = urn.replace(/:$/, ':own');
    if (matchAnyUrn(permissions, ownUrn)) {
      const ownerId = resource.userId ?? resource.ownerId ?? resource.createdBy;
      return ownerId === user?.userId;
    }

    // Check :tenant permission
    const tenantUrn = urn.replace(/:$/, ':tenant');
    if (matchAnyUrn(permissions, tenantUrn)) {
      const resourceTenant = resource.tenantId;
      return resourceTenant === user?.tenantId;
    }

    return false;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allow if user owns the resource
 * 
 * @example
 * isOwner({ userId: '123' }) // Only user 123 can access
 */
export function isOwner(resource: Record<string, unknown>): PermissionRule {
  return (user) => {
    const ownerId = resource.userId ?? resource.ownerId ?? resource.createdBy;
    return ownerId === user?.userId;
  };
}

/**
 * Allow if resource belongs to user's tenant
 * 
 * @example
 * sameTenant({ tenantId: 'tenant-1' })
 */
export function sameTenant(resource: Record<string, unknown>): PermissionRule {
  return (user) => {
    const resourceTenant = resource.tenantId;
    return resourceTenant === user?.tenantId;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribute-based Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allow if user has a specific attribute value
 * 
 * @example
 * hasAttribute('metadata.verified', true)
 */
export function hasAttribute(path: string, value: unknown): PermissionRule {
  return (user) => {
    const userValue = getNestedValue(user as unknown as Record<string, unknown>, path);
    return userValue === value;
  };
}

/**
 * Allow if user attribute is in a list of values
 * 
 * @example
 * attributeIn('metadata.tier', ['gold', 'platinum'])
 */
export function attributeIn(path: string, values: unknown[]): PermissionRule {
  return (user) => {
    const userValue = getNestedValue(user as unknown as Record<string, unknown>, path);
    return values.includes(userValue);
  };
}

/**
 * Allow based on custom attribute condition
 * 
 * @example
 * attributeMatches('metadata.credits', credits => credits > 100)
 */
export function attributeMatches(
  path: string,
  predicate: (value: unknown) => boolean
): PermissionRule {
  return (user) => {
    const userValue = getNestedValue(user as unknown as Record<string, unknown>, path);
    return predicate(userValue);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Combinators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combine rules with AND logic - all must pass
 * 
 * @example
 * and(isAuthenticated, hasRole('admin'))
 */
export function and(...rules: PermissionRule[]): PermissionRule {
  return async (user, resource) => {
    for (const rule of rules) {
      const result = await rule(user, resource);
      if (!result) return false;
    }
    return true;
  };
}

/**
 * Combine rules with OR logic - any must pass
 * 
 * @example
 * or(hasRole('admin'), isOwner(resource))
 */
export function or(...rules: PermissionRule[]): PermissionRule {
  return async (user, resource) => {
    for (const rule of rules) {
      const result = await rule(user, resource);
      if (result) return true;
    }
    return false;
  };
}

/**
 * Negate a rule
 * 
 * @example
 * not(hasRole('banned'))
 */
export function not(rule: PermissionRule): PermissionRule {
  return async (user, resource) => {
    const result = await rule(user, resource);
    return !result;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-based Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allow only during specific hours (UTC)
 * 
 * @example
 * duringHours(9, 17) // 9 AM to 5 PM UTC
 */
export function duringHours(startHour: number, endHour: number): PermissionRule {
  return () => {
    const hour = new Date().getUTCHours();
    return hour >= startHour && hour < endHour;
  };
}

/**
 * Allow only on specific days (0 = Sunday, 6 = Saturday)
 * 
 * @example
 * onDays([1, 2, 3, 4, 5]) // Weekdays only
 */
export function onDays(days: number[]): PermissionRule {
  return () => {
    const day = new Date().getUTCDay();
    return days.includes(day);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting (Simple)
// ─────────────────────────────────────────────────────────────────────────────

const rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-memory rate limiting
 * For production, use Redis or similar
 * 
 * @example
 * rateLimit(100, 60000) // 100 requests per minute
 */
export function rateLimit(maxRequests: number, windowMs: number): PermissionRule {
  return (user) => {
    const key = user?.userId ?? 'anonymous';
    const now = Date.now();
    
    let counter = rateLimitCounters.get(key);
    
    if (!counter || now > counter.resetAt) {
      counter = { count: 0, resetAt: now + windowMs };
      rateLimitCounters.set(key, counter);
    }
    
    counter.count++;
    
    return counter.count <= maxRequests;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a custom rule from a function
 * 
 * @example
 * custom(async (user, resource) => {
 *   const plan = await fetchUserPlan(user.userId);
 *   return plan.features.includes('advanced');
 * })
 */
export function custom(
  fn: (user: User | null | undefined, resource?: Record<string, unknown>) => boolean | Promise<boolean>
): PermissionRule {
  return fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!obj) return undefined;
  return path.split('.').reduce((current: unknown, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule Builder (Fluent API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fluent rule builder for complex permission rules
 * 
 * @example
 * rule()
 *   .authenticated()
 *   .hasRole('user')
 *   .or(r => r.hasRole('admin'))
 *   .build()
 */
export function rule() {
  return new RuleBuilder();
}

class RuleBuilder {
  private rules: PermissionRule[] = [];
  private orRules: PermissionRule[] = [];

  authenticated(): this {
    this.rules.push(isAuthenticated);
    return this;
  }

  guest(): this {
    this.rules.push(isGuest);
    return this;
  }

  hasRole(role: string): this {
    this.rules.push(hasRole(role));
    return this;
  }

  hasAnyRole(roles: string[]): this {
    this.rules.push(hasAnyRole(roles));
    return this;
  }

  can(urn: string): this {
    this.rules.push(can(urn));
    return this;
  }

  owns(resource: Record<string, unknown>): this {
    this.rules.push(isOwner(resource));
    return this;
  }

  inTenant(resource: Record<string, unknown>): this {
    this.rules.push(sameTenant(resource));
    return this;
  }

  or(fn: (builder: RuleBuilder) => RuleBuilder): this {
    const orBuilder = new RuleBuilder();
    fn(orBuilder);
    this.orRules.push(orBuilder.build());
    return this;
  }

  custom(fn: PermissionRule): this {
    this.rules.push(fn);
    return this;
  }

  build(): PermissionRule {
    const allRules = [...this.rules];
    
    if (this.orRules.length > 0) {
      return or(and(...allRules), ...this.orRules);
    }
    
    if (allRules.length === 0) return allow;
    if (allRules.length === 1) return allRules[0];
    
    return and(...allRules);
  }
}
