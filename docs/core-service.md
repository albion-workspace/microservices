# Core Service API

> Reference for the shared core-service library.

## Imports

```typescript
// Main import
import { ... } from 'core-service';

// Sub-exports
import { ... } from 'core-service/saga';
import { ... } from 'core-service/gateway';
import { ... } from 'core-service/infra';
import { ... } from 'core-service/access';
```

## Database

### Service Database Accessor

```typescript
import { createServiceDatabaseAccess } from 'core-service';

export const db = createServiceDatabaseAccess('payment-service');

// Initialize at startup
await db.initialize({ brand: 'acme', tenantId: 'default' });

// Use in code
const database = await db.getDb();
const wallets = database.collection('wallets');

// Health check
const health = await db.checkHealth();
// → { healthy: true, latencyMs: 2, connections: 15 }
```

### Pagination

```typescript
import { paginateCollection } from 'core-service';

const result = await paginateCollection(collection, {
  filter: { userId: 'user-123' },
  first: 20,
  after: 'cursor-from-previous-page',
  sort: { createdAt: -1 },
});
// → { nodes: [...], pageInfo: {...}, totalCount: 150 }
```

### Transactions

```typescript
import { withTransaction } from 'core-service';

const result = await withTransaction({
  client: db.getClient(),
  fn: async (session) => {
    await col1.updateOne({...}, {...}, { session });
    await col2.insertOne({...}, { session });
    return { success: true };
  },
});
```

## Redis

### Service Redis Accessor

```typescript
import { createServiceRedisAccess, configureRedisStrategy } from 'core-service';

await configureRedisStrategy({
  strategy: 'shared',
  defaultUrl: 'redis://localhost:6379',
});

export const redis = createServiceRedisAccess('payment-service');
await redis.initialize({ brand: 'acme' });

// Keys are auto-prefixed: {brand}:{service}:{key}
await redis.set('tx:123', { status: 'pending' }, 300);
const value = await redis.get<{ status: string }>('tx:123');

// Pub/sub
await redis.publish('events', { type: 'transfer.completed' });
```

## Caching

### Multi-Level Cache

```typescript
import {
  cached, getCache, setCache, deleteCache, deleteCachePattern,
  getCacheMany, setCacheMany, warmCache, getCacheStats
} from 'core-service';

// Cache-aside pattern
const user = await cached('user:123', 300, () => fetchUser('123'));

// Direct operations
await setCache('key', value, 300); // TTL in seconds
const value = await getCache<T>('key');

// Batch operations
const values = await getCacheMany<T>(['key1', 'key2', 'key3']);
await setCacheMany([{ key: 'a', value: 1, ttl: 60 }]);

// Pattern deletion (uses SCAN)
await deleteCachePattern('user:*');
```

## Wallet Operations

### Transfer Helper

```typescript
import { createTransferWithTransactions } from 'core-service';

const result = await createTransferWithTransactions({
  db,
  fromUserId: 'sender',
  toUserId: 'receiver',
  amount: 10000, // Smallest unit (cents)
  currency: 'EUR',
  type: 'transfer',
  tenantId: 'default',
});
```

### Wallet Utilities

```typescript
import {
  COLLECTION_NAMES,
  getWalletsCollection,
  getTransfersCollection,
  getTransactionsCollection,
  getWalletId,
  getWalletBalance,
  validateBalanceForDebit,
} from 'core-service';
```

## GraphQL Gateway

```typescript
import { createGateway } from 'core-service';

const gateway = await createGateway({
  port: 9001,
  services: [authService, paymentService],
  context: async (req) => ({
    user: await extractUser(req),
    tenantId: extractTenantId(req),
  }),
  complexity: {
    maxComplexity: 1000,
    maxDepth: 10,
  },
});

await gateway.start();
```

## Access Control

```typescript
import { AccessEngine } from 'core-service/access';

const engine = new AccessEngine();

engine.addRole({
  name: 'admin',
  permissions: ['*:*:*'],
});

engine.addRole({
  name: 'user',
  permissions: ['wallet:read:own', 'transfer:create:*'],
});

const result = await engine.check(user, 'wallet:read:own');
// → { allowed: true, reason: '...' }
```

## Resilience

### Circuit Breaker

```typescript
import { createCircuitBreaker } from 'core-service';

const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
});

const result = await breaker.execute(async () => {
  return await externalApiCall();
});
```

### Retry

```typescript
import { retry, RetryConfigs } from 'core-service';

const result = await retry(() => apiCall(), {
  maxAttempts: 3,
  strategy: 'exponential',
  initialDelay: 100,
});

// Pre-configured
await retry(() => apiCall(), RetryConfigs.fast);
```

## Events

```typescript
import { emit, on, startListening } from 'core-service';

// Emit events
await emit('payment.completed', tenantId, userId, { paymentId, amount });

// Listen to events
on('payment.completed', async (event) => {
  console.log(event.data);
});

await startListening();
```

## Error Handling

```typescript
import { GraphQLError, registerServiceErrorCodes } from 'core-service';

// error-codes.ts
export const AUTH_ERRORS = {
  UserNotFound: 'MSAuthUserNotFound',
  InvalidToken: 'MSAuthInvalidToken',
} as const;

export const AUTH_ERROR_CODES = Object.values(AUTH_ERRORS);

// Register at startup
registerServiceErrorCodes(AUTH_ERROR_CODES);

// Throw errors (auto-logged with correlation ID)
throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId });
```

## Configuration

```typescript
import {
  registerServiceConfigDefaults,
  getConfigWithDefault,
} from 'core-service';

// Register defaults at startup
registerServiceConfigDefaults('auth-service', {
  jwt: { value: { expiresIn: '8h' }, sensitivePaths: ['jwt.secret'] },
  otpLength: { value: 6 },
});

// Load config
const jwtConfig = await getConfigWithDefault<JwtConfig>('auth-service', 'jwt');
```

## Service Generator

Generate new microservices using the core-service generator. All current services (auth, bonus, payment, notification, kyc) are aligned to this pattern.

### Quick Start

```bash
cd core-service && npm run build
npx service-infra service --name <name> --port <port> --output ..
```

### Options

| Option | Description |
|--------|-------------|
| `--name` | Service name (e.g., `test`) |
| `--port` | Service port (e.g., `9006`) |
| `--output` | Output directory (use `..` for repo root) |
| `--webhooks` | Include webhook support |
| `--core-db` | Use core_service database |

### Generated Structure

```
{name}-service/
├── src/
│   ├── index.ts           # Entry point
│   ├── database.ts        # Database accessor
│   ├── redis.ts           # Redis accessor
│   ├── config.ts          # Config loading (SERVICE_NAME, loadConfig)
│   ├── config-defaults.ts # Default values
│   ├── types.ts           # TypeScript types (extends DefaultServiceConfig)
│   ├── error-codes.ts     # Error codes
│   └── graphql.ts         # GraphQL schema
├── package.json
└── tsconfig.json
```

### Config Pattern

**File responsibilities (no mixing):**

| File | Purpose |
|------|---------|
| `types.ts` | Type definitions only: `{Service}Config extends DefaultServiceConfig` |
| `config.ts` | Loading logic only: `loadConfig`, `validateConfig`, exports `SERVICE_NAME` |
| `config-defaults.ts` | Default values only: `{SERVICE}_CONFIG_DEFAULTS` |

**Config loading:**

```typescript
// config.ts - uses getConfigWithDefault only, no process.env
export const SERVICE_NAME = 'payment-service';

export async function loadConfig(brand?, tenantId?) {
  return {
    jwt: await getConfigWithDefault(SERVICE_NAME, 'jwt', { brand, tenantId })
          ?? await getConfigWithDefault('gateway', 'jwt'),
    // ...
  };
}
```

**Index bootstrap order:**

1. `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`
2. `resolveContext()`
3. `loadConfig(context.brand, context.tenantId)`
4. `validateConfig(config)`
5. `db.initialize({ brand, tenantId })`
6. `createGateway(...)`
7. Redis init (if `config.redisUrl`)
8. `ensureDefaultConfigsCreated(SERVICE_NAME, ...)`
9. `startListening(config.redisUrl)`
10. `registerServiceErrorCodes(...)`

### After Generating

1. Add service to `gateway/configs/services.dev.json`:
   ```json
   {
     "name": "test",
     "host": "test-service",
     "port": 9006,
     "database": "test_service",
     "healthPath": "/health",
     "graphqlPath": "/graphql"
   }
   ```

2. Regenerate and run:
   ```bash
   cd gateway
   npm run generate
   npm run dev
   ```

### Verification

```bash
# Should only return comment lines
grep -r "process\.env" src/
```

---

**See also:** [Architecture](architecture.md), [CODING_STANDARDS.md](../CODING_STANDARDS.md)
