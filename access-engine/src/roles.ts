/**
 * access-engine - Roles
 * 
 * Graph-based role resolution with context support and hierarchical inheritance.
 */

import type {
  User,
  Role,
  UserRole,
  RoleContext,
  ResolvedPermissions,
  RoleResolutionOptions,
} from './types.js';
import { matchUrn } from './urn.js';

/**
 * Role Resolver for graph-based role resolution
 */
export class RoleResolver {
  private roles: Map<string, Role>;
  
  constructor(roles: Map<string, Role> | Role[] = new Map()) {
    if (Array.isArray(roles)) {
      this.roles = new Map(roles.map(r => [r.name, r]));
    } else {
      this.roles = roles;
    }
  }
  
  /**
   * Register a role definition
   */
  registerRole(role: Role): void {
    this.roles.set(role.name, role);
  }
  
  /**
   * Resolve all effective roles and permissions for a user
   */
  resolveUserPermissions(
    user: User & { roles?: UserRole[] | string[] },
    options: RoleResolutionOptions = {}
  ): ResolvedPermissions {
    const {
      context,
      includeInherited = true,
      includePermissions = true,
      resolveContextRoles = true,
      maxDepth = 10,
    } = options;
    
    const resolved: ResolvedPermissions = {
      permissions: new Set<string>(),
      roles: new Set<string>(),
      contextRoles: new Map<RoleContext, Set<string>>(),
      hasWildcard: false,
    };
    
    // Handle both legacy format (string[]) and new format (UserRole[])
    const userRoles: UserRole[] = this.normalizeUserRoles(user.roles || []);
    
    // Add direct permissions
    if (includePermissions && user.permissions) {
      for (const perm of user.permissions) {
        resolved.permissions.add(perm);
        if (perm === '*:*:*') {
          resolved.hasWildcard = true;
        }
      }
    }
    
    // Process user roles
    for (const userRole of userRoles) {
      if (!userRole.active) {
        continue;
      }
      
      // Check if role is expired
      if (userRole.expiresAt && userRole.expiresAt < new Date()) {
        continue;
      }
      
      // Filter by context if specified
      if (context && userRole.context && userRole.context !== context) {
        continue;
      }
      
      // Add role
      const roleName = userRole.role;
      resolved.roles.add(roleName);
      
      // Add to context-specific roles
      if (resolveContextRoles && userRole.context) {
        if (!resolved.contextRoles.has(userRole.context)) {
          resolved.contextRoles.set(userRole.context, new Set());
        }
        resolved.contextRoles.get(userRole.context)!.add(roleName);
      }
      
      // Resolve role definition and inherit permissions
      if (includePermissions && includeInherited) {
        this.resolveRolePermissions(roleName, resolved, new Set(), maxDepth);
      }
    }
    
    return resolved;
  }
  
  /**
   * Recursively resolve role permissions including inheritance
   */
  private resolveRolePermissions(
    roleName: string,
    resolved: ResolvedPermissions,
    visited: Set<string>,
    maxDepth: number
  ): void {
    if (visited.has(roleName) || maxDepth <= 0) {
      return;
    }
    
    visited.add(roleName);
    const roleDef = this.roles.get(roleName);
    
    if (!roleDef || roleDef.active === false) {
      return;
    }
    
    // Add direct permissions from this role
    if (roleDef.permissions) {
      for (const perm of roleDef.permissions) {
        resolved.permissions.add(perm);
        if (perm === '*:*:*') {
          resolved.hasWildcard = true;
        }
      }
    }
    
    // Recursively resolve parent roles
    if (roleDef.inherits) {
      for (const parentRole of roleDef.inherits) {
        this.resolveRolePermissions(parentRole, resolved, visited, maxDepth - 1);
      }
    }
  }
  
  /**
   * Normalize user roles to UserRole[] format
   */
  private normalizeUserRoles(roles: UserRole[] | string[]): UserRole[] {
    if (roles.length === 0) {
      return [];
    }
    
    // Check if it's legacy format (string[])
    if (typeof roles[0] === 'string') {
      return (roles as string[]).map((role) => ({
        role,
        assignedAt: new Date(),
        active: true,
      }));
    }
    
    return roles as UserRole[];
  }
  
  /**
   * Check if user has a specific permission
   * Uses matchUrn from urn.ts for proper wildcard matching
   */
  hasPermission(
    user: User & { roles?: UserRole[] | string[] },
    permission: string,
    context?: RoleContext
  ): boolean {
    const resolved = this.resolveUserPermissions(user, {
      context,
      includeInherited: true,
      includePermissions: true,
    });
    
    // Wildcard permission grants everything
    if (resolved.hasWildcard) {
      return true;
    }
    
    // Use matchUrn to check all permissions (handles wildcards properly)
    for (const userPermission of resolved.permissions) {
      if (matchUrn(userPermission, permission)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if user has a specific role
   */
  hasRole(
    user: User & { roles?: UserRole[] | string[] },
    role: string,
    context?: RoleContext
  ): boolean {
    const resolved = this.resolveUserPermissions(user, {
      context,
      includeInherited: true,
      includePermissions: false,
    });
    
    return resolved.roles.has(role);
  }
  
  /**
   * Check if user has any of the specified roles
   */
  hasAnyRole(
    user: User & { roles?: UserRole[] | string[] },
    roles: string[],
    context?: RoleContext
  ): boolean {
    const resolved = this.resolveUserPermissions(user, {
      context,
      includeInherited: true,
      includePermissions: false,
    });
    
    for (const role of roles) {
      if (resolved.roles.has(role)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get role definition
   */
  getRoleDefinition(roleName: string): Role | undefined {
    return this.roles.get(roleName);
  }
  
  /**
   * Get all registered roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }
}
