/**
 * Cached Access Engine
 * 
 * Wraps AccessEngine with Redis caching to avoid DB hits on every check.
 * Compiles and caches user permissions for fast lookups.
 */

// External packages
import type { User, AccessResult, UserRole, ResolvedPermissions, AccessEngine } from 'access-engine';
import { matchUrn, RoleResolver, type Role as BaseRole } from 'access-engine';

// Internal imports
import type { AccessStore } from './store.js';
import type { AccessCache } from './cache.js';
import type { CompiledPermissions, Role, URN } from './types-ext.js';

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
   * Uses access-engine's RoleResolver for safe resolution with all features:
   * - Role expiration checking
   * - Active role filtering
   * - Context-based role support
   * - UserRole[] format support
   * - Safe inheritance resolution (visited set, maxDepth)
   * 
   * Sources:
   * 1. User-specific permissions
   * 2. Role permissions (from DB, resolved via RoleResolver)
   * 3. Inherited role permissions (safely resolved)
   */
  private async compileUserPermissions(user: User): Promise<CompiledPermissions> {
    const { tenantId: userTenantId, userId, roles: userRoles, permissions: userPermissions } = user;
    const tenantId = userTenantId || 'default';
    
    // Extract role names from user.roles (handles both string[] and UserRole[] formats)
    let roleNames: string[] = [];
    if (Array.isArray(userRoles) && userRoles.length > 0) {
      if (typeof userRoles[0] === 'string') {
        roleNames = userRoles as string[];
      } else {
        roleNames = (userRoles as unknown as UserRole[]).map(({ role }) => role);
      }
    }
    
    // Load all roles from DB (including inherited roles)
    const roles = await this.store.resolveRoleHierarchy(roleNames, tenantId);
    
    // Convert MongoDB Role[] to BaseRole[] format for RoleResolver
    const baseRoles: BaseRole[] = roles.map(({ name, description, permissions, inherits, priority, active }) => ({
      name,
      description,
      displayName: name,
      permissions,
      inherits,
      priority,
      active: active !== false,
      context: undefined,
      metadata: undefined,
    }));
    
    // Use RoleResolver to resolve permissions (handles expiration, context, active status, inheritance)
    const roleResolver = new RoleResolver(baseRoles);
    
    // Resolve user permissions using RoleResolver (handles all edge cases)
    const resolved: ResolvedPermissions = roleResolver.resolveUserPermissions(user, {
      includeInherited: true,
      includePermissions: true,
      resolveContextRoles: true,
      maxDepth: 10,
    });
    
    // Convert ResolvedPermissions to CompiledPermissions format
    const permissions = Array.from(resolved.permissions);
    const resolvedRoles = Array.from(resolved.roles);
    const now = Date.now();

    return {
      userId,
      tenantId,
      urns: permissions, // URNs are the permissions strings
      roles: resolvedRoles,
      grants: {} as Record<string, string[]>, // Empty grants object
      denies: [] as string[], // Empty denies array
      computedAt: now,
      expiresAt: now + 300000, // 5 minutes
      permissions: [],
      matcher: (urnObj: string | URN) => {
        const urnString = typeof urnObj === 'string' 
          ? urnObj 
          : `${urnObj.resource}:${urnObj.action}:${urnObj.target}`;
        return permissions.some(u => matchUrn(u, urnString));
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
