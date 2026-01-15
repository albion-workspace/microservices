/**
 * Access Engine - Comprehensive Test Suite
 * 
 * This test suite serves dual purposes:
 * 1. Unit tests for all core functionality
 * 2. Executable examples demonstrating usage patterns
 */

import { describe, it, expect } from 'vitest';
import {
  AccessEngine,
  createAccessEngine,
  createAccessEngineWithDefaults,
  
  // URN utilities
  parseUrn,
  buildUrn,
  matchUrn,
  createResourceUrn,
  
  // Permission rules
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
  isOwner,
  sameTenant,
  
  // Rule combinators
  and,
  or,
  not,
  
  // Rule builder
  rule,
  
  // Types
  type User,
  type Role,
} from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════
// URN UTILITIES TESTS
// ═══════════════════════════════════════════════════════════════════

describe('URN Utilities', () => {
  describe('parseUrn', () => {
    it('should parse valid URN', () => {
      const parsed = parseUrn('user:read:own');
      expect(parsed.valid).toBe(true);
      expect(parsed.resource).toBe('user');
      expect(parsed.action).toBe('read');
      expect(parsed.target).toBe('own');
    });

    it('should handle wildcards', () => {
      const parsed = parseUrn('*:*:*');
      expect(parsed.valid).toBe(true);
      expect(parsed.resource).toBe('*');
      expect(parsed.action).toBe('*');
      expect(parsed.target).toBe('*');
    });

    it('should handle partial URNs', () => {
      const parsed = parseUrn('user:read');
      expect(parsed.resource).toBe('user');
      expect(parsed.action).toBe('read');
    });
  });

  describe('buildUrn', () => {
    it('should build URN from parts', () => {
      const urn = buildUrn('wallet', 'update', 'tenant');
      expect(urn).toBe('wallet:update:tenant');
    });

    it('should handle wildcards', () => {
      const urn = buildUrn('*', '*', '*');
      expect(urn).toBe('*:*:*');
    });
  });

  describe('matchUrn', () => {
    it('should match exact URNs', () => {
      expect(matchUrn('user:read:own', 'user:read:own')).toBe(true);
    });

    it('should match wildcard action', () => {
      expect(matchUrn('user:*:own', 'user:read:own')).toBe(true);
    });

    it('should match wildcard all', () => {
      expect(matchUrn('*:*:*', 'anything:here:works')).toBe(true);
    });

    it('should not match different URNs', () => {
      expect(matchUrn('user:read:own', 'admin:write:all')).toBe(false);
    });
  });

  describe('createResourceUrn', () => {
    it('should create read URN', () => {
      const builder = createResourceUrn('document');
      const urn = builder.read('123');
      expect(urn).toBe('document:read:123');
    });

    it('should create any action URN', () => {
      const builder = createResourceUrn('document');
      const urn = builder.any();
      expect(urn).toBe('document:*:*');
    });

    it('should create custom action URN', () => {
      const builder = createResourceUrn('document');
      const urn = builder.action('publish', '123');
      expect(urn).toBe('document:publish:123');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACCESS ENGINE CORE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('AccessEngine', () => {
  describe('Basic Setup', () => {
    it('should create engine with default config', () => {
      const engine = new AccessEngine();
      expect(engine).toBeDefined();
    });

    it('should create engine with roles', () => {
      const engine = new AccessEngine();
      
      engine.addRole({
        name: 'admin',
        permissions: ['*:*:*'],
      });
      
      engine.addRole({
        name: 'user',
        permissions: ['profile:read:own', 'profile:update:own'],
      });
      
      const roles = engine.getRoles();
      expect(roles.map(r => r.name)).toContain('admin');
      expect(roles.map(r => r.name)).toContain('user');
    });

    it('should support role inheritance', () => {
      const engine = new AccessEngine();
      
      engine.addRole({
        name: 'user',
        permissions: ['profile:read:own'],
      });
      
      engine.addRole({
        name: 'manager',
        permissions: ['reports:read:*'],
        inherits: ['user'],
      });
      
      expect(engine.getRoles().map(r => r.name)).toContain('manager');
    });
  });

  describe('Permission Checking', () => {
    it('should allow admin wildcard access', async () => {
      const engine = createAccessEngine();
      
      engine.addRole({
        name: 'admin',
        permissions: ['*:*:*'],
      });

      const admin: User = {
        userId: 'admin-1',
        tenantId: 'tenant-1',
        roles: ['admin'],
        permissions: [],
      };

      const result = await engine.check(admin, 'anything:*:*');
      expect(result.allowed).toBe(true);
    });

    it('should allow user with specific permission', async () => {
      const engine = createAccessEngine();
      
      engine.addRole({
        name: 'user',
        permissions: ['profile:read:own'],
      });

      const user: User = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: ['user'],
        permissions: [],
      };

      const result = await engine.check(user, 'profile:read:own');
      expect(result.allowed).toBe(true);
    });

    it('should deny user without permission', async () => {
      const engine = createAccessEngine();
      
      engine.addRole({
        name: 'user',
        permissions: ['profile:read:own'],
      });

      const user: User = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: ['user'],
        permissions: [],
      };

      const result = await engine.check(user, 'admin:delete:*');
      expect(result.allowed).toBe(false);
    });

    it('should support inherited permissions', async () => {
      const engine = createAccessEngine();
      
      engine.addRole({
        name: 'user',
        permissions: ['profile:read:own'],
      });
      
      engine.addRole({
        name: 'manager',
        permissions: ['reports:read:*'],
        inherits: ['user'],
      });

      const manager: User = {
        userId: 'manager-1',
        tenantId: 'tenant-1',
        roles: ['manager'],
        permissions: [],
      };

      // Should have manager permission
      let result = await engine.check(manager, 'reports:read:summary');
      expect(result.allowed).toBe(true);

      // Should also have inherited user permission
      result = await engine.check(manager, 'profile:read:own');
      expect(result.allowed).toBe(true);
    });

    it('should deny if no user provided', async () => {
      const engine = createAccessEngine();
      const result = await engine.check(undefined as any, 'anything:*:*');
      expect(result.allowed).toBe(false);
    });
  });

  describe('User-Specific Permissions', () => {
    it('should check user-specific permissions', async () => {
      const engine = createAccessEngine();

      const user: User = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: [],
        permissions: ['document:read:123', 'document:write:456'],
      };

      let result = await engine.check(user, 'document:read:123');
      expect(result.allowed).toBe(true);

      result = await engine.check(user, 'document:write:456');
      expect(result.allowed).toBe(true);

      result = await engine.check(user, 'document:delete:123');
      expect(result.allowed).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// PERMISSION RULES TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Permission Rules', () => {
  describe('isAuthenticated', () => {
    it('should pass for authenticated user', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
      const result = isAuthenticated(user);
      expect(result).toBe(true);
    });

    it('should fail for no user', () => {
      const result = isAuthenticated(undefined as any);
      expect(result).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('should pass for user with role', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['admin'], permissions: [] };
      const result = hasRole('admin')(user);
      expect(result).toBe(true);
    });

    it('should fail for user without role', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['user'], permissions: [] };
      const result = hasRole('admin')(user);
      expect(result).toBe(false);
    });
  });

  describe('can', () => {
    it('should pass for user with permission', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: ['document:read:*'] };
      const result = can('document:read:*')(user);
      expect(result).toBe(true);
    });

    it('should fail for user without permission', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
      const result = can('document:read:*')(user);
      expect(result).toBe(false);
    });
  });

  describe('isOwner', () => {
    it('should pass for resource owner', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
      const resource = { ownerId: 'user-1' };
      const result = isOwner(resource)(user);
      expect(result).toBe(true);
    });

    it('should fail for non-owner', () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
      const resource = { ownerId: 'user-2' };
      const result = isOwner(resource)(user);
      expect(result).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// RULE COMBINATORS TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Rule Combinators', () => {
  describe('and', () => {
    it('should pass when both rules pass', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['admin'], permissions: [] };
      const result = await and(isAuthenticated, hasRole('admin'))(user);
      expect(result).toBe(true);
    });

    it('should fail when one rule fails', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['user'], permissions: [] };
      const result = await and(isAuthenticated, hasRole('admin'))(user);
      expect(result).toBe(false);
    });
  });

  describe('or', () => {
    it('should pass when first rule passes', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['admin'], permissions: [] };
      const result = await or(hasRole('admin'), hasRole('manager'))(user);
      expect(result).toBe(true);
    });

    it('should pass when second rule passes', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['manager'], permissions: [] };
      const result = await or(hasRole('admin'), hasRole('manager'))(user);
      expect(result).toBe(true);
    });

    it('should fail when neither passes', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['user'], permissions: [] };
      const result = await or(hasRole('admin'), hasRole('manager'))(user);
      expect(result).toBe(false);
    });
  });

  describe('not', () => {
    it('should invert rule result', async () => {
      const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['user'], permissions: [] };
      const result = await not(hasRole('admin'))(user);
      expect(result).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// RULE BUILDER TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Rule Builder', () => {
  it('should build and combine multiple rules', async () => {
    const admin: User = { userId: 'admin-1', tenantId: 'tenant-1', roles: ['admin'], permissions: [] };
    const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: ['user'], permissions: [] };
    
    const adminOrAuth = or(hasRole('admin'), isAuthenticated);
    
    expect(await adminOrAuth(admin)).toBe(true);
    expect(await adminOrAuth(user)).toBe(true);
    expect(await adminOrAuth(undefined as any)).toBe(false);
  });

  it('should combine complex rules', async () => {
    const editor: User = {
      userId: 'editor-1',
      tenantId: 'tenant-1',
      roles: ['editor'],
      permissions: ['document:edit:*'],
    };
    
    const viewer: User = {
      userId: 'viewer-1',
      tenantId: 'tenant-1',
      roles: ['viewer'],
      permissions: ['document:read:*'],
    };
    
    const canEditRule = and(isAuthenticated, hasRole('editor'), can('document:edit:*'));
    
    expect(await canEditRule(editor)).toBe(true);
    expect(await canEditRule(viewer)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MULTI-TENANCY TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Multi-tenancy', () => {
  it('should allow same tenant access', () => {
    const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
    const resource = { tenantId: 'tenant-1' };
    const result = sameTenant(resource)(user);
    expect(result).toBe(true);
  });

  it('should deny different tenant access', () => {
    const user: User = { userId: 'user-1', tenantId: 'tenant-1', roles: [], permissions: [] };
    const resource = { tenantId: 'tenant-2' };
    const result = sameTenant(resource)(user);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INTEGRATION / EXAMPLE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Integration Examples', () => {
  it('Example 1: Basic setup and configuration', () => {
    const engine = new AccessEngine();
    
    engine.addRole({
      name: 'admin',
      permissions: ['*:*:*'],
    });
    
    engine.addRole({
      name: 'user',
      permissions: ['profile:read:own', 'profile:update:own', 'wallet:read:own'],
    });
    
    engine.addRole({
      name: 'manager',
      permissions: ['reports:read:tenant'],
      inherits: ['user'],
    });
    
    const roles = engine.getRoles();
    const roleNames = roles.map(r => r.name);
    expect(roleNames).toContain('admin');
    expect(roleNames).toContain('user');
    expect(roleNames).toContain('manager');
  });

  it('Example 2: Checking permissions for different users', async () => {
    const engine = createAccessEngine();
    
    engine.addRole({
      name: 'admin',
      permissions: ['*:*:*'],
    });
    
    engine.addRole({
      name: 'user',
      permissions: ['profile:*:own', 'wallet:read:own'],
    });

    const admin: User = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      roles: ['admin'],
      permissions: [],
    };

    const user: User = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['user'],
      permissions: [],
    };

    // Admin can access anything
    let result = await engine.check(admin, 'anything:*:*');
    expect(result.allowed).toBe(true);

    // User can read own profile
    result = await engine.check(user, 'profile:read:own');
    expect(result.allowed).toBe(true);

    // User cannot delete admin data
    result = await engine.check(user, 'admin:delete:*');
    expect(result.allowed).toBe(false);
  });

  it('Example 3: URN patterns and wildcards', () => {
    // Exact match
    expect(matchUrn('document:read:123', 'document:read:123')).toBe(true);
    
    // Resource wildcard
    expect(matchUrn('*:read:123', 'document:read:123')).toBe(true);
    
    // Action wildcard
    expect(matchUrn('document:*:123', 'document:read:123')).toBe(true);
    
    // Target wildcard
    expect(matchUrn('document:read:*', 'document:read:123')).toBe(true);
    
    // Full wildcard
    expect(matchUrn('*:*:*', 'document:read:123')).toBe(true);
  });

  it('Example 4: Complex permission scenarios', async () => {
    const engine = createAccessEngine();
    
    engine.addRole({
      name: 'admin',
      permissions: ['*:*:*'],
    });
    
    engine.addRole({
      name: 'user',
      permissions: ['document:read:*', 'document:write:own'],
    });

    const admin: User = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      roles: ['admin'],
      permissions: [],
    };

    const user: User = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['user'],
      permissions: [],
    };

    // Admin can do anything
    let result = await engine.check(admin, 'document:delete:123');
    expect(result.allowed).toBe(true);

    // User can read
    result = await engine.check(user, 'document:read:123');
    expect(result.allowed).toBe(true);

    // User can write own
    result = await engine.check(user, 'document:write:own');
    expect(result.allowed).toBe(true);

    // User cannot delete
    result = await engine.check(user, 'document:delete:123');
    expect(result.allowed).toBe(false);
  });

  it('Example 5: Role-based access with inheritance', async () => {
    const engine = createAccessEngine();
    
    engine.addRole({
      name: 'user',
      permissions: ['profile:read:own', 'wallet:read:own'],
    });
    
    engine.addRole({
      name: 'editor',
      permissions: ['document:write:*', 'document:read:*'],
      inherits: ['user'],
    });
    
    engine.addRole({
      name: 'admin',
      permissions: ['*:*:*'],
      inherits: ['editor'],
    });

    const editor: User = {
      userId: 'editor-1',
      tenantId: 'tenant-1',
      roles: ['editor'],
      permissions: [],
    };

    // Editor has own permissions
    let result = await engine.check(editor, 'document:write:123');
    expect(result.allowed).toBe(true);

    // Editor has inherited user permissions
    result = await engine.check(editor, 'profile:read:own');
    expect(result.allowed).toBe(true);

    // Editor doesn't have admin permissions
    result = await engine.check(editor, 'system:config:update');
    expect(result.allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Performance', () => {
  it('should check permissions quickly', async () => {
    const engine = createAccessEngine({
      roles: [
        { name: 'admin', permissions: ['*:*:*'] },
      ],
    });

    const admin: User = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      roles: ['admin'],
      permissions: [],
    };

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await engine.check(admin, 'document:read:123');
    }
    const duration = Date.now() - start;

    // Should complete 1000 checks in less than 100ms
    expect(duration).toBeLessThan(100);
  });
});
