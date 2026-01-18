/**
 * Role Service
 * 
 * Handles graph-based role resolution, permission checking, and role management.
 * Supports context-based roles and hierarchical role inheritance.
 */

import { getDatabase, logger } from 'core-service';
import type {
  RoleDefinition,
  UserRole,
  RoleContext,
  RoleName,
  PermissionName,
  RoleGraph,
  ResolvedPermissions,
  RoleResolutionOptions,
  AssignRoleInput,
  RevokeRoleInput,
  PermissionCheckInput,
} from '../types/role-types.js';
import type { User } from '../types/user-types.js';

/**
 * Role Service for managing graph-based roles and permissions
 */
export class RoleService {
  private roleGraph: RoleGraph;
  
  constructor(initialRoles?: RoleDefinition[], initialPermissions?: any[]) {
    this.roleGraph = {
      roles: new Map(),
      permissions: new Map(),
    };
    
    // Initialize with provided roles and permissions
    if (initialRoles) {
      for (const role of initialRoles) {
        this.roleGraph.roles.set(role.name, role);
      }
    }
    
    if (initialPermissions) {
      for (const perm of initialPermissions) {
        this.roleGraph.permissions.set(perm.name, perm);
      }
    }
  }
  
  /**
   * Register a role definition
   */
  registerRole(role: RoleDefinition): void {
    this.roleGraph.roles.set(role.name, role);
    logger.info('Role registered', { role: role.name, context: role.context });
  }
  
  /**
   * Register a permission definition
   */
  registerPermission(permission: any): void {
    this.roleGraph.permissions.set(permission.name, permission);
    logger.info('Permission registered', { permission: permission.name });
  }
  
  /**
   * Resolve all effective roles and permissions for a user
   */
  resolveUserPermissions(
    user: User,
    options: RoleResolutionOptions = {}
  ): ResolvedPermissions {
    // Convert User to access-engine User format
    const accessEngineUser = {
      userId: user.id || (user._id ? user._id.toString() : ''),
      tenantId: user.tenantId,
      roles: user.roles || [],
      permissions: user.permissions || [],
      metadata: user.metadata,
    };
    
    // Use access-engine's RoleResolver
    return this.roleResolver.resolveUserPermissions(accessEngineUser, options);
  }
  
  /**
   * Check if user has a specific permission
   * Delegates to access-engine's RoleResolver
   */
  hasPermission(
    user: User,
    permission: string,
    context?: RoleContext
  ): boolean {
    const accessEngineUser = {
      userId: user.id || (user._id ? user._id.toString() : ''),
      tenantId: user.tenantId,
      roles: user.roles || [],
      permissions: user.permissions || [],
      metadata: user.metadata,
    };
    
    return this.roleResolver.hasPermission(accessEngineUser, permission, context);
  }
  
  /**
   * Check if user has a specific role
   * Delegates to access-engine's RoleResolver
   */
  hasRole(
    user: User,
    role: string,
    context?: RoleContext
  ): boolean {
    const accessEngineUser = {
      userId: user.id || (user._id ? user._id.toString() : ''),
      tenantId: user.tenantId,
      roles: user.roles || [],
      permissions: user.permissions || [],
      metadata: user.metadata,
    };
    
    return this.roleResolver.hasRole(accessEngineUser, role, context);
  }
  
  /**
   * Check if user has any of the specified roles
   * Delegates to access-engine's RoleResolver
   */
  hasAnyRole(
    user: User,
    roles: string[],
    context?: RoleContext
  ): boolean {
    const accessEngineUser = {
      userId: user.id || (user._id ? user._id.toString() : ''),
      tenantId: user.tenantId,
      roles: user.roles || [],
      permissions: user.permissions || [],
      metadata: user.metadata,
    };
    
    return this.roleResolver.hasAnyRole(accessEngineUser, roles, context);
  }
  
  /**
   * Assign a role to a user (auth-service specific implementation)
   */
  async assignRole(input: AssignRoleInput): Promise<UserRole> {
    const db = getDatabase();
    const now = new Date();
    
    // Verify role exists in resolver
    const roleDef = this.roleResolver.getRoleDefinition(input.role);
    if (!roleDef) {
      throw new Error(`Role "${input.role}" not found`);
    }
    
    // Create role assignment
    const userRole: UserRole = {
      role: input.role,
      context: input.context,
      assignedAt: now,
      assignedBy: input.assignedBy,
      expiresAt: input.expiresAt,
      active: true,
      metadata: input.metadata,
    };
    
    // Update user document
    const usersCollection = db.collection('users');
    const userId = input.userId;
    const tenantId = input.tenantId;
    
    // Check if role already exists for this context
    const user = await usersCollection.findOne({ id: userId, tenantId }) as any;
    if (user) {
      const existingRoleIndex = (user.roles || []).findIndex(
        (r: UserRole) => r.role === input.role && r.context === input.context
      );
      
      if (existingRoleIndex >= 0) {
        // Update existing role
        const update = {
          [`roles.${existingRoleIndex}`]: userRole,
          updatedAt: now,
        };
        await usersCollection.updateOne(
          { id: userId, tenantId },
          { $set: update }
        );
      } else {
        // Add new role
        await usersCollection.updateOne(
          { id: userId, tenantId },
          {
            $push: { roles: userRole },
            $set: { updatedAt: now },
          }
        );
      }
    } else {
      throw new Error(`User "${userId}" not found`);
    }
    
    logger.info('Role assigned', {
      userId,
      role: input.role,
      context: input.context,
    });
    
    return userRole;
  }
  
  /**
   * Revoke a role from a user
   */
  async revokeRole(input: RevokeRoleInput): Promise<void> {
    const db = getDatabase();
    const now = new Date();
    
    const usersCollection = db.collection('users');
    const userId = input.userId;
    const tenantId = input.tenantId;
    
    // Find user
    const user = await usersCollection.findOne({ id: userId, tenantId }) as any;
    if (!user) {
      throw new Error(`User "${userId}" not found`);
    }
    
    // Remove role
    const roles = (user.roles || []).filter(
      (r: UserRole) => !(r.role === input.role && r.context === input.context)
    );
    
    await usersCollection.updateOne(
      { id: userId, tenantId },
      {
        $set: {
          roles,
          updatedAt: now,
        },
      }
    );
    
    logger.info('Role revoked', {
      userId,
      role: input.role,
      context: input.context,
      revokedBy: input.revokedBy,
    });
  }
  
  /**
   * Get role definition
   */
  getRoleDefinition(roleName: string): Role | undefined {
    return this.roleResolver.getRoleDefinition(roleName);
  }
  
  /**
   * Get all registered roles
   */
  getAllRoles(): Role[] {
    return this.roleResolver.getAllRoles();
  }
  
  /**
   * Get all registered permissions
   */
  getAllPermissions(): any[] {
    return Array.from(this.roleGraph.permissions.values());
  }
}
