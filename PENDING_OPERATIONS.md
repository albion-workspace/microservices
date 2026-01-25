# Pending Operations - Complete Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Backend Mapping](#backend-mapping)
4. [Implementation](#implementation)
5. [Alignment Guide](#alignment-guide)
6. [GraphQL Integration](#graphql-integration)
7. [Testing & Usage](#testing--usage)
8. [References](#references)

---

## Overview

The pending operation store provides a unified way to handle temporary data storage before committing to the database. This document covers the complete architecture, implementation, and best practices for using pending operations across all microservices.

### Use Cases

- User registration (store registration data until email/phone verification)
- Password reset (temporary reset tokens)
- OTP verification (temporary OTP codes)
- Campaign creation (store sensitive campaign data until all steps complete)
- Multi-step forms (store form data between steps)
- Any scenario where data should be stored temporarily before committing to DB

### Benefits

- No DB records for incomplete operations
- Automatic expiration (no cleanup needed)
- Can re-start operation if token/entry expires
- Reduces spam/incomplete data in DB

---

## Architecture

### Core Service (`core-service/src/common/pending-operation.ts`)

The pending operation store supports two backends:

#### 1. JWT-based (stateless)
- Data stored directly in the JWT token
- No server-side storage required
- Auto-expires based on token expiration
- **Use when**: Data doesn't need to be queried/listed, stateless operations (email links, SMS tokens)

#### 2. Redis-based (stateful)
- Data stored in Redis with TTL
- Key pattern: `pending:{operationType}:{token}`
- Can be queried, updated, and listed
- Supports multi-step operations
- **Use when**: Data needs to be queried/updated, multi-step forms, operations that need server-side tracking

### Backend Selection Logic

```typescript
// Default backend: 'auto'
backend = 'auto'  // Prefers Redis, falls back to JWT

// Actual backend selection:
if (backend === 'jwt') return 'jwt';
if (backend === 'redis') {
  if (Redis available) return 'redis';
  else fallback to 'jwt';
}
if (backend === 'auto') {
  if (Redis available) return 'redis';
  else return 'jwt';
}
```

---

## Backend Mapping

### Current Implementation Status

#### ✅ JWT-Based Operations (Cannot be listed via GraphQL)

These operations store data **in the JWT token itself** and cannot be queried/listed:

| Operation | Service | Store | Location | Expiration | Can List? |
|-----------|---------|-------|----------|------------|-----------|
| **User Registration** (`registration`) | `RegistrationService` | `createRegistrationStore()` → JWT-based | `auth-service/src/services/registration.ts:34` | 24 hours | ❌ No |
| **Password Reset** (`password_reset`) | `PasswordService` | `createPendingOperationStore({ backend: 'jwt', ... })` → JWT-based | `auth-service/src/services/password.ts:39` | 30 minutes | ❌ No |
| **OTP Verification** (`otp_verification`) | `OTPService` | `createPendingOperationStore({ backend: 'jwt', ... })` → JWT-based | `auth-service/src/services/otp.ts:21` | Configurable | ❌ No |

**Why JWT**: Stateless, no server-side storage needed, token sent via email/SMS link

#### ✅ Redis-Based Operations (Can be listed via GraphQL)

These operations store data **in Redis** and can be queried/listed:

| Operation | Store | Location | Expiration | Key Pattern | Can List? | Status |
|-----------|-------|----------|------------|-------------|-----------|--------|
| **Campaign Creation** (`campaign`) | `createCampaignStore()` → Redis-based | `core-service/src/common/pending-operation.ts:489` | 1 hour (3600s) | `campaign:{operationType}:{token}` | ✅ Yes | ⚠️ Example only |
| **Multi-Step Forms** (`form`) | `createFormStore()` → Redis-based | `core-service/src/common/pending-operation.ts:500` | 30 min (1800s) | `form:{operationType}:{token}` | ✅ Yes | ⚠️ Example only |

**Why Redis**: Needs updates during multi-step process, needs to be queried/listed

### Key Patterns in Redis

If operations were Redis-based, they would use these key patterns:

- **Registration**: `pending:registration:{token}`
- **Password Reset**: `pending:password_reset:{token}`
- **OTP Verification**: `pending:otp_verification:{token}`
- **Campaign**: `campaign:{operationType}:{token}` (different prefix)
- **Form**: `form:{operationType}:{token}` (different prefix)

### Current Reality in Auth Service

**All currently implemented operations in auth-service use JWT-based storage:**

| Operation | Backend | Can List? | Reason |
|-----------|---------|-----------|--------|
| Registration | JWT | ❌ | Stateless, token-based |
| Password Reset | JWT | ❌ | Stateless, token-based |
| OTP Verification | JWT | ❌ | Stateless, token-based |

**Conclusion**: Currently, **no operations in auth-service are queryable** via the GraphQL `pendingOperations` query because they all use JWT-based storage. The query implementation is ready for when/if operations are switched to Redis-based storage.

---

## Implementation

### What Was Implemented

#### 1. GraphQL Schema & Resolvers (`auth-service/src/graphql.ts`)

**Added Types:**
- `PendingOperation` - Represents a single pending operation
- `PendingOperationConnection` - Paginated list of pending operations

**Added Queries:**
- `pendingOperations` - List all pending operations (Redis-based only)
  - Supports filtering by `operationType` and `recipient`
  - Implements pagination
  - Access control: Users see only their own operations, admins/system see all
  - Returns sanitized data (sensitive fields removed)

- `pendingOperation` - Get specific operation by token
  - Works for both JWT and Redis-based operations
  - Useful for verifying specific operations

**Security Features:**
- ✅ Access control based on user roles/permissions
- ✅ Data sanitization (removes OTP codes, passwords, hashed codes)
- ✅ Users can only see operations matching their email/phone
- ✅ Admins/system users can see all operations

#### 2. React Component (`app/src/pages/PendingOperations.tsx`)

A comprehensive UI component that displays pending operations with:

**Features:**
- **Real-time Updates**: Auto-refreshes every 30 seconds
- **Filtering**: By operation type and recipient
- **Statistics**: Shows total, active, and expired operations
- **Status Indicators**: Visual indicators for operation status (Active, Expiring Soon, Expired)
- **Expiration Display**: Shows time remaining until expiration
- **Token Management**: Displays truncated tokens with copy functionality
- **Responsive Design**: Works on desktop and mobile

#### 3. Navigation Integration (`app/src/App.tsx`)

- Added route: `/pending-operations`
- Added navigation link in sidebar (System section, visible to system users)
- Protected route (requires authentication)

### Data Sanitization

The following fields are **never exposed**:
- `passwordHash`
- `password`
- `hashedCode`
- `code`
- `otpCode`
- `resetToken`
- `secret`

Safe fields that **are exposed**:
- `operationType`
- `recipient` (email/phone)
- `channel` (email/sms/whatsapp)
- `purpose`
- `createdAt`
- `expiresAt`
- `expiresIn`
- `metadata` (sanitized)

### Limitations & Considerations

#### JWT-based Operations
- **Cannot be listed**: JWT-based operations (registration, password reset) store data in the token itself
- **Solution**: Users receive tokens via email/SMS and can verify them using the `pendingOperation` query
- **Why**: JWT is stateless - there's no central store to query

#### Redis-based Operations
- **Can be listed**: Operations stored in Redis can be scanned and displayed
- **Performance**: Scanning Redis keys can be slow with many operations
- **Solution**: Implemented pagination and limits (max 1000 keys scanned)

#### Security Considerations
1. **Access Control**: Only authenticated users can query
2. **Data Filtering**: Users see only their own operations
3. **Data Sanitization**: Sensitive data is never exposed
4. **Rate Limiting**: Consider adding rate limits for production

---

## Alignment Guide

### Backend Selection Guidelines

#### Use JWT Backend (`backend: 'jwt'`) when:
- ✅ Operation is stateless (token sent via email/SMS link)
- ✅ Data doesn't need to be queried or listed
- ✅ Single-use operations (verify once and delete)
- ✅ No need for updates during the operation lifecycle
- **Examples**: User registration, password reset, OTP verification

#### Use Redis Backend (`backend: 'redis'`) when:
- ✅ Operation needs to be queried/listed via GraphQL
- ✅ Multi-step operations that need updates
- ✅ Operations that need server-side tracking
- ✅ Data needs to be shared across service instances
- **Examples**: Campaign creation, multi-step forms, approval workflows

### Operation Type Naming Convention

Use consistent, lowercase operation types with underscores:

- `registration` - User registration
- `password_reset` - Password reset flow
- `otp_verification` - OTP verification
- `campaign` - Campaign creation
- `form` - Multi-step form
- `approval` - Approval workflow

**Pattern**: `{domain}_{action}` or `{domain}` for simple operations

### Configuration Patterns

#### JWT-based Operations

```typescript
// Option 1: Use convenience function (recommended for registration)
const registrationStore = createRegistrationStore(jwtSecret);

// Option 2: Use generic function with explicit backend
const store = createPendingOperationStore({
  backend: 'jwt', // ALWAYS specify backend explicitly
  jwtSecret: config.jwtSecret,
  defaultExpiration: '30m', // Use time format: '30m', '24h', '1d'
});
```

#### Redis-based Operations

```typescript
// Option 1: Use convenience function (if available)
const campaignStore = createCampaignStore();

// Option 2: Use generic function with explicit backend
const store = createPendingOperationStore({
  backend: 'redis', // ALWAYS specify backend explicitly
  redisKeyPrefix: 'pending:', // Default, customize if needed
  defaultExpiration: 3600, // Seconds for Redis
});
```

### Service Implementation Pattern

All services should follow this pattern:

```typescript
import { createPendingOperationStore } from 'core-service';

export class MyService {
  private operationStore: ReturnType<typeof createPendingOperationStore>;
  
  constructor(private config: MyConfig) {
    // ALWAYS specify backend explicitly
    this.operationStore = createPendingOperationStore({
      backend: 'jwt', // or 'redis'
      jwtSecret: config.jwtSecret, // Required for JWT backend
      defaultExpiration: '24h', // or number for Redis
    });
  }
  
  async createOperation(data: MyData): Promise<string> {
    const token = await this.operationStore.create(
      'my_operation', // Operation type
      data, // Operation data
      {
        operationType: 'my_operation', // Must match first parameter
        expiresIn: '24h', // Override default if needed
        metadata: { /* optional metadata */ },
      }
    );
    return token;
  }
  
  async verifyOperation(token: string): Promise<MyData | null> {
    const result = await this.operationStore.verify(token, 'my_operation');
    if (!result) {
      return null; // Invalid or expired
    }
    return result.data;
  }
}
```

### Current Service Implementations

#### ✅ auth-service

**Registration (`registration`)**
- **Service**: `RegistrationService`
- **Store**: `createRegistrationStore()` → JWT-based
- **Backend**: JWT (via convenience function)
- **Expiration**: 24 hours
- **Location**: `auth-service/src/services/registration.ts:34`
- **Status**: ✅ Aligned

**Password Reset (`password_reset`)**
- **Service**: `PasswordService`
- **Store**: `createPendingOperationStore({ backend: 'jwt', ... })` → JWT-based
- **Backend**: JWT (explicitly specified)
- **Expiration**: 30 minutes
- **Location**: `auth-service/src/services/password.ts:39`
- **Status**: ✅ Aligned

**OTP Verification (`otp_verification`)**
- **Service**: `OTPService`
- **Store**: `createPendingOperationStore({ backend: 'jwt', ... })` → JWT-based
- **Backend**: JWT (explicitly specified)
- **Expiration**: Configurable (`otpExpiryMinutes`)
- **Location**: `auth-service/src/services/otp.ts:21`
- **Status**: ✅ Aligned

#### ⚠️ Other Services

**bonus-service**
- **Status**: Not using pending operations
- **Recommendation**: Use Redis backend if multi-step bonus operations are needed

**payment-service**
- **Status**: Not using pending operations
- **Recommendation**: Consider Redis backend for payment approval workflows

**notification-service**
- **Status**: Not using pending operations
- **Recommendation**: Not needed (stateless service)

### Alignment Checklist

When implementing pending operations in any service, ensure:

- [ ] **Backend explicitly specified**: Always set `backend: 'jwt'` or `backend: 'redis'` (never rely on `'auto'` default)
- [ ] **Consistent operation types**: Use lowercase with underscores (`operation_type`)
- [ ] **Proper expiration**: Use time format for JWT (`'30m'`, `'24h'`) or seconds for Redis (`3600`)
- [ ] **Type safety**: Use `ReturnType<typeof createPendingOperationStore>` for store type
- [ ] **Error handling**: Always check `verify()` return value for `null`
- [ ] **Documentation**: Add comments explaining why JWT vs Redis backend was chosen
- [ ] **GraphQL exposure**: If Redis-based, consider adding GraphQL queries for listing/querying

### Common Mistakes to Avoid

1. ❌ **Not specifying backend**: Using `backend: 'auto'` can cause inconsistent behavior
   ```typescript
   // BAD
   createPendingOperationStore({ jwtSecret })
   
   // GOOD
   createPendingOperationStore({ backend: 'jwt', jwtSecret })
   ```

2. ❌ **Mixing expiration formats**: Using wrong format for backend
   ```typescript
   // BAD - Using time format for Redis
   createPendingOperationStore({ backend: 'redis', defaultExpiration: '24h' })
   
   // GOOD - Use seconds for Redis
   createPendingOperationStore({ backend: 'redis', defaultExpiration: 86400 })
   ```

3. ❌ **Inconsistent operation types**: Using different names for same operation
   ```typescript
   // BAD - Inconsistent naming
   store.create('registration', ...)
   store.verify(token, 'user_registration') // Mismatch!
   
   // GOOD - Consistent naming
   store.create('registration', ...)
   store.verify(token, 'registration')
   ```

4. ❌ **Not handling null returns**: Assuming `verify()` always returns data
   ```typescript
   // BAD
   const data = await store.verify(token, 'operation');
   const value = data.data.value; // Could be null!
   
   // GOOD
   const result = await store.verify(token, 'operation');
   if (!result) {
     throw new Error('Invalid or expired operation');
   }
   const value = result.data.value;
   ```

### Migration Guide

If you need to migrate from JWT to Redis (or vice versa):

1. **Assess requirements**: Do you need querying/listing? Updates?
2. **Update backend**: Change `backend: 'jwt'` to `backend: 'redis'` (or vice versa)
3. **Update expiration**: Convert time format to seconds (or vice versa)
4. **Update GraphQL**: Add/remove queries if switching to/from Redis
5. **Test thoroughly**: Ensure existing tokens still work (if migrating existing data)

**Example: Making Registration Redis-Based**

```typescript
// Current (JWT-based):
this.registrationStore = createRegistrationStore(this.config.jwtSecret);

// To Redis-based:
this.registrationStore = createPendingOperationStore({
  backend: 'redis',
  redisKeyPrefix: 'pending:',
  defaultExpiration: 86400, // 24 hours in seconds
});
```

---

## GraphQL Integration

### Redis-based Operations

If your operation uses Redis backend and needs to be queryable:

#### 1. Add GraphQL Types

```graphql
type PendingOperation {
  token: String!
  operationType: String!
  recipient: String
  channel: String
  purpose: String
  createdAt: String!
  expiresAt: String
  expiresIn: Int  # seconds until expiration
  metadata: JSON
  # Note: Sensitive data (OTP codes, passwords) should NOT be exposed
}

type PendingOperationConnection {
  nodes: [PendingOperation!]!
  totalCount: Int!
  pageInfo: PageInfo!
}
```

#### 2. Add Queries

```graphql
extend type Query {
  # List pending operations (Redis-based only)
  pendingOperations(
    operationType: String
    recipient: String
    first: Int
    after: String
  ): PendingOperationConnection!
  
  # Get specific pending operation by token
  # Works for both JWT and Redis-based
  pendingOperation(
    token: String!
    operationType: String
  ): PendingOperation
}
```

#### 3. Add Permissions

```typescript
permissions: {
  Query: {
    pendingOperations: or(hasRole('system'), isAuthenticated),
    pendingOperation: or(hasRole('system'), isAuthenticated),
  },
},
```

### JWT-based Operations

JWT-based operations cannot be listed, but you can verify specific tokens:

```graphql
pendingOperation(token: String!, operationType: String!): PendingOperation
```

### GraphQL Query Example

```graphql
query ListPendingOperations(
  $operationType: String
  $recipient: String
  $first: Int
) {
  pendingOperations(
    operationType: $operationType
    recipient: $recipient
    first: $first
  ) {
    nodes {
      token
      operationType
      recipient
      channel
      purpose
      createdAt
      expiresAt
      expiresIn
      metadata
    }
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
```

---

## Testing & Usage

### For Regular Users

1. Navigate to `/pending-operations` (if you have pending operations)
2. View your own pending operations
3. See expiration times and status

### For Admins/System Users

1. Navigate to `/pending-operations` from sidebar (System section)
2. View all pending operations across all users
3. Filter by operation type or recipient
4. Monitor system-wide pending operations

### Manual Testing Steps

1. Create a registration (should create pending operation in Redis if using Redis backend)
2. Navigate to `/pending-operations`
3. Verify operation appears in the list
4. Test filtering by operation type
5. Test filtering by recipient
6. Verify expiration countdown updates
7. Test refresh functionality

### GraphQL Testing

Use GraphQL Playground (`/playground`) to test queries:

```graphql
query {
  pendingOperations(first: 10) {
    nodes {
      token
      operationType
      recipient
      expiresIn
    }
    totalCount
  }
}
```

### Testing with Redis Entries

Since all operations are JWT-based, the `pendingOperations` query will return empty results unless:

1. You manually create Redis entries for testing
2. You switch operations to Redis backend
3. You have other services using Redis-based pending operations

**Example: Create a test Redis entry**

```typescript
const redis = getRedis();
await redis.setEx(
  'pending:registration:test-token-123',
  3600, // 1 hour TTL
  JSON.stringify({
    type: 'pending_operation',
    operationType: 'registration',
    data: {
      email: 'test@example.com',
      recipient: 'test@example.com',
      channel: 'email',
    },
    createdAt: Date.now(),
  })
);
```

### Security Best Practices

1. **Never expose sensitive data**:
   - OTP codes (even hashed)
   - Password hashes
   - Full user data

2. **Access control**:
   - Users can only see their own operations
   - Admins can see all (with proper permissions)

3. **Rate limiting**:
   - Limit query frequency
   - Prevent abuse of Redis scanning

4. **Data sanitization**:
   - Remove sensitive fields before returning
   - Log access for audit

---

## Future Enhancements

### Potential Improvements

1. **JWT Token Decoding**: Add utility to decode JWT tokens for metadata (without consuming)
2. **Better Pagination**: Implement cursor-based pagination for large datasets
3. **Search Functionality**: Add full-text search across operations
4. **Export Functionality**: Export operations to CSV/JSON
5. **Real-time Updates**: Use GraphQL subscriptions for real-time updates
6. **Operation Details Modal**: Show full operation details in a modal
7. **Bulk Operations**: Delete/expire multiple operations at once
8. **Analytics**: Show statistics and trends over time

---

## References

### Core Implementation
- **Core Service**: `core-service/src/common/pending-operation.ts`
- **Exports**: `core-service/src/index.ts`

### Auth Service Examples
- **Registration**: `auth-service/src/services/registration.ts`
- **Password Reset**: `auth-service/src/services/password.ts`
- **OTP Service**: `auth-service/src/services/otp.ts`
- **GraphQL Integration**: `auth-service/src/graphql.ts` (pendingOperations query)
- **Permissions**: `auth-service/src/index.ts`

### Frontend Implementation
- **React Component**: `app/src/pages/PendingOperations.tsx`
- **Navigation**: `app/src/App.tsx`

### Files Modified

1. `auth-service/src/graphql.ts` - Added GraphQL types and resolvers
2. `auth-service/src/index.ts` - Updated permissions and resolver creation
3. `auth-service/src/services/password.ts` - Explicit backend specification
4. `auth-service/src/services/otp.ts` - Explicit backend specification
5. `auth-service/src/services/registration.ts` - Explicit backend specification
6. `app/src/pages/PendingOperations.tsx` - New React component
7. `app/src/App.tsx` - Added route and navigation link

---

## Summary

This guide provides complete documentation for pending operations across all microservices. Key takeaways:

1. **Always specify backend explicitly** (`backend: 'jwt'` or `backend: 'redis'`)
2. **Use consistent naming** for operation types (`lowercase_with_underscores`)
3. **Follow the service implementation pattern** for consistency
4. **JWT-based operations** cannot be listed (stateless)
5. **Redis-based operations** can be queried via GraphQL
6. **Always sanitize sensitive data** before exposing via GraphQL
7. **Implement proper access control** (users see own, admins see all)

For questions or issues, refer to the implementation files listed in the References section.
