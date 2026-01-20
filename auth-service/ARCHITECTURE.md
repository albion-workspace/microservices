# Auth Service Architecture

## Overview

The auth-service has been refactored to support a flexible, graph-based role and permission system that can handle multiple use cases including banking, crypto wallets, foreign exchange, and betting platforms.

## Key Features

### 1. Graph-Based Role System

The service now supports context-based roles where users can have different roles in different contexts:

- **Context-based roles**: A user can be a manager in one branch and an employee in another
- **Hierarchical roles**: Roles can inherit from other roles (e.g., `branch-manager` inherits from `user`)
- **Graph relationships**: Users can have multiple roles simultaneously in different contexts

### 2. Flexible User Structure

The user structure supports flexible metadata for different use cases:

- **Banking**: `accountNumber`, `branchId`, `accountType`, `kycStatus`, etc.
- **Crypto Wallet**: `walletAddresses`, `walletType`, `blockchain`, `kycLevel`, etc.
- **Foreign Exchange**: `tradingAccountId`, `brokerId`, `accountType`, `leverage`, etc.
- **Betting Platform**: `playerId`, `agentId`, `commissionRate`, `bettingLimits`, etc.

### 3. TypeScript Best Practices

- Proper type definitions with generics
- Repository pattern for data access
- Service layer separation
- Type-safe role and permission checking

## Architecture Components

### Type System

```
auth-service/src/types/
├── user-types.ts      # User-related types
├── role-types.ts      # Role and permission types
└── types.ts           # Re-exports and legacy compatibility
```

### Services

```
auth-service/src/services/
├── authentication.ts  # Authentication logic
├── registration.ts    # User registration
├── role-service.ts    # Role and permission management (NEW)
├── otp.ts            # OTP management
├── password.ts        # Password management
└── two-factor.ts      # 2FA management
```

### Repositories

```
auth-service/src/repositories/
└── user-repository.ts  # Data access layer (NEW)
```

### Configuration

```
auth-service/src/config/
└── default-roles.ts    # Pre-configured roles for common use cases (NEW)
```

## Usage Examples

### 1. Assigning Context-Based Roles

```typescript
import { RoleService } from './services/role-service.js';

const roleService = new RoleService();

// Assign manager role in branch-001
await roleService.assignRole({
  userId: 'user-123',
  tenantId: 'tenant-abc',
  role: 'branch-manager',
  context: 'branch:branch-001',
  assignedBy: 'admin-user-id',
});

// Same user can be employee in branch-002
await roleService.assignRole({
  userId: 'user-123',
  tenantId: 'tenant-abc',
  role: 'employee',
  context: 'branch:branch-002',
  assignedBy: 'admin-user-id',
});
```

### 2. Checking Permissions

```typescript
import { RoleService } from './services/role-service.js';

const roleService = new RoleService();

// Check if user has permission in specific context
const hasPermission = roleService.hasPermission(
  user,
  'transaction:create:*',
  'branch:branch-001'
);

// Check if user has role
const hasRole = roleService.hasRole(
  user,
  'branch-manager',
  'branch:branch-001'
);
```

### 3. Resolving User Permissions

```typescript
import { RoleService } from './services/role-service.js';

const roleService = new RoleService();

// Resolve all effective permissions for a user
const resolved = roleService.resolveUserPermissions(user, {
  context: 'branch:branch-001',
  includeInherited: true,
  includePermissions: true,
});

// Check if user has wildcard permission
if (resolved.hasWildcard) {
  // User has full access
}

// Get all effective roles
const roles = Array.from(resolved.roles);

// Get context-specific roles
const branchRoles = resolved.contextRoles.get('branch:branch-001');
```

### 4. Using User Repository

```typescript
import { UserRepository } from './repositories/user-repository.js';

const userRepo = new UserRepository();

// Find user by email
const user = await userRepo.findByEmail('user@example.com', 'tenant-abc');

// Query users with filters
const result = await userRepo.query({
  filter: {
    tenantId: 'tenant-abc',
    status: 'active',
    roles: ['branch-manager'],
    context: 'branch:branch-001',
  },
  pagination: {
    limit: 10,
    offset: 0,
  },
});

// Update user metadata
await userRepo.updateMetadata({
  userId: 'user-123',
  tenantId: 'tenant-abc',
  metadata: {
    accountNumber: '1234567890',
    branchId: 'branch-001',
  },
  merge: true, // Merge with existing metadata
});
```

## Role Definitions

### Default Roles

The service includes pre-configured roles for common use cases:

**System Roles:**
- `super-admin`: Full system access
- `admin`: Administrative access within tenant
- `system`: System-level user for automated processes
- `user`: Standard user with basic permissions

**Banking Roles:**
- `branch-manager`: Manager of a bank branch
- `teller`: Bank teller with transaction processing permissions
- `customer-service`: Customer service representative

**Crypto Wallet Roles:**
- `crypto-admin`: Administrator for crypto wallet platform
- `crypto-trader`: Trader with trading permissions

**Foreign Exchange Roles:**
- `forex-broker`: Forex broker with trading permissions
- `forex-trader`: Forex trader
- `forex-analyst`: Forex market analyst

**Betting Platform Roles:**
- `betting-admin`: Administrator for betting platform
- `agent`: Betting agent with player management permissions
- `player`: Betting platform player

**Payment Gateway Roles:**
- `payment-gateway`: Payment gateway system user
- `payment-provider`: Payment provider system user

### Creating Custom Roles

```typescript
import { RoleService } from './services/role-service.js';
import type { RoleDefinition } from './types/role-types.js';

const roleService = new RoleService();

// Register a custom role
roleService.registerRole({
  name: 'custom-role',
  displayName: 'Custom Role',
  description: 'A custom role for specific use case',
  inherits: ['user'], // Inherit from user role
  permissions: ['custom:read:*', 'custom:create:*'],
  priority: 50,
  active: true,
});
```

## Role Format

The service uses the new graph-based role format (`UserRole[]`) with context support. Since development environments start fresh each time (databases are dropped), no migration utilities are needed.

## GraphQL Schema Updates

The GraphQL schema has been updated to support context-based roles:

```graphql
type User {
  id: ID!
  tenantId: String!
  # ... other fields
  roles: [UserRole!]!  # New: UserRole[] instead of [String!]!
  permissions: [String!]!
  metadata: JSON
}

type UserRole {
  role: String!
  context: String
  assignedAt: String!
  assignedBy: String
  expiresAt: String
  active: Boolean!
  metadata: JSON
}
```

## Best Practices

### 1. Always Use Context for Role Checks

When checking permissions or roles, always specify the context:

```typescript
// ✅ Good
const hasPermission = roleService.hasPermission(
  user,
  'transaction:create:*',
  'branch:branch-001'
);

// ❌ Bad (checks global roles only)
const hasPermission = roleService.hasPermission(
  user,
  'transaction:create:*'
);
```

### 2. Use Repository Pattern for Data Access

Always use the repository pattern instead of direct database access:

```typescript
// ✅ Good
const user = await userRepo.findByEmail(email, tenantId);

// ❌ Bad
const user = await db.collection('users').findOne({ email, tenantId });
```

### 3. Leverage Role Inheritance

Design roles with inheritance to avoid duplication:

```typescript
// ✅ Good: Inherit from base role
{
  name: 'branch-manager',
  inherits: ['user'],
  permissions: ['branch:*:*'],
}

// ❌ Bad: Duplicate permissions
{
  name: 'branch-manager',
  permissions: ['user:read:own', 'user:update:own', 'branch:*:*'],
}
```

### 4. Use Metadata for Use Case-Specific Data

Store use case-specific data in the `metadata` field:

```typescript
// Banking
user.metadata = {
  accountNumber: '1234567890',
  branchId: 'branch-001',
  kycStatus: 'verified',
};

// Crypto Wallet
user.metadata = {
  walletAddresses: ['0x123...', '0x456...'],
  walletType: 'hot',
  blockchain: ['ethereum', 'bitcoin'],
};
```

## Performance Considerations

1. **Role Resolution**: Role resolution is cached in memory. For high-traffic scenarios, consider implementing Redis caching.

2. **Permission Checks**: Permission checks are optimized to check wildcard permissions first (`*:*:*`).

3. **Database Queries**: The repository pattern allows for query optimization and indexing strategies.

## Security Considerations

1. **Role Expiration**: Roles can have expiration dates. Always check expiration when resolving permissions.

2. **Context Isolation**: Roles are isolated by context. A user's role in one context doesn't affect another context.

3. **Permission Inheritance**: Inherited permissions are resolved recursively. Ensure role definitions don't create circular dependencies.

4. **Wildcard Permissions**: The `*:*:*` permission grants full access. Use with caution.

## Future Enhancements

1. **Role Templates**: Pre-defined role templates for common use cases
2. **Role Auditing**: Track role assignment and revocation history
3. **Dynamic Role Resolution**: Resolve roles based on runtime conditions
4. **Role Delegation**: Allow users to delegate roles to other users
5. **Role Constraints**: Define constraints on role assignments (e.g., max users per role)
