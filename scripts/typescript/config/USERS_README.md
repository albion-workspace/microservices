# Centralized User Configuration

This directory contains `users.ts` - a centralized configuration for all test users across the microservices test suite.

## Overview

The `users.ts` file provides:
- **1 system user** (`system@demo.com`) - Full access, can go negative
- **2 provider users** (`payment-gateway@system.com`, `payment-provider@system.com`) - Payment roles
- **5 end users** (`user1@demo.com` through `user5@demo.com`) - Regular users for testing

## Usage

### Import the utilities

```typescript
import { loginAs, registerAs, getUserId, getUserIds, users, getUserDefinition } from '../config/users.js';
```

### Login as a user

```typescript
// Login by user key
const { token, userId } = await loginAs('system');
const { token } = await loginAs('paymentGateway');
const { token } = await loginAs('user1');

// Login by email
const { token } = await loginAs('system@demo.com');
```

### Register/create a user

```typescript
// Register user (returns existing if already exists)
const { userId, created } = await registerAs('system');
const { userId } = await registerAs('paymentGateway');
```

### Get user ID

```typescript
// Get single user ID
const systemUserId = await getUserId('system');
const gatewayUserId = await getUserId('paymentGateway');

// Get multiple user IDs at once
const userIds = await getUserIds(['system', 'paymentGateway', 'paymentProvider']);
// Returns: { system: '...', paymentGateway: '...', paymentProvider: '...' }
```

### Access user definitions

```typescript
// Get user definition
const systemUser = getUserDefinition('system');
console.log(systemUser.email); // 'system@demo.com'
console.log(systemUser.roles); // ['system']
console.log(systemUser.permissions); // { '*:*:*': true, allowNegative: true }

// Access via convenience exports
import { users } from '../config/users.js';
console.log(users.system.email);
console.log(users.gateway.email);
console.log(users.provider.email);
console.log(users.endUsers.user1.email);
```

### Generate JWT tokens

```typescript
import { createJWT, createSystemToken, createTokenForUser, createUserToken, decodeJWT } from '../config/users.js';

// Create a custom JWT token
const token = createJWT({ userId: '123', roles: ['user'] }, '1h');

// Create token for a specific user (uses user's roles/permissions)
const systemToken = createSystemToken(); // System token, 8h expiration
const systemTokenWithBearer = createSystemToken('1h', true); // With 'Bearer ' prefix

// Create token for any user
const gatewayToken = createTokenForUser('paymentGateway', '8h');
const userToken = createUserToken('user1', '24h');

// Decode a token (for debugging)
const payload = decodeJWT(token);
console.log(payload.roles); // ['system']
```

## Migration Guide

### Before (Old Pattern)

```typescript
const SYSTEM_EMAIL = 'system@demo.com';
const SYSTEM_PASSWORD = 'System123!@#';

async function login(): Promise<string> {
  const data = await graphql(
    AUTH_SERVICE_URL,
    `mutation Login($input: LoginInput!) { ... }`,
    {
      input: {
        tenantId: 'default-tenant',
        identifier: SYSTEM_EMAIL,
        password: SYSTEM_PASSWORD,
      },
    }
  );
  return data.login.tokens.accessToken;
}

// Get user ID manually
const usersData = await graphql(/* ... */);
const systemUser = usersData.users.nodes.find(u => u.email === SYSTEM_EMAIL);
const systemUserId = systemUser.id;
```

### After (New Pattern)

```typescript
import { loginAs, getUserId } from '../config/users.js';

async function login(): Promise<string> {
  const { token } = await loginAs('system');
  return token;
}

// Get user ID directly
const systemUserId = await getUserId('system');
```

## Available User Keys

- `system` - System user with full access
- `paymentGateway` - Payment gateway user
- `paymentProvider` - Payment provider user
- `user1` through `user5` - End users

## Benefits

✅ **Consistency** - All scripts use the same user credentials  
✅ **Maintainability** - Update credentials in one place  
✅ **Type Safety** - User keys are typed  
✅ **Simplicity** - No need to duplicate login/registration logic  
✅ **Reliability** - Handles retries, verification, and MongoDB fallbacks automatically  

## Examples

### Example 1: Simple Login

```typescript
import { loginAs } from '../config/users.js';

const { token } = await loginAs('system');
// Use token for GraphQL requests
```

### Example 2: Setup Multiple Users

```typescript
import { registerAs } from '../config/users.js';

const systemUserId = await registerAs('system');
const gatewayUserId = await registerAs('paymentGateway');
const providerUserId = await registerAs('paymentProvider');
```

### Example 3: Get User IDs for Testing

```typescript
import { getUserIds } from '../config/users.js';

const userIds = await getUserIds(['system', 'paymentGateway', 'paymentProvider']);
console.log(userIds.system); // System user ID
console.log(userIds.paymentGateway); // Gateway user ID
console.log(userIds.paymentProvider); // Provider user ID
```

### Example 4: Access User Properties

```typescript
import { users } from '../config/users.js';

console.log(users.system.email); // 'system@demo.com'
console.log(users.system.roles); // ['system']
console.log(users.gateway.permissions); // { allowNegative: true, ... }
```

## Refactoring Checklist

When refactoring scripts to use `users.ts`:

- [ ] Remove hardcoded email/password constants
- [ ] Replace custom `login()` functions with `loginAs()`
- [ ] Replace manual user ID lookups with `getUserId()` or `getUserIds()`
- [ ] Replace custom `createUser()` functions with `registerAs()`
- [ ] Update imports to include utilities from `../config/users.js`
- [ ] Test that authentication still works correctly

## Files Already Refactored

- ✅ `scripts/typescript/payment/payment-setup.ts`
- ✅ `scripts/typescript/payment/payment-test-flow.ts`

## Files That Can Be Refactored

- `scripts/typescript/payment/payment-test-all.ts`
- `scripts/typescript/payment/payment-test-funding.ts`
- `scripts/typescript/payment/payment-test-duplicate.ts`
- `scripts/typescript/bonus/bonus-setup.ts`
- `scripts/typescript/bonus/bonus-test-all.ts`
- `scripts/typescript/channels-tests.ts`
- `scripts/typescript/auth/test-auth.ts`
- And more...
