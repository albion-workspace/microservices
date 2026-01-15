/**
 * Extended Access Control Types
 * 
 * Additional types for MongoDB/Redis/GraphQL integration
 * that extend the standalone access-engine types.
 */

import type { Role as BaseRole, Permission, AccessEngineConfig } from 'access-engine';

// ═══════════════════════════════════════════════════════════════════
// Extended Role (with MongoDB fields)
// ═══════════════════════════════════════════════════════════════════

export interface Role extends BaseRole {
  id: string;
  tenantId: string;
  priority?: number;
  isDefault?: boolean;
  isSystem?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: string[];
  inherits?: string[];
  priority?: number;
  isDefault?: boolean;
  tenantId?: string;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  inherits?: string[];
  priority?: number;
  isDefault?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Policy Types (for MongoDB storage)
// ═══════════════════════════════════════════════════════════════════

export type PolicyEffect = 'allow' | 'deny';
export type SubjectType = 'user' | 'role' | 'group';
export type ConditionOperator = 'equals' | 'notEquals' | 'in' | 'notIn' | 'greaterThan' | 'lessThan' | 'matches';

export interface PolicySubject {
  type: SubjectType;
  id: string;
}

export interface PolicyCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

export interface Policy {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  subject: PolicySubject;  // Singular for backward compatibility
  subjects: PolicySubject[];
  resource: string;  // Singular for backward compatibility
  resources: string[];
  action: string;  // Singular for backward compatibility
  actions: string[];
  conditions?: PolicyCondition[];
  priority?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePolicyInput {
  name: string;
  description?: string;
  effect: PolicyEffect;
  subject: PolicySubject;  // Singular for backward compatibility
  subjects?: PolicySubject[];
  resource: string;  // Singular for backward compatibility
  resources?: string[];
  action: string;  // Singular for backward compatibility
  actions?: string[];
  conditions?: PolicyCondition[];
  priority?: number;
  tenantId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// ACL Grant Types
// ═══════════════════════════════════════════════════════════════════

export interface ACLGrant {
  id: string;
  tenantId: string;
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
  resourceId: string;
  resourceType: string;
  permissions: string[];
  actions: string[];
  reason?: string;
  grantedBy: string;  // Who granted the access
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateACLGrantInput {
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
  resourceId: string;
  resourceType: string;
  permissions: string[];
  actions: string[];
  reason?: string;
  expiresAt?: Date;
  tenantId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Audit Log Types
// ═══════════════════════════════════════════════════════════════════

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  actorId: string;  // Who performed the action
  actorType: 'user' | 'service' | 'system';
  action: string;
  resource: string;
  resourceId: string;
  result: 'allowed' | 'denied';
  reason?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Compiled Permissions (for caching)
// ═══════════════════════════════════════════════════════════════════

export interface URN {
  resource: string;
  action: string;
  target: string;
}

export type URNMatcher = (urn: URN) => boolean;

export interface CompiledPermissions {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: Permission[];
  urns: string[];  // For backward compatibility
  grants: Record<string, string[]>;  // For backward compatibility
  denies: string[];  // For backward compatibility
  matcher: URNMatcher;
  compiledAt: Date;
  computedAt: number;  // Unix timestamp for backward compatibility
  expiresAt: number;  // Unix timestamp for backward compatibility
}

// ═══════════════════════════════════════════════════════════════════
// Access Check Types
// ═══════════════════════════════════════════════════════════════════

export interface AccessContext {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  attributes?: Record<string, unknown>;
}

export interface UserContextInput {
  userId: string;
  tenantId?: string;
  roles?: string[];
  permissions?: string[];
  attributes?: Record<string, unknown>;
}

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  matchedPermissions?: string[];
  appliedPolicies?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Resolved Config (with defaults applied)
// ═══════════════════════════════════════════════════════════════════

export interface ResolvedAccessConfig extends AccessEngineConfig {
  serviceName: string;
  defaultRoles: Role[];
  defaultPolicies?: Policy[];
  enableAudit: boolean;
  auditRetentionDays: number;
  enableCache: boolean;
  cacheTtl: number;
  maxCacheSize: number;
  
  // Cache config
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
    prefix: string;
  };
  
  // Audit config
  audit: {
    enabled: boolean;
    retentionDays: number;
    logReads: boolean;
    logWrites: boolean;
  };
  
  // Collection names
  collections: {
    roles: string;
    policies: string;
    grants: string;
    aclGrants: string;  // Alias for grants
    audit: string;
    auditLog: string;  // Alias for audit
  };
}

// ═══════════════════════════════════════════════════════════════════
// URN Context (for URN utilities)
// ═══════════════════════════════════════════════════════════════════

export interface URNContext {
  userId?: string;
  tenantId?: string;
  resourceId?: string;
}
