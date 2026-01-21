# Pending Operation Store - Generic Temporary Data Storage

## Overview

A generic, reusable utility for storing temporary data before committing to database. Perfect for:
- **User Registration** - Store registration data until email/phone verification
- **Campaign Creation** - Store campaign data through multi-step setup
- **Multi-step Forms** - Store form data between steps
- **Any incomplete operation** - Store sensitive data temporarily

## Architecture

### Two Backends

1. **JWT (Stateless)** - Data stored in token itself
   - ✅ No server-side storage needed
   - ✅ Works across instances without Redis
   - ✅ Automatic expiration
   - ❌ Cannot update (immutable)
   - ❌ Token size limit

2. **Redis (Stateful)** - Data stored in Redis with TTL
   - ✅ Can update data
   - ✅ No token size limit
   - ✅ Shared across instances
   - ✅ Automatic expiration via TTL
   - ❌ Requires Redis

### Auto Selection

When `backend: 'auto'`:
- Uses Redis if available
- Falls back to JWT if Redis unavailable
- Best of both worlds

---

## Usage Examples

### 1. User Registration (JWT-based)

```typescript
import { createRegistrationStore } from 'core-service';

const store = createRegistrationStore(jwtSecret);

// Store registration data
const token = await store.create('registration', {
  tenantId: 'default',
  email: 'user@example.com',
  passwordHash: await hashPassword('password123'),
  metadata: { firstName: 'John' },
}, {
  operationType: 'registration',
  expiresIn: '24h', // Expires in 24 hours
});

// Send OTP to user...

// After OTP verification, retrieve and create user
const operation = await store.verify(token, 'registration');
if (operation) {
  await createUser(operation.data);
}
```

### 2. Campaign Creation (Redis-based)

```typescript
import { createCampaignStore } from 'core-service';

const store = createCampaignStore(); // Uses Redis

// Step 1: Create campaign
const token = await store.create('campaign', {
  name: 'Summer Sale',
  budget: 10000,
  steps: ['setup', 'targeting', 'creative'],
  currentStep: 'setup',
  data: { /* campaign data */ },
}, {
  operationType: 'campaign',
  expiresIn: 3600, // 1 hour
});

// Step 2: Update campaign (Redis allows updates)
await store.update(token, 'campaign', (current) => ({
  ...current,
  currentStep: 'targeting',
  data: { ...current.data, targeting: { /* ... */ } },
}));

// Step 3: Complete campaign
const operation = await store.verify(token, 'campaign');
if (operation) {
  await createCampaign(operation.data);
}
```

### 3. Multi-step Form (Redis-based)

```typescript
import { createFormStore } from 'core-service';

const store = createFormStore(); // Uses Redis, 30min expiration

// Step 1: Personal info
const token = await store.create('form', {
  step: 1,
  personalInfo: { name: 'John', email: 'john@example.com' },
}, {
  operationType: 'form',
  expiresIn: 1800, // 30 minutes
});

// Step 2: Update with address
await store.update(token, 'form', (current) => ({
  ...current,
  step: 2,
  address: { street: '123 Main St', city: 'NYC' },
}));

// Step 3: Complete form
const operation = await store.verify(token, 'form');
if (operation) {
  await submitForm(operation.data);
}
```

### 4. Custom Store

```typescript
import { createPendingOperationStore } from 'core-service';

const store = createPendingOperationStore({
  backend: 'auto', // Prefer Redis, fallback to JWT
  jwtSecret: 'your-secret',
  redisKeyPrefix: 'custom:',
  defaultExpiration: '1h',
});

// Use same API
const token = await store.create('my-operation', data, {
  operationType: 'my-operation',
  expiresIn: '2h',
});
```

---

## API Reference

### `createPendingOperationStore(config?)`

Creates a generic pending operation store.

**Config:**
- `backend?: 'jwt' | 'redis' | 'auto'` - Backend to use (default: 'auto')
- `jwtSecret?: string` - JWT secret (required for JWT backend)
- `redisKeyPrefix?: string` - Redis key prefix (default: 'pending:')
- `defaultExpiration?: string | number` - Default expiration (default: '24h')

**Returns:**
```typescript
{
  create<T>(operationType: string, data: T, options?): Promise<string>,
  verify<T>(token: string, expectedOperationType?): Promise<Operation<T> | null>,
  update<T>(token: string, operationType: string, updates): Promise<boolean>,
  delete(token: string, operationType: string): Promise<boolean>,
  exists(token: string, operationType: string): Promise<boolean>,
  backend: 'jwt' | 'redis',
}
```

### Convenience Functions

- `createRegistrationStore(jwtSecret?)` - JWT-based, 24h expiration
- `createCampaignStore()` - Redis-based, 1h expiration
- `createFormStore()` - Redis-based, 30min expiration

---

## Benefits

1. **No DB Pollution** - Incomplete operations never touch database
2. **Automatic Cleanup** - Expires automatically (no cleanup jobs needed)
3. **Spam Prevention** - Unverified/incomplete data expires
4. **Resource Efficient** - Only verified/complete data consumes DB space
5. **Reusable** - Same pattern for registration, campaigns, forms, etc.
6. **Type Safe** - Full TypeScript support
7. **Flexible** - Choose JWT or Redis based on needs

---

## Migration from Old Registration Flow

**Old (auth-service specific):**
```typescript
import { createRegistrationToken, verifyRegistrationToken } from '../utils.js';
const token = createRegistrationToken(data, secret, '24h');
const data = verifyRegistrationToken(token, secret);
```

**New (generic, reusable):**
```typescript
import { createRegistrationStore } from 'core-service';
const store = createRegistrationStore(secret);
const token = await store.create('registration', data, { expiresIn: '24h' });
const operation = await store.verify(token, 'registration');
```

---

## Use Cases

| Use Case | Backend | Expiration | Why |
|----------|---------|------------|-----|
| Registration | JWT | 24h | Stateless, no Redis needed |
| Campaign Setup | Redis | 1h | Need to update between steps |
| Multi-step Form | Redis | 30min | Need to update between steps |
| Password Reset | JWT | 1h | Stateless, one-time use |
| Email Verification | JWT | 24h | Stateless, one-time use |

---

## Implementation Status

- ✅ Generic pending operation store in `core-service`
- ✅ JWT backend (stateless)
- ✅ Redis backend (stateful)
- ✅ Auto backend selection
- ✅ Registration service migrated
- ✅ Convenience functions for common use cases
- ✅ Full TypeScript support

---

## Next Steps

1. **Migrate auth-service** - Use generic store instead of custom JWT functions ✅
2. **Add campaign service** - Use for campaign creation flow
3. **Add form service** - Use for multi-step forms
4. **Document patterns** - Best practices for each use case
