/**
 * access-engine - Type Definitions
 * 
 * Core types for the RBAC/ACL authorization engine.
 */

/**
 * User context for authorization checks
 */
export interface User {
  /** Unique user identifier */
  userId: string;
  /** Tenant/organization identifier for multi-tenancy */
  tenantId?: string;
  /** User roles (e.g., ['admin', 'manager']) */
  roles: string[];
  /** Direct permissions in URN format (e.g., ['user:read:*']) */
  permissions: string[];
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Permission definition
 */
export interface Permission {
  /** URN pattern (e.g., 'resource:action:target') */
  urn: string;
  /** Optional description */
  description?: string;
  /** Conditions for dynamic permissions */
  conditions?: PermissionCondition[];
}

/**
 * Dynamic permission condition
 */
export interface PermissionCondition {
  /** Field to check (supports dot notation, e.g., 'metadata.department') */
  field: string;
  /** Comparison operator */
  operator: 'eq' | 'ne' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'gt' | 'gte' | 'lt' | 'lte';
  /** Value to compare against */
  value: unknown;
}

/**
 * Role definition with associated permissions
 */
export interface Role {
  /** Unique role name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Permissions granted to this role */
  permissions: string[];
  /** Parent roles (for inheritance) */
  inherits?: string[];
  /** Priority for conflict resolution (higher = more priority) */
  priority?: number;
}

/**
 * Result of an authorization check
 */
export interface AccessResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason?: string;
  /** Which permission or rule matched */
  matchedBy?: string;
  /** Matched URN pattern */
  matchedUrn?: string;
  /** Time taken for the check (ms) */
  duration?: number;
}

/**
 * Parsed URN components
 */
export interface ParsedUrn {
  /** Resource type (e.g., 'user', 'wallet', 'transaction') */
  resource: string;
  /** Action (e.g., 'read', 'write', 'delete', 'execute') */
  action: string;
  /** Target scope (e.g., 'own', 'tenant', '*', specific ID) */
  target: string;
  /** Original URN string */
  original: string;
  /** Whether this is a valid URN */
  valid: boolean;
}

/**
 * Permission rule function type
 */
export type PermissionRule = (
  user: User | null | undefined,
  resource?: Record<string, unknown>
) => boolean | Promise<boolean>;

/**
 * Configuration for the AccessEngine
 */
export interface AccessEngineConfig {
  /** Enable caching of permission checks */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  /** Maximum cache entries */
  maxCacheSize?: number;
  /** Default behavior when no rules match */
  defaultAllow?: boolean;
  /** Enable audit logging */
  enableAudit?: boolean;
  /** Custom audit logger */
  auditLogger?: (event: AuditEvent) => void | Promise<void>;
  /** Strict mode - throw on invalid URNs */
  strictMode?: boolean;
}

/**
 * Audit event for logging access decisions
 */
export interface AuditEvent {
  /** Timestamp */
  timestamp: Date;
  /** User who made the request */
  user: User | null;
  /** URN being checked */
  urn: string;
  /** Resource context */
  resource?: Record<string, unknown>;
  /** Access result */
  result: AccessResult;
  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Tenant configuration for multi-tenancy
 */
export interface TenantConfig {
  /** Tenant identifier */
  tenantId: string;
  /** Tenant-specific roles */
  roles?: Role[];
  /** Tenant-specific permissions */
  permissions?: Permission[];
  /** Whether tenant isolation is enforced */
  enforceIsolation?: boolean;
}
