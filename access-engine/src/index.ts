/**
 * access-engine
 * 
 * A standalone RBAC/ACL authorization engine with URN-based permissions.
 * 
 * Features:
 * - URN-based permissions (resource:action:target)
 * - Role-based access control (RBAC)
 * - Attribute-based access control (ABAC)
 * - Multi-tenancy support
 * - Permission inheritance
 * - Caching with LRU
 * - Audit logging
 * - Pre-built permission rules
 * - Fluent rule builder
 * 
 * @example
 * ```typescript
 * import { AccessEngine, hasRole, isAuthenticated, and } from 'access-engine';
 * 
 * // Create engine
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
 * 
 * // Use permission rules
 * const canAccess = await and(isAuthenticated, hasRole('user'))(user);
 * console.log(canAccess); // true
 * ```
 * 
 * @packageDocumentation
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  User,
  Permission,
  PermissionCondition,
  Role,
  RoleContext,
  UserRole,
  ResolvedPermissions,
  RoleResolutionOptions,
  AccessResult,
  ParsedUrn,
  PermissionRule,
  AccessEngineConfig,
  AuditEvent,
  TenantConfig,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export {
  AccessEngine,
  createAccessEngine,
  createAccessEngineWithDefaults,
} from './engine.js';

export {
  RoleResolver,
} from './roles.js';

// ─────────────────────────────────────────────────────────────────────────────
// URN Utilities
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Core functions
  parseUrn,
  buildUrn,
  matchUrn,
  matchAnyUrn,
  isValidUrn,
  normalizeUrn,
  
  // Advanced utilities
  getMatchingPatterns,
  getResource,
  getAction,
  getTarget,
  isOwnTarget,
  isTenantTarget,
  hasWildcard,
  
  // Factory
  createResourceUrn,
  
  // Constants
  StandardActions,
  StandardTargets,
} from './urn.js';

// ─────────────────────────────────────────────────────────────────────────────
// Permission Rules
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Basic rules
  allow,
  deny,
  isAuthenticated,
  isGuest,
  
  // Role-based rules
  hasRole,
  hasAnyRole,
  hasAllRoles,
  
  // Permission-based rules
  can,
  canAny,
  canAll,
  canOn,
  
  // Ownership rules
  isOwner,
  sameTenant,
  
  // Attribute-based rules
  hasAttribute,
  attributeIn,
  attributeMatches,
  
  // Combinators
  and,
  or,
  not,
  
  // Time-based rules
  duringHours,
  onDays,
  
  // Rate limiting
  rateLimit,
  
  // Custom rules
  custom,
  
  // Fluent builder
  rule,
} from './rules.js';
