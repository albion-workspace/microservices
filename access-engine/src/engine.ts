/**
 * access-engine - AccessEngine
 * 
 * The core authorization engine supporting:
 * - URN-based permissions
 * - Role-based access control (RBAC)
 * - Attribute-based access control (ABAC)
 * - Multi-tenancy
 * - Permission inheritance
 * - Caching
 * - Audit logging
 */

import type {
  User,
  Role,
  Permission,
  PermissionCondition,
  AccessResult,
  AccessEngineConfig,
  AuditEvent,
  TenantConfig,
} from './types.js';

import {
  parseUrn,
  matchUrn,
  matchAnyUrn,
  isValidUrn,
  normalizeUrn,
} from './urn.js';
import { RoleResolver } from './roles.js';

/**
 * Simple LRU cache implementation
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * AccessEngine - RBAC/ACL Authorization Engine
 * 
 * @example
 * ```typescript
 * const engine = new AccessEngine();
 * 
 * // Define roles
 * engine.addRole({
 *   name: 'admin',
 *   permissions: ['*:*:*'],
 * });
 * 
 * engine.addRole({
 *   name: 'user',
 *   permissions: ['profile:read:own', 'profile:update:own'],
 * });
 * 
 * // Check access
 * const user = { userId: '123', roles: ['user'], permissions: [] };
 * const result = await engine.check(user, 'profile:read:own');
 * console.log(result.allowed); // true
 * ```
 */
export class AccessEngine {
  private roles = new Map<string, Role>();
  private permissions = new Map<string, Permission>();
  private tenants = new Map<string, TenantConfig>();
  private cache: LRUCache<string, AccessResult> | null = null;
  private config: Required<AccessEngineConfig>;
  private roleResolver: RoleResolver;

  constructor(config: AccessEngineConfig = {}) {
    this.config = {
      enableCache: config.enableCache ?? true,
      cacheTtl: config.cacheTtl ?? 60000, // 1 minute
      maxCacheSize: config.maxCacheSize ?? 10000,
      defaultAllow: config.defaultAllow ?? false,
      enableAudit: config.enableAudit ?? false,
      auditLogger: config.auditLogger ?? (() => {}),
      strictMode: config.strictMode ?? false,
    };

    if (this.config.enableCache) {
      this.cache = new LRUCache(this.config.maxCacheSize);
    }
    
    // Use RoleResolver for role permission resolution
    this.roleResolver = new RoleResolver(this.roles);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Role Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add or update a role
   */
  addRole(role: Role): this {
    this.roles.set(role.name, role);
    this.roleResolver.registerRole(role); // Keep RoleResolver in sync
    this.clearCache();
    return this;
  }

  /**
   * Remove a role
   */
  removeRole(name: string): boolean {
    const deleted = this.roles.delete(name);
    if (deleted) this.clearCache();
    return deleted;
  }

  /**
   * Get a role by name
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Get all roles
   */
  getRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Check if a role exists
   */
  hasRole(name: string): boolean {
    return this.roles.has(name);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Permission Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add or update a permission definition
   */
  addPermission(permission: Permission): this {
    this.permissions.set(permission.urn, permission);
    this.clearCache();
    return this;
  }

  /**
   * Remove a permission
   */
  removePermission(urn: string): boolean {
    const deleted = this.permissions.delete(urn);
    if (deleted) this.clearCache();
    return deleted;
  }

  /**
   * Get a permission by URN
   */
  getPermission(urn: string): Permission | undefined {
    return this.permissions.get(urn);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tenant Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Configure a tenant
   */
  configureTenant(config: TenantConfig): this {
    this.tenants.set(config.tenantId, config);
    return this;
  }

  /**
   * Get tenant configuration
   */
  getTenant(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Permission Resolution
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all permissions for a role, including inherited permissions
   * Uses RoleResolver internally for consistency
   */
  getPermissionsForRole(roleName: string, visited = new Set<string>()): string[] {
    // Prevent infinite loops in circular inheritance
    if (visited.has(roleName)) return [];
    visited.add(roleName);

    const role = this.roles.get(roleName);
    if (!role) return [];

    const permissions = [...role.permissions];

    // Add inherited permissions
    if (role.inherits) {
      for (const parentRole of role.inherits) {
        permissions.push(...this.getPermissionsForRole(parentRole, visited));
      }
    }

    return [...new Set(permissions)]; // Deduplicate
  }

  /**
   * Get all permissions for a user (from roles + direct permissions)
   * Uses RoleResolver internally to avoid duplication
   * Supports both legacy format (string[]) and new format (UserRole[])
   */
  getPermissionsForUser(user: User & { roles?: any[] }): string[] {
    // Use RoleResolver for consistent permission resolution
    const resolved = this.roleResolver.resolveUserPermissions(user, {
      includeInherited: true,
      includePermissions: true,
    });
    
    return Array.from(resolved.permissions);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Access Checking
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a user has access to a resource
   * 
   * @param user - The user context
   * @param requiredUrn - The URN of the permission required
   * @param resource - Optional resource context for ABAC checks
   * @returns Access result with allowed status and reason
   */
  async check(
    user: User | null | undefined,
    requiredUrn: string,
    resource?: Record<string, unknown>
  ): Promise<AccessResult> {
    const startTime = Date.now();

    // Validate URN
    if (this.config.strictMode && !isValidUrn(requiredUrn)) {
      return this.createResult(false, 'Invalid URN format', undefined, startTime);
    }

    // Normalize URN
    const normalizedUrn = normalizeUrn(requiredUrn);

    // Check cache
    if (this.cache && !resource) {
      const cacheKey = this.getCacheKey(user, normalizedUrn);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return { ...cached, duration: Date.now() - startTime };
      }
    }

    // No user = no access (unless default allow)
    if (!user) {
      const result = this.createResult(
        this.config.defaultAllow,
        'No user context',
        undefined,
        startTime
      );
      await this.audit(user, requiredUrn, resource, result);
      return result;
    }

    // Get all user permissions
    const userPermissions = this.getPermissionsForUser(user);

    // Check for matching permission
    for (const permission of userPermissions) {
      if (matchUrn(permission, normalizedUrn)) {
        // Check ABAC conditions if defined
        const permDef = this.permissions.get(permission);
        if (permDef?.conditions && resource) {
          const conditionsMet = await this.evaluateConditions(user, permDef.conditions, resource);
          if (!conditionsMet) continue;
        }

        // Check target-specific rules
        const targetCheck = this.checkTargetAccess(user, normalizedUrn, resource);
        if (!targetCheck.allowed) continue;

        const result = this.createResult(true, 'Permission granted', permission, startTime);
        this.cacheResult(user, normalizedUrn, result);
        await this.audit(user, requiredUrn, resource, result);
        return result;
      }
    }

    // No matching permission found
    const result = this.createResult(
      this.config.defaultAllow,
      'No matching permission',
      undefined,
      startTime
    );
    this.cacheResult(user, normalizedUrn, result);
    await this.audit(user, requiredUrn, resource, result);
    return result;
  }

  /**
   * Synchronous version of check (no async conditions)
   */
  checkSync(
    user: User | null | undefined,
    requiredUrn: string,
    resource?: Record<string, unknown>
  ): AccessResult {
    const startTime = Date.now();

    if (this.config.strictMode && !isValidUrn(requiredUrn)) {
      return this.createResult(false, 'Invalid URN format', undefined, startTime);
    }

    const normalizedUrn = normalizeUrn(requiredUrn);

    if (!user) {
      return this.createResult(
        this.config.defaultAllow,
        'No user context',
        undefined,
        startTime
      );
    }

    const userPermissions = this.getPermissionsForUser(user);

    for (const permission of userPermissions) {
      if (matchUrn(permission, normalizedUrn)) {
        const targetCheck = this.checkTargetAccess(user, normalizedUrn, resource);
        if (!targetCheck.allowed) continue;

        return this.createResult(true, 'Permission granted', permission, startTime);
      }
    }

    return this.createResult(
      this.config.defaultAllow,
      'No matching permission',
      undefined,
      startTime
    );
  }

  /**
   * Check multiple permissions at once
   */
  async checkAll(
    user: User | null | undefined,
    urns: string[],
    resource?: Record<string, unknown>
  ): Promise<Map<string, AccessResult>> {
    const results = new Map<string, AccessResult>();
    
    await Promise.all(
      urns.map(async (urn) => {
        results.set(urn, await this.check(user, urn, resource));
      })
    );

    return results;
  }

  /**
   * Check if user has ANY of the specified permissions
   */
  async checkAny(
    user: User | null | undefined,
    urns: string[],
    resource?: Record<string, unknown>
  ): Promise<AccessResult> {
    const startTime = Date.now();

    for (const urn of urns) {
      const result = await this.check(user, urn, resource);
      if (result.allowed) {
        return { ...result, duration: Date.now() - startTime };
      }
    }

    return this.createResult(false, 'None of the permissions matched', undefined, startTime);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Target-specific Access
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check target-specific access rules (own, tenant, etc.)
   */
  private checkTargetAccess(
    user: User,
    urn: string,
    resource?: Record<string, unknown>
  ): AccessResult {
    const parsed = parseUrn(urn);
    
    // Wildcard target = always allow if permission matched
    if (parsed.target === '*') {
      return { allowed: true };
    }

    // "own" target = check ownership
    if (parsed.target === 'own' && resource) {
      const ownerId = resource.userId ?? resource.ownerId ?? resource.createdBy;
      if (ownerId !== user.userId) {
        return { allowed: false, reason: 'Resource not owned by user' };
      }
    }

    // "tenant" target = check tenant membership
    if (parsed.target === 'tenant' && resource) {
      const resourceTenant = resource.tenantId;
      if (resourceTenant && resourceTenant !== user.tenantId) {
        return { allowed: false, reason: 'Resource belongs to different tenant' };
      }
    }

    return { allowed: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ABAC Conditions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Evaluate ABAC conditions
   */
  private async evaluateConditions(
    user: User,
    conditions: PermissionCondition[],
    resource: Record<string, unknown>
  ): Promise<boolean> {
    for (const condition of conditions) {
      const value = this.getNestedValue(resource, condition.field);
      const matches = this.evaluateCondition(value, condition.operator, condition.value, user);
      if (!matches) return false;
    }
    return true;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    value: unknown,
    operator: PermissionCondition['operator'],
    conditionValue: unknown,
    user: User
  ): boolean {
    // Replace $user placeholders
    const resolvedCondition = this.resolveUserPlaceholders(conditionValue, user);

    switch (operator) {
      case 'eq':
        return value === resolvedCondition;
      case 'ne':
        return value !== resolvedCondition;
      case 'in':
        return Array.isArray(resolvedCondition) && resolvedCondition.includes(value);
      case 'nin':
        return Array.isArray(resolvedCondition) && !resolvedCondition.includes(value);
      case 'contains':
        return typeof value === 'string' && value.includes(String(resolvedCondition));
      case 'startsWith':
        return typeof value === 'string' && value.startsWith(String(resolvedCondition));
      case 'endsWith':
        return typeof value === 'string' && value.endsWith(String(resolvedCondition));
      case 'regex':
        return typeof value === 'string' && new RegExp(String(resolvedCondition)).test(value);
      case 'gt':
        return typeof value === 'number' && value > Number(resolvedCondition);
      case 'gte':
        return typeof value === 'number' && value >= Number(resolvedCondition);
      case 'lt':
        return typeof value === 'number' && value < Number(resolvedCondition);
      case 'lte':
        return typeof value === 'number' && value <= Number(resolvedCondition);
      default:
        return false;
    }
  }

  /**
   * Resolve $user.* placeholders in condition values
   */
  private resolveUserPlaceholders(value: unknown, user: User): unknown {
    if (typeof value === 'string' && value.startsWith('$user.')) {
      const path = value.slice(6); // Remove '$user.'
      return this.getNestedValue(user as unknown as Record<string, unknown>, path);
    }
    if (Array.isArray(value)) {
      return value.map(v => this.resolveUserPlaceholders(v, user));
    }
    return value;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Caching
  // ─────────────────────────────────────────────────────────────────────────────

  private getCacheKey(user: User | null | undefined, urn: string): string {
    const userId = user?.userId ?? 'anonymous';
    const roles = user?.roles?.join(',') ?? '';
    return `${userId}:${roles}:${urn}`;
  }

  private cacheResult(user: User | null | undefined, urn: string, result: AccessResult): void {
    if (this.cache) {
      this.cache.set(this.getCacheKey(user, urn), result);
    }
  }

  /**
   * Clear the permission cache
   */
  clearCache(): void {
    this.cache?.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } | null {
    if (!this.cache) return null;
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Audit
  // ─────────────────────────────────────────────────────────────────────────────

  private async audit(
    user: User | null | undefined,
    urn: string,
    resource: Record<string, unknown> | undefined,
    result: AccessResult
  ): Promise<void> {
    if (!this.config.enableAudit) return;

    const event: AuditEvent = {
      timestamp: new Date(),
      user: user ?? null,
      urn,
      resource,
      result,
    };

    try {
      await this.config.auditLogger(event);
    } catch {
      // Silently ignore audit errors
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private createResult(
    allowed: boolean,
    reason: string,
    matchedBy: string | undefined,
    startTime: number
  ): AccessResult {
    return {
      allowed,
      reason,
      matchedBy,
      matchedUrn: matchedBy,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Export engine state for debugging or persistence
   */
  export(): {
    roles: Role[];
    permissions: Permission[];
    tenants: TenantConfig[];
  } {
    return {
      roles: Array.from(this.roles.values()),
      permissions: Array.from(this.permissions.values()),
      tenants: Array.from(this.tenants.values()),
    };
  }

  /**
   * Import engine state
   */
  import(state: {
    roles?: Role[];
    permissions?: Permission[];
    tenants?: TenantConfig[];
  }): this {
    if (state.roles) {
      for (const role of state.roles) {
        this.addRole(role);
      }
    }
    if (state.permissions) {
      for (const permission of state.permissions) {
        this.addPermission(permission);
      }
    }
    if (state.tenants) {
      for (const tenant of state.tenants) {
        this.configureTenant(tenant);
      }
    }
    return this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new AccessEngine instance
 */
export function createAccessEngine(config?: AccessEngineConfig): AccessEngine {
  return new AccessEngine(config);
}

/**
 * Create an AccessEngine with common roles pre-configured
 */
export function createAccessEngineWithDefaults(config?: AccessEngineConfig): AccessEngine {
  const engine = new AccessEngine(config);

  // Super admin - all access
  engine.addRole({
    name: 'super_admin',
    description: 'Super administrator with full access',
    permissions: ['*:*:*'],
    priority: 1000,
  });

  // Admin - tenant-level access
  engine.addRole({
    name: 'admin',
    description: 'Administrator with tenant-level access',
    permissions: ['*:*:tenant'],
    priority: 100,
  });

  // User - own resources only
  engine.addRole({
    name: 'user',
    description: 'Standard user with access to own resources',
    permissions: [
      'profile:read:own',
      'profile:update:own',
    ],
    priority: 10,
  });

  // Guest - read-only public access
  engine.addRole({
    name: 'guest',
    description: 'Guest with minimal read access',
    permissions: [],
    priority: 1,
  });

  return engine;
}
