/**
 * Cached Access Engine
 * 
 * Wraps AccessEngine with Redis caching to avoid DB hits on every check.
 * Compiles and caches user permissions for fast lookups.
 */

import type { User, AccessResult } from 'access-engine';
import { matchUrn } from 'access-engine';
import type { AccessEngine } from 'access-engine';
import type { AccessStore } from './store.js';
import type { AccessCache } from './cache.js';
import type { CompiledPermissions } from './types-ext.js';

export class CachedAccessEngine {
  constructor(
    private engine: AccessEngine,
    private store: AccessStore,
    private cache: AccessCache
  ) {}

  /**
   * Check access with caching
   * 
   * Flow:
   * 1. Check memory cache (L1) - fastest
   * 2. Check Redis cache (L2) - fast
   * 3. Compile from DB (L3) - slowest, cache result
   * 4. Match URN against cached permissions
   */
  async check(
    user: User | null | undefined,
    requiredUrn: string,
    resource?: Record<string, unknown>
  ): Promise<AccessResult> {
    const startTime = Date.now();

    // No user = no access
    if (!user) {
      return {
        allowed: false,
        reason: 'No user context',
        duration: Date.now() - startTime,
      };
    }

    // If resource context provided, skip cache (need ABAC evaluation)
    if (resource) {
      return this.engine.check(user, requiredUrn, resource);
    }

    // Try to get compiled permissions from cache
    const tenantId = user.tenantId || 'default';
    let permissions = await this.cache.get(user.userId, tenantId);

    if (!permissions) {
      // Cache miss - compile from DB and roles
      permissions = await this.compileUserPermissions(user);
      
      // Cache for next time
      await this.cache.set(permissions);
    }

    // Check URN against cached permissions
    const allowed = permissions.urns.some(urn => matchUrn(urn, requiredUrn));

    return {
      allowed,
      reason: allowed ? 'Permission granted' : 'No matching permission',
      matchedBy: allowed ? requiredUrn : undefined,
      matchedUrn: allowed ? requiredUrn : undefined,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Compile all permissions for a user
   * 
   * Sources:
   * 1. User-specific permissions
   * 2. Role permissions (from DB)
   * 3. Inherited role permissions
   */
  private async compileUserPermissions(user: User): Promise<CompiledPermissions> {
    const urns = new Set<string>();
    const roles = new Set<string>();

    // Add user-specific permissions
    if (user.permissions) {
      for (const perm of user.permissions) {
        urns.add(perm);
      }
    }

    // Add role permissions (includes inheritance)
    if (user.roles) {
      for (const roleName of user.roles) {
        roles.add(roleName);
        
        // Get role from DB (this is the DB hit we're caching)
        const rolePerms = await this.store.getRolePermissions(roleName, user.tenantId || 'default');
        for (const perm of rolePerms) {
          urns.add(perm);
        }
      }
    }

    const now = Date.now();

    return {
      userId: user.userId,
      tenantId: user.tenantId || 'default',
      urns: Array.from(urns),
      roles: Array.from(roles),
      grants: [] as any,
      denies: [] as any,
      computedAt: now,
      expiresAt: now + 300000, // 5 minutes
      permissions: [],
      matcher: (urnObj: any) => {
        const urnString = typeof urnObj === 'string' ? urnObj : `${urnObj.resource}:${urnObj.action}:${urnObj.target}`;
        return Array.from(urns).some(u => matchUrn(u, urnString));
      },
      compiledAt: new Date(now),
    };
  }

  /**
   * Pre-warm cache for a user
   */
  async warmCache(user: User): Promise<void> {
    const permissions = await this.compileUserPermissions(user);
    await this.cache.set(permissions);
  }

  /**
   * Invalidate cache for a user
   */
  async invalidateUser(tenantId: string, userId: string): Promise<void> {
    await this.cache.invalidateUser(tenantId, userId);
  }

  /**
   * Invalidate cache for all users with a role
   */
  async invalidateRole(tenantId: string, roleName: string): Promise<void> {
    await this.cache.invalidateRole(tenantId, roleName);
  }

  /**
   * Invalidate entire tenant cache
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.cache.invalidateTenant(tenantId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }
}
