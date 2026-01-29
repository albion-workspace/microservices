/**
 * Access Control Store
 * 
 * MongoDB persistence layer for roles, policies, and ACL grants.
 * Provides CRUD operations with tenant isolation.
 */

// External packages
import type { Collection, Db } from 'mongodb';
import { RoleResolver, type ResolvedPermissions, type Role as BaseRole } from 'access-engine';

// Internal imports
import { generateMongoId } from '../databases/mongodb/utils.js';
import type {
  Role,
  Policy,
  ACLGrant,
  AuditLogEntry,
  CreateRoleInput,
  UpdateRoleInput,
  CreatePolicyInput,
  CreateACLGrantInput,
  ResolvedAccessConfig,
} from './types-ext.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/mongodb/strategy.js';

// ═══════════════════════════════════════════════════════════════════
// Access Store
// ═══════════════════════════════════════════════════════════════════

export interface AccessStoreOptions {
  database?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
  defaultContext?: DatabaseContext;
}

export class AccessStore {
  private config: ResolvedAccessConfig;
  private db: Db | null = null;
  private databaseStrategy: DatabaseStrategyResolver | undefined;
  private defaultContext: DatabaseContext | undefined;
  
  constructor(config: ResolvedAccessConfig, options?: AccessStoreOptions) {
    this.config = config;
    this.db = options?.database || null;
    this.databaseStrategy = options?.databaseStrategy;
    this.defaultContext = options?.defaultContext;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Database Access
  // ─────────────────────────────────────────────────────────────────
  
  private async getDb(context?: DatabaseContext): Promise<Db> {
    if (this.db) {
      return this.db;
    }
    
    if (this.databaseStrategy) {
      const resolvedContext = context || this.defaultContext;
      if (resolvedContext) {
        this.db = await this.databaseStrategy.resolve(resolvedContext);
        return this.db;
      } else {
        throw new Error('AccessStore requires database context when using databaseStrategy');
      }
    }
    
    throw new Error('AccessStore requires either database or databaseStrategy with defaultContext');
  }
  
  private buildContext(tenantId?: string): DatabaseContext | undefined {
    if (!this.databaseStrategy) return undefined;
    return {
      service: this.config.serviceName,
      ...(tenantId && { tenantId }),
      ...this.defaultContext,
    };
  }
  
  private async roles(tenantId?: string): Promise<Collection<Role>> {
    const context = this.buildContext(tenantId);
    const db = await this.getDb(context);
    return db.collection<Role>(this.config.collections.roles);
  }
  
  private async policies(tenantId?: string): Promise<Collection<Policy>> {
    const context = this.buildContext(tenantId);
    const db = await this.getDb(context);
    return db.collection<Policy>(this.config.collections.policies);
  }
  
  private async aclGrants(tenantId?: string): Promise<Collection<ACLGrant>> {
    const context = this.buildContext(tenantId);
    const db = await this.getDb(context);
    return db.collection<ACLGrant>(this.config.collections.aclGrants);
  }
  
  private async auditLog(tenantId?: string): Promise<Collection<AuditLogEntry>> {
    const context = this.buildContext(tenantId);
    const db = await this.getDb(context);
    return db.collection<AuditLogEntry>(this.config.collections.auditLog);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Role Operations
  // ─────────────────────────────────────────────────────────────────
  
  async createRole(input: CreateRoleInput, createdBy?: string): Promise<Role> {
    const now = new Date();
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const tenantId = input.tenantId || 'default';
    const role = {
      _id: objectId,
      id: idString,
      name: input.name,
      tenantId,
      description: input.description,
      inherits: input.inherits || [],
      permissions: input.permissions,
      priority: input.priority ?? 0,
      isSystem: false,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    
    const rolesCol = await this.roles(tenantId);
    await rolesCol.insertOne(role as any);
    
    if (this.config.audit.logWrites) {
      await this.logAudit({
        action: 'create',
        resource: 'role',
        resourceId: role.id,
        userId: createdBy || 'system',
        actorId: createdBy || 'system',
        actorType: createdBy ? 'user' : 'system',
        tenantId: role.tenantId,
        result: 'allowed',
        metadata: { roleName: role.name },
      }, tenantId);
    }
    
    return role;
  }
  
  async getRole(id: string, tenantId?: string): Promise<Role | null> {
    const query: Record<string, unknown> = { id };
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    const rolesCol = await this.roles(tenantId);
    return rolesCol.findOne(query);
  }
  
  async getRoleByName(name: string, tenantId: string): Promise<Role | null> {
    const rolesCol = await this.roles(tenantId);
    return rolesCol.findOne({
      name,
      $or: [{ tenantId }, { tenantId: 'default' }],
    });
  }
  
  /**
   * Get all permissions for a role (including inherited)
   * Uses access-engine's RoleResolver for safe resolution with visited set, maxDepth, and active checks
   */
  async getRolePermissions(roleName: string, tenantId: string): Promise<string[]> {
    // Load role and all inherited roles from DB
    const roles = await this.resolveRoleHierarchy([roleName], tenantId);
    if (roles.length === 0) return [];
    
    // Convert MongoDB Role[] to BaseRole[] format for RoleResolver
    const baseRoles: BaseRole[] = roles.map(({ name, description, permissions, inherits, priority, active }) => ({
      name,
      description,
      displayName: name, // Use name as displayName if not provided
      permissions,
      inherits,
      priority,
      active: active !== false, // Default to true if not set
      context: undefined, // MongoDB roles don't have context
      metadata: undefined,
    }));
    
    // Use RoleResolver for safe resolution (handles visited set, maxDepth, active checks)
    const roleResolver = new RoleResolver(baseRoles);
    
    // Use RoleResolver.resolveUserPermissions with a temporary user to get role permissions
    // This safely resolves permissions with all safety features (visited set, maxDepth, active checks)
    const testUser = {
      userId: 'temp',
      tenantId,
      roles: [roleName],
      permissions: [],
    };
    
    const userResolved = roleResolver.resolveUserPermissions(testUser, {
      includeInherited: true,
      includePermissions: true,
    });
    
    return Array.from(userResolved.permissions);
  }
  
  async listRoles(tenantId?: string): Promise<Role[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    const rolesCol = await this.roles(tenantId);
    return rolesCol.find(query).sort({ priority: -1, name: 1 }).toArray();
  }
  
  async updateRole(id: string, input: UpdateRoleInput, updatedBy?: string): Promise<Role | null> {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description;
    if (input.inherits !== undefined) update.inherits = input.inherits;
    if (input.permissions !== undefined) update.permissions = input.permissions;
    if (input.priority !== undefined) update.priority = input.priority;
    if (input.isDefault !== undefined) update.isDefault = input.isDefault;
    
    // Get role first to get tenantId for context
    const existingRole = await this.getRole(id);
    const rolesCol = await this.roles(existingRole?.tenantId);
    const result = await rolesCol.findOneAndUpdate(
      { id, isSystem: false }, // Can't update system roles
      { $set: update },
      { returnDocument: 'after' }
    );
    
    if (result && this.config.audit.logWrites) {
      await this.logAudit({
        action: 'update',
        resource: 'role',
        resourceId: id,
        userId: updatedBy || 'system',
        actorId: updatedBy || 'system',
        actorType: updatedBy ? 'user' : 'system',
        tenantId: result.tenantId,
        result: 'allowed',
        metadata: { changes: Object.keys(input) },
      }, result.tenantId);
    }
    
    return result;
  }
  
  async deleteRole(id: string, deletedBy?: string): Promise<boolean> {
    const role = await this.getRole(id);
    if (!role || role.isSystem) return false;
    
    const rolesCol = await this.roles(role.tenantId);
    const result = await rolesCol.deleteOne({ id, isSystem: false });
    
    if (result.deletedCount > 0 && this.config.audit.logWrites) {
      await this.logAudit({
        action: 'delete',
        resource: 'role',
        resourceId: id,
        userId: deletedBy || 'system',
        actorId: deletedBy || 'system',
        actorType: deletedBy ? 'user' : 'system',
        tenantId: role.tenantId,
        result: 'allowed',
        metadata: { roleName: role.name },
      }, role.tenantId);
    }
    
    return result.deletedCount > 0;
  }
  
  async getDefaultRoles(tenantId: string): Promise<Role[]> {
    const rolesCol = await this.roles(tenantId);
    return rolesCol.find({
      isDefault: true,
      $or: [{ tenantId }, { tenantId: 'default' }],
    }).toArray();
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Role Hierarchy Resolution
  // ─────────────────────────────────────────────────────────────────
  
  async resolveRoleHierarchy(roleNames: string[], tenantId: string): Promise<Role[]> {
    const resolved = new Map<string, Role>();
    const toResolve = [...roleNames];
    
    while (toResolve.length > 0) {
      const name = toResolve.shift()!;
      if (resolved.has(name)) continue;
      
      const role = await this.getRoleByName(name, tenantId);
      if (role) {
        resolved.set(name, role);
        // Add inherited roles to resolve queue
        if (role.inherits) {
          for (const inherited of role.inherits) {
            if (!resolved.has(inherited)) {
              toResolve.push(inherited);
            }
          }
        }
      }
    }
    
    return Array.from(resolved.values());
  }
  
  async getAllPermissionsForRoles(roleNames: string[], tenantId: string): Promise<string[]> {
    const roles = await this.resolveRoleHierarchy(roleNames, tenantId);
    const permissions = new Set<string>();
    
    for (const role of roles) {
      for (const permission of role.permissions) {
        permissions.add(permission);
      }
    }
    
    return Array.from(permissions);
  }
  
  async getUserRoles(userId: string, tenantId: string): Promise<Role[]> {
    // In a full implementation, this would query user-role associations
    // For now, return empty array - implement based on your user-role mapping
    return [];
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Policy Operations
  // ─────────────────────────────────────────────────────────────────
  
  async createPolicy(input: CreatePolicyInput, createdBy?: string): Promise<Policy> {
    const now = new Date();
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const policy = {
      _id: objectId,
      id: idString,
      name: input.name,
      tenantId: input.tenantId || 'default',
      // Support both singular and plural forms
      subject: input.subject,
      subjects: input.subjects || [input.subject],
      resource: input.resource,
      resources: input.resources || [input.resource],
      action: input.action,
      actions: input.actions || [input.action],
      effect: input.effect,
      priority: input.priority ?? 0,
      conditions: input.conditions,
      description: input.description,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    
    const tenantId = input.tenantId || 'default';
    const policiesCol = await this.policies(tenantId);
    await policiesCol.insertOne(policy as any);
    
    if (this.config.audit.logWrites) {
      await this.logAudit({
        action: 'create',
        resource: 'policy',
        resourceId: policy.id,
        userId: createdBy || 'system',
        actorId: createdBy || 'system',
        actorType: createdBy ? 'user' : 'system',
        tenantId: policy.tenantId,
        result: 'allowed',
        metadata: { policyName: policy.name, effect: policy.effect },
      }, tenantId);
    }
    
    return policy;
  }
  
  async getPolicy(id: string): Promise<Policy | null> {
    const policy = await this.listPolicies().then(policies => policies.find(p => p.id === id));
    if (policy) {
      const policiesCol = await this.policies(policy.tenantId);
      return policiesCol.findOne({ id });
    }
    // Try with default context if no tenantId found
    const policiesCol = await this.policies();
    return policiesCol.findOne({ id });
  }
  
  async listPolicies(tenantId?: string, resource?: string): Promise<Policy[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    if (resource) {
      query.resource = resource;
    }
    const policiesCol = await this.policies(tenantId);
    return policiesCol.find(query).sort({ priority: -1 }).toArray();
  }
  
  async getPoliciesForSubject(
    subjectType: 'role' | 'user' | 'any',
    subjectValue: string,
    tenantId: string
  ): Promise<Policy[]> {
    const policiesCol = await this.policies(tenantId);
    return policiesCol.find({
      isActive: true,
      $and: [
        { $or: [{ tenantId }, { tenantId: 'default' }] },
        { $or: [
          { 'subject.type': 'any' },
          { 'subject.type': subjectType, 'subject.value': subjectValue },
        ]},
      ],
    }).sort({ priority: -1 }).toArray();
  }
  
  async getPoliciesForUser(
    userId: string,
    roleNames: string[],
    tenantId: string
  ): Promise<Policy[]> {
    const policiesCol = await this.policies(tenantId);
    return policiesCol.find({
      isActive: true,
      $and: [
        { $or: [{ tenantId }, { tenantId: 'default' }] },
        { $or: [
          { 'subject.type': 'any' },
          { 'subject.type': 'user', 'subject.value': userId },
          { 'subject.type': 'role', 'subject.value': { $in: roleNames } },
        ]},
      ],
    }).sort({ priority: -1 }).toArray();
  }
  
  async updatePolicy(
    id: string,
    input: Partial<CreatePolicyInput> & { isActive?: boolean },
    updatedBy?: string
  ): Promise<Policy | null> {
    const existingPolicy = await this.getPolicy(id);
    const tenantId = existingPolicy?.tenantId;
    
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) update.name = input.name;
    if (input.subject !== undefined) update.subject = input.subject;
    if (input.resource !== undefined) update.resource = input.resource;
    if (input.action !== undefined) update.action = input.action;
    if (input.effect !== undefined) update.effect = input.effect;
    if (input.priority !== undefined) update.priority = input.priority;
    if (input.conditions !== undefined) update.conditions = input.conditions;
    if (input.description !== undefined) update.description = input.description;
    if (input.isActive !== undefined) update.isActive = input.isActive;
    
    const policiesCol = await this.policies(tenantId);
    const result = await policiesCol.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after' }
    );
    
    if (result && this.config.audit.logWrites) {
      await this.logAudit({
        action: 'update',
        resource: 'policy',
        resourceId: id,
        userId: updatedBy || 'system',
        actorId: updatedBy || 'system',
        actorType: updatedBy ? 'user' : 'system',
        tenantId: result.tenantId,
        result: 'allowed',
        metadata: { changes: Object.keys(input) },
      }, result.tenantId);
    }
    
    return result;
  }
  
  async deletePolicy(id: string, deletedBy?: string): Promise<boolean> {
    const policy = await this.getPolicy(id);
    if (!policy) return false;
    
    const policiesCol = await this.policies(policy.tenantId);
    const result = await policiesCol.deleteOne({ id });
    
    if (result.deletedCount > 0 && this.config.audit.logWrites) {
      await this.logAudit({
        action: 'delete',
        resource: 'policy',
        resourceId: id,
        userId: deletedBy || 'system',
        actorId: deletedBy || 'system',
        actorType: deletedBy ? 'user' : 'system',
        tenantId: policy.tenantId,
        result: 'allowed',
        metadata: { policyName: policy.name },
      }, policy.tenantId);
    }
    
    return result.deletedCount > 0;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // ACL Grant Operations
  // ─────────────────────────────────────────────────────────────────
  
  async createACLGrant(input: CreateACLGrantInput, grantedBy: string): Promise<ACLGrant> {
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const grant = {
      _id: objectId,
      id: idString,
      tenantId: input.tenantId || 'default',
      userId: input.userId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permissions: input.permissions,
      actions: input.actions,
      expiresAt: input.expiresAt,
      grantedBy,
      reason: input.reason,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    const tenantId = input.tenantId || 'default';
    const aclGrantsCol = await this.aclGrants(tenantId);
    await aclGrantsCol.insertOne(grant as any);
    
    if (this.config.audit.logWrites) {
      await this.logAudit({
        action: 'grant',
        resource: input.resourceType,
        resourceId: input.resourceId,
        userId: grantedBy,
        actorId: grantedBy,
        actorType: 'user',
        tenantId: grant.tenantId,
        result: 'allowed',
        metadata: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          actions: input.actions,
          reason: input.reason,
        },
      }, tenantId);
    }
    
    return grant;
  }
  
  async getACLGrant(id: string): Promise<ACLGrant | null> {
    // Try to find grant by listing all and filtering
    const grants = await this.listACLGrants();
    const grant = grants.find(g => g.id === id);
    if (grant) {
      const aclGrantsCol = await this.aclGrants(grant.tenantId);
      return aclGrantsCol.findOne({ id });
    }
    const aclGrantsCol = await this.aclGrants();
    return aclGrantsCol.findOne({ id });
  }
  
  async listACLGrants(
    tenantId?: string,
    resourceType?: string,
    resourceId?: string
  ): Promise<ACLGrant[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) query.tenantId = tenantId;
    if (resourceType) query.resourceType = resourceType;
    if (resourceId) query.resourceId = resourceId;
    
    // Filter out expired grants (not expired or no expiry set)
    query.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ];
    
    const aclGrantsCol = await this.aclGrants(tenantId);
    return aclGrantsCol.find(query).toArray();
  }
  
  async getACLGrantsForSubject(
    subjectType: 'user' | 'role' | 'group',
    subjectId: string,
    tenantId: string
  ): Promise<ACLGrant[]> {
    const aclGrantsCol = await this.aclGrants(tenantId);
    return aclGrantsCol.find({
      tenantId,
      subjectType,
      subjectId,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    }).toArray();
  }
  
  async getACLGrantsForUser(
    userId: string,
    roleNames: string[],
    tenantId: string
  ): Promise<ACLGrant[]> {
    const aclGrantsCol = await this.aclGrants(tenantId);
    return aclGrantsCol.find({
      tenantId,
      $and: [
        { $or: [
          { subjectType: 'user' as const, subjectId: userId },
          { subjectType: 'role' as const, subjectId: { $in: roleNames } },
        ]},
        { $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ]},
      ],
    }).toArray();
  }
  
  async revokeACLGrant(id: string, revokedBy: string): Promise<boolean> {
    const grant = await this.getACLGrant(id);
    if (!grant) return false;
    
    const aclGrantsCol = await this.aclGrants(grant.tenantId);
    const result = await aclGrantsCol.deleteOne({ id });
    
    if (result.deletedCount > 0 && this.config.audit.logWrites) {
      await this.logAudit({
        action: 'revoke',
        resource: grant.resourceType,
        resourceId: grant.resourceId,
        userId: revokedBy,
        actorId: revokedBy,
        actorType: 'user',
        tenantId: grant.tenantId,
        result: 'allowed',
        metadata: {
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          actions: grant.actions,
        },
      }, grant.tenantId);
    }
    
    return result.deletedCount > 0;
  }
  
  async cleanupExpiredGrants(tenantId?: string): Promise<number> {
    const aclGrantsCol = await this.aclGrants(tenantId);
    const result = await aclGrantsCol.deleteMany({
      expiresAt: { $lt: new Date() },
    });
    return result.deletedCount;
  }
  
  // Aliases for GraphQL resolvers
  async grantAccess(input: CreateACLGrantInput): Promise<ACLGrant> {
    return this.createACLGrant(input, input.userId);
  }
  
  async revokeAccess(grantId: string): Promise<boolean> {
    return this.revokeACLGrant(grantId, 'system');
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Audit Logging
  // ─────────────────────────────────────────────────────────────────
  
  private async logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>, tenantId?: string): Promise<void> {
    if (!this.config.audit.enabled) return;
    
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const auditCol = await this.auditLog(tenantId || entry.tenantId);
    await auditCol.insertOne({
      _id: objectId,
      id: idString,
      timestamp: new Date(),
      ...entry,
    } as any);
  }
  
  async logAccessCheck(
    tenantId: string,
    actorId: string,
    resource: string,
    resourceId: string | undefined,
    allowed: boolean,
    reason: string
  ): Promise<void> {
    if (!this.config.audit.enabled || !this.config.audit.logReads) return;
    
    await this.logAudit({
      action: 'check',
      resource,
      resourceId: resourceId || resource,
      userId: actorId,
      actorId,
      actorType: 'user',
      tenantId,
      result: allowed ? 'allowed' : 'denied',
      reason,
    }, tenantId);
  }
  
  async getAuditLog(
    tenantId: string,
    options?: {
      action?: string;
      resource?: string;
      actorId?: string;
      limit?: number;
      since?: Date;
    }
  ): Promise<AuditLogEntry[]> {
    const query: Record<string, unknown> = { tenantId };
    if (options?.action) query.action = options.action;
    if (options?.resource) query.resource = options.resource;
    if (options?.actorId) query.actorId = options.actorId;
    if (options?.since) query.timestamp = { $gte: options.since };
    
    const auditCol = await this.auditLog(tenantId);
    return auditCol
      .find(query)
      .sort({ timestamp: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────
  
  async initialize(): Promise<void> {
    // Create indexes (use default context)
    const rolesCol = await this.roles();
    await rolesCol.createIndex({ name: 1, tenantId: 1 }, { unique: true });
    await rolesCol.createIndex({ tenantId: 1 });
    await rolesCol.createIndex({ isDefault: 1 });
    
    const policiesCol = await this.policies();
    await policiesCol.createIndex({ tenantId: 1 });
    await policiesCol.createIndex({ 'subject.type': 1, 'subject.value': 1 });
    await policiesCol.createIndex({ resource: 1, action: 1 });
    await policiesCol.createIndex({ isActive: 1 });
    
    const aclGrantsCol = await this.aclGrants();
    await aclGrantsCol.createIndex({ tenantId: 1 });
    await aclGrantsCol.createIndex({ subjectType: 1, subjectId: 1 });
    await aclGrantsCol.createIndex({ resourceType: 1, resourceId: 1 });
    await aclGrantsCol.createIndex({ expiresAt: 1 });
    
    const auditCol = await this.auditLog();
    await auditCol.createIndex({ tenantId: 1, timestamp: -1 });
    await auditCol.createIndex({ actorId: 1 });
    await auditCol.createIndex({ resource: 1 });
    
    // Create default roles
    if (this.config.defaultRoles) {
      for (const roleInput of this.config.defaultRoles) {
        const existing = await this.getRoleByName(roleInput.name, roleInput.tenantId || 'default');
        if (!existing) {
          await this.createRole({
            ...roleInput,
            tenantId: roleInput.tenantId || 'default',
          }, 'system');
        }
      }
    }
    
    // Create default policies
    if (this.config.defaultPolicies) {
      for (const policyInput of this.config.defaultPolicies) {
        const policiesCol = await this.policies();
        const existing = await policiesCol.findOne({
          name: policyInput.name,
          tenantId: policyInput.tenantId || 'default',
        });
        if (!existing) {
          await this.createPolicy({
            ...policyInput,
            tenantId: policyInput.tenantId || 'default',
          }, 'system');
        }
      }
    }
  }
}

