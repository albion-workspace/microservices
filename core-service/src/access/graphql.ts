/**
 * Access Control GraphQL Schema and Resolvers
 * 
 * Provides GraphQL API for managing roles, policies, and ACL grants.
 */

import type { AccessEngine } from 'access-engine';
import type { ResolverContext } from '../types/resolvers.js';
import type { AccessStore } from './store.js';
import type { AccessCache } from './cache.js';

// ═══════════════════════════════════════════════════════════════════
// GraphQL Type Definitions
// ═══════════════════════════════════════════════════════════════════

export const accessGraphQLTypes = `
  # ═══════════════════════════════════════════════════════════════════
  # Role Types
  # ═══════════════════════════════════════════════════════════════════
  
  type Role {
    id: ID!
    name: String!
    tenantId: String!
    description: String
    inherits: [String!]!
    permissions: [String!]!
    priority: Int!
    isSystem: Boolean!
    isDefault: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  
  input CreateRoleInput {
    name: String!
    tenantId: String
    description: String
    inherits: [String!]
    permissions: [String!]!
    priority: Int
    isDefault: Boolean
  }
  
  input UpdateRoleInput {
    name: String
    description: String
    inherits: [String!]
    permissions: [String!]
    priority: Int
    isDefault: Boolean
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Policy Types
  # ═══════════════════════════════════════════════════════════════════
  
  type Policy {
    id: ID!
    name: String!
    tenantId: String!
    subject: PolicySubject!
    resource: String!
    action: String!
    effect: PolicyEffect!
    conditions: [PolicyCondition!]
    priority: Int!
    isActive: Boolean!
    description: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  
  type PolicySubject {
    type: SubjectType!
    value: String!
  }
  
  input PolicySubjectInput {
    type: SubjectType!
    value: String!
  }
  
  type PolicyCondition {
    field: String!
    operator: ConditionOperator!
    value: JSON
  }
  
  input PolicyConditionInput {
    field: String!
    operator: ConditionOperator!
    value: JSON
  }
  
  enum PolicyEffect {
    allow
    deny
  }
  
  enum SubjectType {
    role
    user
    any
  }
  
  enum ConditionOperator {
    eq
    neq
    gt
    gte
    lt
    lte
    in
    nin
    contains
    match
    exists
  }
  
  input CreatePolicyInput {
    name: String!
    tenantId: String
    subject: PolicySubjectInput!
    resource: String!
    action: String!
    effect: PolicyEffect!
    priority: Int
    conditions: [PolicyConditionInput!]
    description: String
  }
  
  input UpdatePolicyInput {
    name: String
    subject: PolicySubjectInput
    resource: String
    action: String
    effect: PolicyEffect
    priority: Int
    conditions: [PolicyConditionInput!]
    description: String
    isActive: Boolean
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # ACL Grant Types
  # ═══════════════════════════════════════════════════════════════════
  
  type ACLGrant {
    id: ID!
    tenantId: String!
    subjectType: ACLSubjectType!
    subjectId: String!
    resourceType: String!
    resourceId: String!
    actions: [String!]!
    expiresAt: DateTime
    grantedBy: String!
    reason: String
    createdAt: DateTime!
  }
  
  enum ACLSubjectType {
    user
    role
    group
  }
  
  input GrantAccessInput {
    tenantId: String
    subjectType: ACLSubjectType!
    subjectId: String!
    resourceType: String!
    resourceId: String!
    actions: [String!]!
    expiresAt: DateTime
    reason: String
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Access Check Types
  # ═══════════════════════════════════════════════════════════════════
  
  type AccessCheckResult {
    allowed: Boolean!
    reason: String!
    matchedUrn: String
    matchedPolicy: String
    matchedGrant: String
    evaluationTimeMs: Int!
  }
  
  type MyPermissions {
    userId: String!
    tenantId: String!
    roles: [String!]!
    permissions: [String!]!
    grants: [GrantInfo!]!
  }
  
  type GrantInfo {
    resourceType: String!
    resourceId: String!
    actions: [String!]!
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Audit Types
  # ═══════════════════════════════════════════════════════════════════
  
  type AuditLogEntry {
    id: ID!
    timestamp: DateTime!
    tenantId: String!
    actorId: String!
    actorType: String!
    action: String!
    resource: String!
    resourceId: String
    allowed: Boolean
    reason: String
    metadata: JSON
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Cache Stats
  # ═══════════════════════════════════════════════════════════════════
  
  type AccessCacheStats {
    memoryCacheSize: Int!
    validEntries: Int!
    expiredEntries: Int!
    maxSize: Int!
    ttlSeconds: Int!
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Query Extensions
  # ═══════════════════════════════════════════════════════════════════
  
  extend type Query {
    # Roles
    roles(tenantId: String): [Role!]!
    role(id: ID!): Role
    roleByName(name: String!, tenantId: String!): Role
    
    # Policies
    policies(tenantId: String, resource: String): [Policy!]!
    policy(id: ID!): Policy
    
    # ACL Grants
    aclGrants(tenantId: String, resourceType: String, resourceId: String): [ACLGrant!]!
    aclGrant(id: ID!): ACLGrant
    
    # Self-service
    myPermissions: MyPermissions!
    checkAccess(resource: String!, action: String!, resourceId: String): AccessCheckResult!
    
    # Audit
    accessAuditLog(
      tenantId: String!
      action: String
      resource: String
      actorId: String
      limit: Int
      since: DateTime
    ): [AuditLogEntry!]!
    
    # Stats
    accessCacheStats: AccessCacheStats!
  }
  
  # ═══════════════════════════════════════════════════════════════════
  # Mutation Extensions
  # ═══════════════════════════════════════════════════════════════════
  
  extend type Mutation {
    # Roles
    createRole(input: CreateRoleInput!): Role!
    updateRole(id: ID!, input: UpdateRoleInput!): Role
    deleteRole(id: ID!): Boolean!
    
    # Role Assignment
    assignRole(userId: String!, roleName: String!, tenantId: String!): Boolean!
    revokeRole(userId: String!, roleName: String!, tenantId: String!): Boolean!
    
    # Policies
    createPolicy(input: CreatePolicyInput!): Policy!
    updatePolicy(id: ID!, input: UpdatePolicyInput!): Policy
    deletePolicy(id: ID!): Boolean!
    
    # ACL Grants
    grantAccess(input: GrantAccessInput!): ACLGrant!
    revokeAccess(grantId: ID!): Boolean!
    
    # Cache Management
    invalidateAccessCache(userId: String, tenantId: String): Boolean!
    invalidateAllAccessCache: Boolean!
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Resolver Context
// ═══════════════════════════════════════════════════════════════════

interface AccessResolverContext {
  user: {
    userId: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
  } | null;
  requestId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Resolver Factory
// ═══════════════════════════════════════════════════════════════════

/**
 * Create GraphQL resolvers for access control
 */
export function createAccessResolvers(engine: AccessEngine, store: AccessStore, cache: AccessCache) {
  const getTenantId = (ctx: AccessResolverContext, argTenantId?: string): string => {
    return argTenantId || ctx.user?.tenantId || 'default';
  };
  
  const requireAuth = (ctx: AccessResolverContext): void => {
    if (!ctx.user) {
      throw new Error('Authentication required');
    }
  };
  
  return {
    Query: {
      // ─────────────────────────────────────────────────────────────
      // Roles
      // ─────────────────────────────────────────────────────────────
      
      roles: async (args: { tenantId?: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.listRoles(getTenantId(ctx, args.tenantId));
      },
      
      role: async (args: { id: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.getRole(args.id);
      },
      
      roleByName: async (args: { name: string; tenantId: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.getRoleByName(args.name, args.tenantId);
      },
      
      // ─────────────────────────────────────────────────────────────
      // Policies
      // ─────────────────────────────────────────────────────────────
      
      policies: async (args: { tenantId?: string; resource?: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.listPolicies(getTenantId(ctx, args.tenantId), args.resource);
      },
      
      policy: async (args: { id: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.getPolicy(args.id);
      },
      
      // ─────────────────────────────────────────────────────────────
      // ACL Grants
      // ─────────────────────────────────────────────────────────────
      
      aclGrants: async (
        args: { tenantId?: string; resourceType?: string; resourceId?: string },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        return store.listACLGrants(
          getTenantId(ctx, args.tenantId),
          args.resourceType,
          args.resourceId
        );
      },
      
      aclGrant: async (args: { id: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.getACLGrant(args.id);
      },
      
      // ─────────────────────────────────────────────────────────────
      // Self-Service
      // ─────────────────────────────────────────────────────────────
      
      myPermissions: async (_args: unknown, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        const roles = await store.getUserRoles(
          ctx.user!.userId,
          ctx.user!.tenantId
        );
        const permissions = roles.flatMap(r => r.permissions);
        return {
          userId: ctx.user!.userId,
          tenantId: ctx.user!.tenantId,
          roles: roles.map(r => r.name),
          permissions,
        };
      },
      
      checkAccess: async (
        args: { resource: string; action: string; resourceId?: string },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        const urn = args.resourceId 
          ? `${args.resource}:${args.action}:${args.resourceId}`
          : `${args.resource}:${args.action}:*`;
        return engine.check(ctx.user, urn);
      },
      
      // ─────────────────────────────────────────────────────────────
      // Audit
      // ─────────────────────────────────────────────────────────────
      
      accessAuditLog: async (
        args: {
          tenantId: string;
          action?: string;
          resource?: string;
          actorId?: string;
          limit?: number;
          since?: string;
        },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        return store.getAuditLog(args.tenantId, {
          action: args.action,
          resource: args.resource,
          actorId: args.actorId,
          limit: args.limit,
          since: args.since ? new Date(args.since) : undefined,
        });
      },
      
      // ─────────────────────────────────────────────────────────────
      // Stats
      // ─────────────────────────────────────────────────────────────
      
      accessCacheStats: async (_args: unknown, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return engine.getCacheStats();
      },
    },
    
    Mutation: {
      // ─────────────────────────────────────────────────────────────
      // Roles
      // ─────────────────────────────────────────────────────────────
      
      createRole: async (args: { input: any }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.createRole(args.input);
      },
      
      updateRole: async (args: { id: string; input: any }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.updateRole(args.id, args.input);
      },
      
      deleteRole: async (args: { id: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.deleteRole(args.id);
      },
      
      // ─────────────────────────────────────────────────────────────
      // Role Assignment (Note: This requires user service integration)
      // ─────────────────────────────────────────────────────────────
      
      assignRole: async (
        args: { userId: string; roleName: string; tenantId: string },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        // This would typically update the user's roles in your user service
        // For now, just invalidate the cache
        await cache.invalidateUser(args.tenantId, args.userId);
        return true;
      },
      
      revokeRole: async (
        args: { userId: string; roleName: string; tenantId: string },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        // This would typically update the user's roles in your user service
        await cache.invalidateUser(args.tenantId, args.userId);
        return true;
      },
      
      // ─────────────────────────────────────────────────────────────
      // Policies
      // ─────────────────────────────────────────────────────────────
      
      createPolicy: async (args: { input: any }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.createPolicy(args.input);
      },
      
      updatePolicy: async (args: { id: string; input: any }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.updatePolicy(args.id, args.input);
      },
      
      deletePolicy: async (args: { id: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.deletePolicy(args.id);
      },
      
      // ─────────────────────────────────────────────────────────────
      // ACL Grants
      // ─────────────────────────────────────────────────────────────
      
      grantAccess: async (args: { input: any }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.grantAccess(args.input);
      },
      
      revokeAccess: async (args: { grantId: string }, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        return store.revokeAccess(args.grantId);
      },
      
      // ─────────────────────────────────────────────────────────────
      // Cache Management
      // ─────────────────────────────────────────────────────────────
      
      invalidateAccessCache: async (
        args: { userId?: string; tenantId?: string },
        ctx: AccessResolverContext
      ) => {
        requireAuth(ctx);
        if (args.userId && args.tenantId) {
          await cache.invalidateUser(args.userId, args.tenantId);
        } else if (args.tenantId) {
          await cache.invalidateTenant(args.tenantId);
        }
        return true;
      },
      
      invalidateAllAccessCache: async (_args: unknown, ctx: AccessResolverContext) => {
        requireAuth(ctx);
        await cache.invalidateAll();
        return true;
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Default Permissions for Access Control
// ═══════════════════════════════════════════════════════════════════

/**
 * Default permission URNs for access control operations
 */
export const ACCESS_CONTROL_URNS = {
  // Role management
  ROLE_READ: 'access_role:*:read',
  ROLE_CREATE: 'access_role:*:create',
  ROLE_UPDATE: 'access_role:*:update',
  ROLE_DELETE: 'access_role:*:delete',
  
  // Policy management
  POLICY_READ: 'access_policy:*:read',
  POLICY_CREATE: 'access_policy:*:create',
  POLICY_UPDATE: 'access_policy:*:update',
  POLICY_DELETE: 'access_policy:*:delete',
  
  // ACL management
  ACL_READ: 'access_acl:*:read',
  ACL_GRANT: 'access_acl:*:grant',
  ACL_REVOKE: 'access_acl:*:revoke',
  
  // Cache management
  CACHE_READ: 'access_cache:*:read',
  CACHE_INVALIDATE: 'access_cache:*:invalidate',
  
  // Audit
  AUDIT_READ: 'access_audit:*:read',
} as const;

