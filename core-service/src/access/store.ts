/**
 * Access Control Store
 * 
 * MongoDB persistence layer for roles, policies, and ACL grants.
 * Provides CRUD operations with tenant isolation.
 */

import type { Collection, Db } from 'mongodb';
import { getDatabase } from '../common/database.js';
import { generateMongoId } from '../common/mongodb-utils.js';
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

// ═══════════════════════════════════════════════════════════════════
// Access Store
// ═══════════════════════════════════════════════════════════════════

export class AccessStore {
  private config: ResolvedAccessConfig;
  private db: Db | null = null;
  
  constructor(config: ResolvedAccessConfig) {
    this.config = config;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Database Access
  // ─────────────────────────────────────────────────────────────────
  
  private getDb(): Db {
    if (!this.db) {
      this.db = getDatabase();
    }
    return this.db;
  }
  
  private roles(): Collection<Role> {
    return this.getDb().collection<Role>(this.config.collections.roles);
  }
  
  private policies(): Collection<Policy> {
    return this.getDb().collection<Policy>(this.config.collections.policies);
  }
  
  private aclGrants(): Collection<ACLGrant> {
    return this.getDb().collection<ACLGrant>(this.config.collections.aclGrants);
  }
  
  private auditLog(): Collection<AuditLogEntry> {
    return this.getDb().collection<AuditLogEntry>(this.config.collections.auditLog);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Role Operations
  // ─────────────────────────────────────────────────────────────────
  
  async createRole(input: CreateRoleInput, createdBy?: string): Promise<Role> {
    const now = new Date();
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const role = {
      _id: objectId,
      id: idString,
      name: input.name,
      tenantId: input.tenantId || 'default',
      description: input.description,
      inherits: input.inherits || [],
      permissions: input.permissions,
      priority: input.priority ?? 0,
      isSystem: false,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    
    await this.roles().insertOne(role as any);
    return role as Role;
    
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
      });
    }
    
    return role;
  }
  
  async getRole(id: string, tenantId?: string): Promise<Role | null> {
    const query: Record<string, unknown> = { id };
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    return this.roles().findOne(query);
  }
  
  async getRoleByName(name: string, tenantId: string): Promise<Role | null> {
    return this.roles().findOne({
      name,
      $or: [{ tenantId }, { tenantId: 'default' }],
    });
  }
  
  /**
   * Get all permissions for a role (including inherited)
   */
  async getRolePermissions(roleName: string, tenantId: string): Promise<string[]> {
    const role = await this.getRoleByName(roleName, tenantId);
    if (!role) return [];
    
    const permissions = new Set<string>(role.permissions);
    
    // Add inherited permissions
    if (role.inherits) {
      for (const inheritedRoleName of role.inherits) {
        const inheritedPerms = await this.getRolePermissions(inheritedRoleName, tenantId);
        for (const perm of inheritedPerms) {
          permissions.add(perm);
        }
      }
    }
    
    return Array.from(permissions);
  }
  
  async listRoles(tenantId?: string): Promise<Role[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    return this.roles().find(query).sort({ priority: -1, name: 1 }).toArray();
  }
  
  async updateRole(id: string, input: UpdateRoleInput, updatedBy?: string): Promise<Role | null> {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description;
    if (input.inherits !== undefined) update.inherits = input.inherits;
    if (input.permissions !== undefined) update.permissions = input.permissions;
    if (input.priority !== undefined) update.priority = input.priority;
    if (input.isDefault !== undefined) update.isDefault = input.isDefault;
    
    const result = await this.roles().findOneAndUpdate(
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
      });
    }
    
    return result;
  }
  
  async deleteRole(id: string, deletedBy?: string): Promise<boolean> {
    const role = await this.getRole(id);
    if (!role || role.isSystem) return false;
    
    const result = await this.roles().deleteOne({ id, isSystem: false });
    
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
      });
    }
    
    return result.deletedCount > 0;
  }
  
  async getDefaultRoles(tenantId: string): Promise<Role[]> {
    return this.roles().find({
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
    
    await this.policies().insertOne(policy as any);
    return policy as Policy;
    
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
      });
    }
    
    return policy;
  }
  
  async getPolicy(id: string): Promise<Policy | null> {
    return this.policies().findOne({ id });
  }
  
  async listPolicies(tenantId?: string, resource?: string): Promise<Policy[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: 'default' }];
    }
    if (resource) {
      query.resource = resource;
    }
    return this.policies().find(query).sort({ priority: -1 }).toArray();
  }
  
  async getPoliciesForSubject(
    subjectType: 'role' | 'user' | 'any',
    subjectValue: string,
    tenantId: string
  ): Promise<Policy[]> {
    return this.policies().find({
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
    return this.policies().find({
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
    
    const result = await this.policies().findOneAndUpdate(
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
      });
    }
    
    return result;
  }
  
  async deletePolicy(id: string, deletedBy?: string): Promise<boolean> {
    const policy = await this.getPolicy(id);
    if (!policy) return false;
    
    const result = await this.policies().deleteOne({ id });
    
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
      });
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
    
    await this.aclGrants().insertOne(grant as any);
    return grant as ACLGrant;
    
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
      });
    }
    
    return grant;
  }
  
  async getACLGrant(id: string): Promise<ACLGrant | null> {
    return this.aclGrants().findOne({ id });
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
    
    return this.aclGrants().find(query).toArray();
  }
  
  async getACLGrantsForSubject(
    subjectType: 'user' | 'role' | 'group',
    subjectId: string,
    tenantId: string
  ): Promise<ACLGrant[]> {
    return this.aclGrants().find({
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
    return this.aclGrants().find({
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
    
    const result = await this.aclGrants().deleteOne({ id });
    
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
      });
    }
    
    return result.deletedCount > 0;
  }
  
  async cleanupExpiredGrants(): Promise<number> {
    const result = await this.aclGrants().deleteMany({
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
  
  private async logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    if (!this.config.audit.enabled) return;
    
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    await this.auditLog().insertOne({
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
    });
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
    
    return this.auditLog()
      .find(query)
      .sort({ timestamp: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────
  
  async initialize(): Promise<void> {
    // Create indexes
    await this.roles().createIndex({ name: 1, tenantId: 1 }, { unique: true });
    await this.roles().createIndex({ tenantId: 1 });
    await this.roles().createIndex({ isDefault: 1 });
    
    await this.policies().createIndex({ tenantId: 1 });
    await this.policies().createIndex({ 'subject.type': 1, 'subject.value': 1 });
    await this.policies().createIndex({ resource: 1, action: 1 });
    await this.policies().createIndex({ isActive: 1 });
    
    await this.aclGrants().createIndex({ tenantId: 1 });
    await this.aclGrants().createIndex({ subjectType: 1, subjectId: 1 });
    await this.aclGrants().createIndex({ resourceType: 1, resourceId: 1 });
    await this.aclGrants().createIndex({ expiresAt: 1 });
    
    await this.auditLog().createIndex({ tenantId: 1, timestamp: -1 });
    await this.auditLog().createIndex({ actorId: 1 });
    await this.auditLog().createIndex({ resource: 1 });
    
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
        const existing = await this.policies().findOne({
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

