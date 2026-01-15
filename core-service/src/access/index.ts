/**
 * Access Control Module
 * 
 * Integrates the standalone access-engine with:
 * - MongoDB persistence for roles/policies
 * - Redis caching
 * - GraphQL management API
 * - Audit logging
 * 
 * For standalone/portable usage, use access-engine directly.
 * 
 * @example
 * ```typescript
 * import { createAccessControl, allow, hasRole } from 'core-service';
 * 
 * // Create access control with MongoDB/Redis integration
 * const access = createAccessControl({
 *   serviceName: 'my-service',
 *   defaultRoles: [
 *     { name: 'admin', permissions: ['*:*:*'] },
 *     { name: 'user', permissions: ['profile:*:own'] },
 *   ],
 * });
 * 
 * await access.initialize();
 * 
 * // Use in gateway permissions
 * createGateway({
 *   services: [myService],
 *   permissions: {
 *     Query: {
 *       health: allow,
 *       users: access.rules.can('user', 'read'),
 *       myProfile: access.rules.or(access.rules.isOwner(), hasRole('admin')),
 *     },
 *   },
 * });
 * ```
 */

// ═══════════════════════════════════════════════════════════════════
// Re-export everything from standalone access-engine
// ═══════════════════════════════════════════════════════════════════

export {
  // Engine
  AccessEngine,
  createAccessEngine,
  createAccessEngineWithDefaults,
  
  // Types from access-engine
  type User,
  type Permission,
  type PermissionCondition,
  type Role as BaseRole,  // Rename to avoid conflict with extended Role
  type AccessResult,
  type ParsedUrn,
  type PermissionRule,
  type AccessEngineConfig,
  type AuditEvent,
  type TenantConfig,
  
  // URN Utilities
  parseUrn,
  buildUrn,
  matchUrn,
  matchAnyUrn,
  isValidUrn,
  normalizeUrn,
  getMatchingPatterns,
  getResource,
  getAction,
  getTarget,
  isOwnTarget,
  isTenantTarget,
  hasWildcard,
  createResourceUrn,
  StandardActions,
  StandardTargets,
  
  // Permission Rules
  allow,
  deny,
  isAuthenticated,
  isGuest,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  can,
  canAny,
  canAll,
  canOn,
  isOwner,
  sameTenant,
  hasAttribute,
  attributeIn,
  attributeMatches,
  and,
  or,
  not,
  duringHours,
  onDays,
  rateLimit,
  custom,
  rule,
} from 'access-engine';

// ═══════════════════════════════════════════════════════════════════
// Service-core specific integrations
// ═══════════════════════════════════════════════════════════════════

import { 
  AccessEngine, 
  type Role as StandaloneRole,
  type AccessEngineConfig,
} from 'access-engine';
import { accessGraphQLTypes, createAccessResolvers, ACCESS_CONTROL_URNS } from './graphql.js';
import { AccessStore } from './store.js';
import { AccessCache, type CacheStats, type CacheInvalidationEvent } from './cache.js';
import type { Role, CreateRoleInput, CreatePolicyInput, ResolvedAccessConfig } from './types-ext.js';

export interface AccessControlConfig extends AccessEngineConfig {
  /** Service name */
  serviceName?: string;
  /** Default roles to create on initialization */
  defaultRoles?: Role[];
  /** Enable audit logging */
  enableAudit?: boolean;
  /** Audit retention in days */
  auditRetentionDays?: number;
  /** Enable permission caching */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  /** Maximum cache entries */
  maxCacheSize?: number;
}

export interface AccessControl {
  /**
   * GraphQL service module (plug into gateway for role/policy management)
   */
  service: {
    name: string;
    types: string;
    resolvers: ReturnType<typeof createAccessResolvers>;
  };
  
  /**
   * Access engine instance (from access-engine)
   */
  engine: AccessEngine;
  
  /**
   * MongoDB store for roles/policies
   */
  store: AccessStore;
  
  /**
   * Redis cache for permissions
   */
  cache: AccessCache;
  
  /**
   * Initialize the access control system
   * Call this on application startup
   */
  initialize: () => Promise<void>;
}

/**
 * Create an Access Control instance with MongoDB/Redis integration
 * 
 * @example
 * ```typescript
 * const access = createAccessControl({
 *   serviceName: 'my-service',
 *   defaultRoles: [
 *     { name: 'admin', permissions: ['*:*:*'] },
 *     { name: 'user', permissions: ['resource:own:*'] },
 *   ],
 * });
 * 
 * await access.initialize();
 * 
 * // Check access
 * const result = await access.engine.check(user, 'resource:read:own');
 * ```
 */
export function createAccessControl(config: AccessControlConfig): AccessControl {
  const resolvedConfig: ResolvedAccessConfig = {
    serviceName: config.serviceName || 'access-control',
    defaultRoles: config.defaultRoles || [],
    defaultPolicies: [],
    enableAudit: config.enableAudit ?? true,
    auditRetentionDays: config.auditRetentionDays ?? 90,
    enableCache: config.enableCache ?? true,
    cacheTtl: config.cacheTtl ?? 300000,
    maxCacheSize: config.maxCacheSize ?? 10000,
    defaultAllow: config.defaultAllow ?? false,
    
    cache: {
      enabled: config.enableCache ?? true,
      ttl: config.cacheTtl ?? 300000,
      maxSize: config.maxCacheSize ?? 10000,
      prefix: `${config.serviceName || 'access'}:`,
    },
    
    audit: {
      enabled: config.enableAudit ?? true,
      retentionDays: config.auditRetentionDays ?? 90,
      logReads: false,  // Don't log every permission check
      logWrites: true,  // Log role/policy modifications
    },
    
    collections: {
      roles: 'access_roles',
      policies: 'access_policies',
      grants: 'access_grants',
      aclGrants: 'access_grants',  // Alias
      audit: 'access_audit',
      auditLog: 'access_audit',  // Alias
    },
  };
  
  const store = new AccessStore(resolvedConfig);
  const cache = new AccessCache(resolvedConfig);
  
  // Create engine WITHOUT internal cache (we use Redis)
  const engine = new AccessEngine({
    enableCache: false,  // Disable internal cache, use Redis instead
    cacheTtl: resolvedConfig.cacheTtl,
    maxCacheSize: resolvedConfig.maxCacheSize,
    defaultAllow: resolvedConfig.defaultAllow,
  });
  
  // Add default roles to engine (in-memory for fast access)
  if (resolvedConfig.defaultRoles) {
    for (const role of resolvedConfig.defaultRoles) {
      engine.addRole(role as StandaloneRole);
    }
  }
  
  const resolvers = createAccessResolvers(engine, store, cache);
  
  return {
    service: {
      name: 'access-control',
      types: accessGraphQLTypes,
      resolvers,
    },
    engine,
    store,
    cache,
    async initialize() {
      // Initialize MongoDB store
      await store.initialize();
      
      // Redis cache is ready to use (no initialization needed)
      
      // Create default roles in database
      if (resolvedConfig.defaultRoles) {
        for (const role of resolvedConfig.defaultRoles) {
          try {
            await store.createRole(role as CreateRoleInput);
          } catch (err) {
            // Role might already exist, ignore
          }
        }
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Legacy exports (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════

// Types
// Export extended types (MongoDB/Redis integration)
export type {
  URN,
  URNContext,
  URNMatcher,
  Policy,
  PolicyEffect,
  PolicySubject,
  PolicyCondition,
  SubjectType,
  ConditionOperator,
  ACLGrant,
  Role,
  CreateRoleInput,
  UpdateRoleInput,
  CreatePolicyInput,
  CreateACLGrantInput,
  CompiledPermissions,
  AccessCheckResult,
  AccessContext,
  UserContextInput,
  ResolvedAccessConfig,
  AuditLogEntry,
} from './types-ext.js';

// Store (MongoDB persistence)
export { AccessStore } from './store.js';

// Cache (Redis)
export { AccessCache } from './cache.js';
export type { CacheStats, CacheInvalidationEvent };

// GraphQL
export {
  accessGraphQLTypes,
  createAccessResolvers,
  ACCESS_CONTROL_URNS,
} from './graphql.js';

// Note: Rules are exported directly from access-engine in the main exports above
