# Microservices Payment System

**Version**: 1.0.0  
**Status**: Production Ready  
**Last Updated**: 2026-01-29

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Core Service](#core-service)
5. [Database Layer](#database-layer)
6. [Caching](#caching)
7. [Redis](#redis)
8. [GraphQL Gateway](#graphql-gateway)
9. [Access Control](#access-control)
10. [Resilience Patterns](#resilience-patterns)
11. [Event System](#event-system)
12. [Error Handling](#error-handling)
13. [Configuration](#configuration)
14. [Quick Start](#quick-start)
15. [Testing](#testing)
16. [Sharding Guide](#sharding-guide)
17. [Disaster Recovery](#disaster-recovery)
18. [Roadmap](#roadmap)

---

## Overview

Microservices-based payment system with:

- **Simplified Schema**: 3 collections (wallets, transactions, transfers) - 50% write reduction
- **Generic Recovery System**: Automatic recovery of stuck operations
- **Multi-Level Caching**: Memory → Redis → Database
- **URN-Based Access Control**: RBAC/ACL/HBAC authorization engine
- **Cursor-Based Pagination**: O(1) performance regardless of page number
- **GraphQL Query Complexity**: Protection against DoS and resource exhaustion

---

## Architecture

### Principles

1. **Wallets = Single Source of Truth**: Wallet balances are authoritative
2. **Transactions = The Ledger**: Each transaction is a ledger entry (credit or debit)
3. **Transfers = User-to-User Operations**: Creates 2 transactions (double-entry)
4. **Atomic Operations**: MongoDB transactions ensure consistency
5. **Event-Driven Communication**: Services communicate via events, not HTTP

### Data Model

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `wallets` | Balance storage | `balance`, `bonusBalance`, `lockedBalance`, `userId`, `currency` |
| `transactions` | Ledger entries | `userId`, `amount`, `balance`, `charge`, `objectId`, `objectModel` |
| `transfers` | User-to-user operations | `fromUserId`, `toUserId`, `amount`, `status` |

### Dependency Graph

```
┌─────────────────┐
│  access-engine  │ (standalone RBAC/ACL library)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  core-service   │ (shared library - database, utilities, gateway)
└────────┬────────┘
         │
    ┌────┴────┬────────────┬────────────┐
    ▼         ▼            ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
│payment │ │bonus   │ │auth    │ │notification  │
│service │ │service │ │service │ │service       │
└────────┘ └────────┘ └────────┘ └──────────────┘
```

---

## Project Structure

```
tst/
├── access-engine/              # Standalone RBAC/ACL authorization
├── app/                        # React frontend
├── auth-service/               # Authentication & authorization
├── bonus-service/              # Bonus & rewards
├── bonus-shared/               # Shared bonus types
├── core-service/               # Shared library
│   └── src/
│       ├── access/             # Access control integration
│       ├── common/
│       │   ├── auth/           # JWT, permissions
│       │   ├── config/         # Configuration store
│       │   ├── events/         # Integration events, webhooks
│       │   ├── graphql/        # Validation chain, complexity, builder
│       │   ├── lifecycle/      # Startup, shutdown, tasks
│       │   ├── resilience/     # Circuit breaker, retry, recovery
│       │   ├── validation/     # Arktype validation
│       │   ├── wallet/         # Transfer, transaction helpers
│       │   ├── errors.ts       # Unified error handling
│       │   ├── logger.ts       # Logging with correlation IDs
│       │   └── utils.ts        # Date, token, string utilities
│       ├── databases/
│       │   ├── mongodb/        # MongoDB connection, repository, pagination
│       │   ├── redis/          # Redis connection, service accessor
│       │   └── cache.ts        # Multi-level cache (Memory → Redis)
│       ├── gateway/            # GraphQL gateway
│       ├── infra/              # Infrastructure generator (Docker, K8s)
│       ├── saga/               # Saga pattern engine
│       └── types/              # Shared type definitions
├── notification-service/       # Email, SMS, push notifications
├── payment-service/            # Wallet, transfer, transaction
└── scripts/                    # Test and utility scripts
```

---

## Core Service

Core service provides shared utilities for all microservices.

### Exports

```typescript
// Main import
import { ... } from 'core-service';

// Sub-exports
import { ... } from 'core-service/saga';
import { ... } from 'core-service/gateway';
import { ... } from 'core-service/infra';
import { ... } from 'core-service/access';
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `createServiceDatabaseAccess(serviceName)` | Database accessor per service |
| `createServiceRedisAccess(serviceName)` | Redis accessor per service |
| `createTransferWithTransactions(params)` | Atomic transfer with 2 transactions |
| `createGateway(config)` | GraphQL gateway |
| `paginateCollection(collection, options)` | Cursor-based pagination |
| `createRepository(config)` | CRUD repository with caching |
| `retry(fn, config)` | Retry with backoff |
| `CircuitBreaker` | Circuit breaker pattern |
| `registerRecoveryHandler(type, handler)` | Recovery system |

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
  // Optional
  fromBalanceType: 'balance',
  toBalanceType: 'balance',
  meta: { description: 'Payment' },
  session, // MongoDB session for transactions
});
```

### Wallet Types & Utilities

```typescript
import {
  // Collection constants
  COLLECTION_NAMES,           // { wallets, transfers, transactions }
  getWalletsCollection,       // Returns 'wallets'
  getTransfersCollection,     // Returns 'transfers'
  getTransactionsCollection,  // Returns 'transactions'
  
  // Transaction options
  DEFAULT_TRANSACTION_OPTIONS, // { readConcern, writeConcern, readPreference }
  
  // Wallet utilities
  getWalletId,
  getWalletBalance,
  getWalletUserId,
  validateBalanceForDebit,
  getBalanceFieldName,        // 'balance' | 'bonusBalance'
  buildWalletActivityUpdate,  // { $set: { lastActivityAt, updatedAt } }
  buildWalletUpdate,
  withTransaction,            // Session wrapper
} from 'core-service';
```

---

## Database Layer

### MongoDB

**Location**: `core-service/src/databases/mongodb/`

```
mongodb/
├── connection.ts       # Client, pool monitoring, health checks
├── service-accessor.ts # ServiceDatabaseAccessor
├── repository.ts       # CRUD operations
├── pagination.ts       # Cursor-based pagination
├── strategy.ts         # Database strategy resolver
├── strategy-config.ts  # Config-based strategy
├── utils.ts            # ObjectId helpers, find/update functions
├── errors.ts           # Duplicate key handling
├── constants.ts        # CORE_DATABASE_NAME
├── user-utils.ts       # findUserIdByRole
└── index.ts            # Re-exports
```

### Service Database Accessor

```typescript
import { createServiceDatabaseAccess } from 'core-service';

// Create accessor (one per service)
export const db = createServiceDatabaseAccess('payment-service');

// Initialize at startup
await db.initialize({ brand: 'acme', tenantId: 'default' });

// Use in code
const database = await db.getDb();
const wallets = database.collection('wallets');

// Cross-service access
const client = db.getClient();
const coreDb = client.db(CORE_DATABASE_NAME);
const users = coreDb.collection('users');

// Health & monitoring
const health = await db.checkHealth();
// → { healthy: true, latencyMs: 2, connections: 15, checkedOut: 3 }

const stats = await db.getStats();
// → { collections: 5, dataSize: 1024000, indexes: 12 }

// Index management
db.registerIndexes('wallets', [
  { key: { userId: 1 } },
  { key: { id: 1 }, unique: true },
]);
await db.ensureIndexes();
```

**API**:

| Method | Description |
|--------|-------------|
| `initialize(options?)` | Initialize with brand/tenant context |
| `getDb(tenantId?)` | Get database instance |
| `getClient()` | Get MongoClient (for sessions/transactions) |
| `isInitialized()` | Check if initialized |
| `checkHealth()` | Health check with latency |
| `getStats()` | Database statistics |
| `registerIndexes(collection, indexes)` | Register indexes |
| `ensureIndexes()` | Create registered indexes |

### Database Strategies

| Strategy | Database Name | Use Case |
|----------|---------------|----------|
| `shared` | `core_service` | Single tenant |
| `per-service` | `{service}_service` | Default (microservices) |
| `per-brand` | `brand_{brand}` | Multi-brand platform |
| `per-brand-service` | `brand_{brand}_{service}` | Max isolation |
| `per-tenant` | `tenant_{tenantId}` | Multi-tenant SaaS |
| `per-shard` | `shard_0`, `shard_1` | Horizontal partitioning |

### Connection Pool Optimization

```typescript
import { 
  getConnectionPoolStats, 
  getPoolHealthStatus,
  DEFAULT_MONGO_CONFIG,
} from 'core-service';

// Default configuration
DEFAULT_MONGO_CONFIG = {
  maxPoolSize: 100,           // Max connections per node
  minPoolSize: 10,            // Keep warm connections
  maxIdleTimeMS: 30000,       // Close idle connections after 30s
  waitQueueTimeoutMS: 10000,  // Fail fast if pool exhausted
  readPreference: 'nearest',  // Read from closest node
  writeConcern: 'majority',   // Durable writes
  retryWrites: true,
  retryReads: true,
};

// Pool statistics (event-based tracking - MongoDB 7.x best practice)
const stats = getConnectionPoolStats();
// → { totalConnections: 50, checkedOut: 12, availableConnections: 38, 
//    waitQueueSize: 0, waitQueueTimeouts: 0, ... }

// Health status
const health = getPoolHealthStatus();
// → { status: 'healthy', utilizationPercent: 24, message: 'Pool healthy' }
// → { status: 'warning', utilizationPercent: 85, message: 'High pool utilization (>80%)' }
// → { status: 'critical', utilizationPercent: 98, message: 'Pool nearly exhausted (>95%)' }
```

### MongoDB Best Practices (Driver 7.x)

**Pool Monitoring** - Use event-based tracking, NOT internal topology:

```typescript
// ✅ CORRECT: Use public APIs
const stats = getConnectionPoolStats();
const health = await db.checkHealth();

// ❌ WRONG: Never access internal topology (not a public API)
// client.topology?.s?.pool?.totalConnectionCount  // This can break!
```

**Index Creation** - No deprecated options:

```typescript
// ✅ CORRECT: Modern options only
db.registerIndexes('collection', [
  { key: { field: 1 }, unique: true },
  { key: { field: -1 }, sparse: true },
]);

// ❌ WRONG: 'background' is deprecated in MongoDB 4.2+
// { key: { field: 1 }, background: true }
```

**Deprecated/Removed Options** - Never use:

- `useNewUrlParser`, `useUnifiedTopology`, `useFindAndModify`, `useCreateIndex` - Removed in driver 4.0+
- `background` (index option) - Deprecated in MongoDB 4.2+
- Internal topology access (`client.topology?.s?.pool`) - Not a public API

### Pagination

```typescript
import { paginateCollection } from 'core-service';

const result = await paginateCollection(collection, {
  filter: { userId: 'user-123' },
  first: 20,
  after: 'cursor-from-previous-page',
  sort: { createdAt: -1 },
});

// Returns
{
  nodes: [...],      // Results
  pageInfo: {
    hasNextPage: true,
    hasPreviousPage: false,
    startCursor: '...',
    endCursor: '...',
  },
  totalCount: 150,
}
```

### Transactions

```typescript
import { withTransaction, DEFAULT_TRANSACTION_OPTIONS } from 'core-service';

// Using withTransaction helper
const result = await withTransaction({
  client: db.getClient(),
  fn: async (session) => {
    await col1.updateOne({...}, {...}, { session });
    await col2.insertOne({...}, { session });
    return { success: true };
  },
});

// Or using session directly
const session = db.getClient().startSession();
try {
  await session.withTransaction(async () => {
    await col1.updateOne({...}, {...}, { session });
    await col2.insertOne({...}, { session });
  }, DEFAULT_TRANSACTION_OPTIONS);
} finally {
  await session.endSession();
}
```

---

## Caching

### Multi-Level Cache

**Location**: `core-service/src/databases/cache.ts`

```
Cache Layers:
┌─────────────────────────────────────────────┐
│ L1: Memory Cache (~0.001ms)                 │
│ - In-process Map with TTL                   │
│ - Configurable max size (default: 10000)    │
│ - LRU-style eviction                        │
└────────────────────┬────────────────────────┘
                     │ Miss
                     ▼
┌─────────────────────────────────────────────┐
│ L2: Redis Cache (~0.5-2ms)                  │
│ - Shared across instances                   │
│ - Auto-promotes to L1 on hit                │
└────────────────────┬────────────────────────┘
                     │ Miss
                     ▼
┌─────────────────────────────────────────────┐
│ Database (~5-50ms)                          │
└─────────────────────────────────────────────┘
```

### Cache API

```typescript
import { 
  cached,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  clearCache,
  // Batch operations
  getCacheMany,
  setCacheMany,
  deleteCacheMany,
  // Cache warming
  warmCache,
  // Configuration
  configureCacheSettings,
  getCacheStats,
  // Key helpers
  createCacheKeys,
  CacheKeys,
} from 'core-service';

// Cache-aside pattern
const user = await cached('user:123', 300, () => fetchUser('123'));

// Direct operations
await setCache('key', value, 300); // TTL in seconds
const value = await getCache<T>('key');
await deleteCache('key');

// Batch operations (optimized)
const values = await getCacheMany<T>(['key1', 'key2', 'key3']);
// → Map { 'key1' => value1, 'key2' => value2, 'key3' => null }

await setCacheMany([
  { key: 'a', value: 1, ttl: 60 },
  { key: 'b', value: 2, ttl: 120 },
]);

await deleteCacheMany(['key1', 'key2']);

// Pattern deletion (uses SCAN, non-blocking)
await deleteCachePattern('user:*');

// Cache warming
await warmCache([
  { key: 'user:1', fetchFn: () => getUser(1), ttl: 600 },
  { key: 'user:2', fetchFn: () => getUser(2), ttl: 600 },
]);
// → { warmed: 2, failed: 0 }

// Configuration
configureCacheSettings({
  maxMemorySize: 10000,    // Max entries in memory
  memoryEnabled: true,
  redisEnabled: true,
  defaultTtl: 300,         // 5 minutes
  cleanupInterval: 60000,  // 1 minute
});

// Statistics
const stats = getCacheStats();
// → {
//   memory: { size: 5000, maxSize: 10000, utilizationPercent: 50, validEntries: 4800, expiredEntries: 200 },
//   hits: { memory: 15000, redis: 3000, total: 18000 },
//   misses: { memory: 5000, redis: 2000, total: 2000 },
//   hitRate: { memory: 75, redis: 60, overall: 90 },
//   operations: { writes: 8000, deletes: 500 },
// }

// Key factory
const ProductCache = createCacheKeys('product');
ProductCache.one('123');     // 'product:123'
ProductCache.list('active'); // 'products:active'
ProductCache.pattern();      // 'product*'
```

---

## Redis

### Location

**Location**: `core-service/src/databases/redis/`

```
redis/
├── connection.ts       # Client, sentinel, read replicas
├── service-accessor.ts # ServiceRedisAccessor
└── index.ts            # Re-exports
```

### Service Redis Accessor

```typescript
import { createServiceRedisAccess, configureRedisStrategy } from 'core-service';

// Configure strategy at startup (once)
await configureRedisStrategy({
  strategy: 'shared',             // or 'per-brand'
  defaultUrl: 'redis://localhost:6379',
  brandUrls: {                    // Per-brand URLs (optional)
    'brand_a': 'redis://redis-a:6379',
  },
});

// Create accessor
export const redis = createServiceRedisAccess('payment-service');

// Initialize
await redis.initialize({ brand: 'acme' });

// Keys are auto-prefixed: {brand}:{service}:{key}
await redis.set('tx:123', { status: 'pending' }, 300);
// → Actually stores: acme:payment:tx:123

const value = await redis.get<{ status: string }>('tx:123');

// Batch operations
const values = await redis.mget(['key1', 'key2']);
await redis.mset([
  { key: 'a', value: 1, ttl: 60 },
  { key: 'b', value: 2 },
]);

// Pattern operations
const keys = await redis.keys('tx:*');
await redis.deletePattern('expired:*');

// Pub/sub (channels also prefixed)
await redis.publish('events', { type: 'transfer.completed' });
const unsubscribe = await redis.subscribe('events', (msg) => console.log(msg));

// Health
const health = await redis.checkHealth();
// → { healthy: true, latencyMs: 1 }
```

**Key Prefix Pattern**:
```
{brand}:{service}:{category}:{key}

Examples:
  acme:payment:tx:state:123        → Transaction state
  acme:payment:cache:wallet:456   → Wallet cache
  acme:auth:session:user:789      → User session
```

### Read Replica Support

```typescript
import { 
  connectRedis, 
  getRedis,         // Master (writes)
  getRedisForRead,  // Replica (reads) or master fallback
  hasReadReplica,
  getRedisConnectionStats,
} from 'core-service';

// Standalone (default)
await connectRedis('redis://localhost:6379');

// With Sentinel (master-slave, auto-failover)
await connectRedis({
  url: 'redis://localhost:6379',
  sentinel: {
    hosts: [
      { host: 'sentinel1', port: 26379 },
      { host: 'sentinel2', port: 26379 },
    ],
    name: 'mymaster',
  },
});

// With read replicas (read/write splitting)
await connectRedis({
  url: 'redis://master:6379',
  readReplicas: {
    enabled: true,
    urls: ['redis://replica1:6379', 'redis://replica2:6379'],
  },
});

// Read/write splitting
const master = getRedis();           // Writes
const reader = getRedisForRead();    // Reads (replica or master)
const hasReplica = hasReadReplica(); // Boolean

// Connection stats
const stats = getRedisConnectionStats();
// → { connected: true, mode: 'standalone', hasReadReplica: false, ... }
```

### Connection Options

```typescript
interface RedisConfig {
  url: string;
  connectTimeout?: number;        // Default: 5000ms
  socketTimeout?: number;         // Auto-close idle sockets
  autoReconnect?: boolean;        // Default: true
  maxReconnectRetries?: number;   // Default: 10
  reconnectDelay?: number;        // Default: 1000ms
  clientName?: string;            // Visible in CLIENT LIST
  pingInterval?: number;          // Keep-alive (for Azure Cache)
  commandsQueueMaxLength?: number;
  disableOfflineQueue?: boolean;  // Reject commands when disconnected
  sentinel?: RedisSentinelConfig;
  readReplicas?: RedisReplicaConfig;
}
```

### Redis Best Practices (node-redis v5)

**Key Scanning** - Use SCAN iterator, not KEYS:

```typescript
// ✅ CORRECT: SCAN iterator (non-blocking, production-safe)
import { scanKeysIterator, scanKeysArray } from 'core-service';
const keys = await scanKeysArray({ pattern: 'user:*', maxKeys: 1000 });

// ❌ WRONG: KEYS command blocks Redis
// await redis.keys('user:*');  // Blocks entire Redis server!
```

**Pattern Deletion** - Use SCAN-based deletion:

```typescript
// ✅ CORRECT: Uses SCAN internally
await deleteCachePattern('user:*');
await redis.deletePattern('session:*');

// ❌ WRONG: KEYS + DEL blocks Redis
// const keys = await redis.keys('user:*');
// await redis.del(keys);
```

**Connection Features** (node-redis v5.10.0+):

- `keepAlive: true` - TCP keep-alive enabled by default
- `noDelay: true` - Nagle's algorithm disabled for lower latency
- Exponential backoff with jitter for reconnection
- `clientName` - Visible in `CLIENT LIST` for debugging

---

## GraphQL Gateway

### Creation

```typescript
import { createGateway } from 'core-service';

const gateway = await createGateway({
  port: 3003,
  services: [authService, paymentService, bonusService],
  context: async (req) => ({
    user: await extractUser(req),
    tenantId: extractTenantId(req),
  }),
  // Query complexity protection
  complexity: {
    maxComplexity: 1000,
    maxDepth: 10,
    logComplexity: false,
  },
});

await gateway.start();
```

### Query Complexity Protection

**Location**: `core-service/src/common/graphql/complexity.ts`

```typescript
import { 
  createComplexityConfig,
  analyzeQueryComplexity,
  validateQueryComplexity,
  // Presets
  STRICT_COMPLEXITY_CONFIG,
  STANDARD_COMPLEXITY_CONFIG,
  RELAXED_COMPLEXITY_CONFIG,
} from 'core-service';

// Create config
const config = createComplexityConfig({
  maxComplexity: 1000,     // Default: 1000
  maxDepth: 10,            // Default: 10
  listMultiplier: 10,      // Multiplier for list fields
  logComplexity: false,
  fieldComplexities: {
    'Query.transactions': 20,
    'Mutation.createTransfer': 50,
  },
});

// Analyze (returns result)
const result = analyzeQueryComplexity(schema, query, variables, config);
// → { complexity: 150, allowed: true, maxComplexity: 1000 }

// Validate (throws if exceeded)
validateQueryComplexity(schema, query, variables, config);

// Presets
STRICT_COMPLEXITY_CONFIG   // maxComplexity: 500, maxDepth: 5 (public APIs)
STANDARD_COMPLEXITY_CONFIG // maxComplexity: 1000, maxDepth: 10 (authenticated)
RELAXED_COMPLEXITY_CONFIG  // maxComplexity: 5000, maxDepth: 15 (admin/internal)
```

### Validation Chain

```typescript
import { createValidationChain } from 'core-service';

const chain = createValidationChain()
  .requireAuth()
  .extractInput()
  .requirePermission('user', 'update', '*')
  .requireFields(['userId', 'roles'], 'input')
  .validateTypes({ roles: 'array' }, 'input')
  .build();

const result = chain.handle({ args, ctx });
if (!result.valid) throw new Error(result.error);
```

### Resolver Builder

```typescript
import { createResolverBuilder } from 'core-service';

const resolvers = createResolverBuilder()
  .addQuery('health', () => ({ status: 'ok' }))
  .addMutation('createUser', async (args, ctx) => { ... })
  .addService(authService)
  .build();
```

---

## Access Control

### Access Engine

URN-based permissions: `resource:action:target`

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

### Permission Helpers

```typescript
import { hasRole, can, isAuthenticated, isOwner, sameTenant } from 'core-service';

// In resolvers
if (!isAuthenticated(ctx)) throw new Error('Not authenticated');
if (!hasRole(ctx, 'admin')) throw new Error('Not admin');
if (!can(ctx, 'wallet:read:own')) throw new Error('No permission');
```

---

## Resilience Patterns

### Circuit Breaker

```typescript
import { CircuitBreaker, createCircuitBreaker } from 'core-service';

const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  monitoringWindow: 60000,
});

const result = await breaker.execute(async () => {
  return await externalApiCall();
});
```

### Retry

```typescript
import { retry, RetryConfigs } from 'core-service';

// With config
const result = await retry(() => apiCall(), {
  maxAttempts: 3,
  strategy: 'exponential',
  initialDelay: 100,
  maxDelay: 5000,
  jitter: true,
});

// Pre-configured
await retry(() => apiCall(), RetryConfigs.fast);     // 3 attempts, 100ms
await retry(() => apiCall(), RetryConfigs.standard); // 5 attempts, 1s
await retry(() => apiCall(), RetryConfigs.slow);     // 10 attempts, 5s
```

### Recovery System

```typescript
import { 
  registerRecoveryHandler, 
  recoverOperation,
  RecoveryJob,
  OperationStateTracker,
} from 'core-service';

// Register handler
registerRecoveryHandler('transfer', {
  findStuck: async (maxAge) => [...],
  recover: async (operation) => ({ success: true }),
});

// State tracking (Redis-backed)
const tracker = new OperationStateTracker('transfer');
await tracker.setInProgress(operationId);
await tracker.setCompleted(operationId);
await tracker.setFailed(operationId, 'Reason');

// Periodic recovery job
const job = new RecoveryJob({
  interval: 300000, // 5 minutes
  maxAge: 60000,    // 60 seconds
});
await job.start();
```

---

## Event System

### Event-Driven Communication

```typescript
import { emit, on, onPattern, startListening, createUnifiedEmitter } from 'core-service';

// Emit events
await emit('payment.completed', tenantId, userId, { paymentId, amount });

// Listen to events
on('payment.completed', async (event) => {
  console.log(event.data);
});

// Pattern matching
onPattern('payment.*', async (event) => { ... });

// Start listener
await startListening();

// Unified emitter (events + webhooks)
const emitter = createUnifiedEmitter(webhookManager);
await emitter.emit('transfer.completed', data);
```

### Webhooks

```typescript
import { createWebhookManager, initializeWebhooks } from 'core-service';

const webhookManager = createWebhookManager({
  db: await db.getDb(),
  serviceName: 'payment-service',
  retryConfig: { maxAttempts: 3 },
});

await webhookManager.register({
  url: 'https://example.com/webhook',
  events: ['transfer.completed', 'deposit.completed'],
  secret: 'webhook-secret',
});

await webhookManager.dispatch('transfer.completed', payload);
```

---

## Error Handling

### GraphQL Error

```typescript
import { GraphQLError, registerServiceErrorCodes } from 'core-service';
import { AUTH_ERRORS, AUTH_ERROR_CODES } from './error-codes.js';

// Register at startup
registerServiceErrorCodes(AUTH_ERROR_CODES);

// Throw errors (auto-logged with correlation ID)
throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId });
```

### Error Code Pattern

```typescript
// error-codes.ts
export const AUTH_ERRORS = {
  UserNotFound: 'MSAuthUserNotFound',
  InvalidToken: 'MSAuthInvalidToken',
  TokenExpired: 'MSAuthTokenExpired',
} as const;

export const AUTH_ERROR_CODES = Object.values(AUTH_ERRORS) as readonly string[];
```

### Error Discovery

```graphql
query {
  errorCodes
}
# → ["MSAuthUserNotFound", "MSAuthInvalidToken", "MSPaymentInsufficientBalance", ...]
```

---

## Configuration

### Dynamic Configuration Store

```typescript
import { 
  registerServiceConfigDefaults, 
  getConfigWithDefault,
  createConfigStore,
} from 'core-service';

// Register defaults
registerServiceConfigDefaults('auth-service', {
  jwt: { value: { expiresIn: '8h' }, sensitivePaths: ['jwt.secret'] },
  otpLength: { value: 6 },
});

// Load config (creates from defaults if missing)
const jwtConfig = await getConfigWithDefault<JwtConfig>('auth-service', 'jwt');
```

### Priority Order

1. Environment variables
2. MongoDB config store (`core_service.service_configs`)
3. Registered defaults

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB 6.0+
- Redis 6.0+

### Start Services

```powershell
.\scripts\bin\start-service-dev.ps1
```

### Environment Variables

```bash
PORT=3003
MONGO_URI=mongodb://localhost:27017/core_service
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret
```

---

## Testing

### Run Tests

```bash
cd scripts

# Payment tests (run first - creates users, drops databases)
npm run payment:test

# Bonus tests (run after payment - depends on users)
npm run bonus:test

# Channel tests
npm run channels:test
```

### Test Order

1. **Payment tests first** - Creates users, drops databases
2. **Bonus tests second** - Depends on users from payment tests

---

## Sharding Guide

### When to Shard

| Shard If | Don't Shard If |
|----------|----------------|
| Data > 500GB | Data < 100GB |
| > 50,000 ops/sec | < 10,000 ops/sec |
| Write-heavy workload | Read-heavy (use replicas) |
| Geographic distribution | Single region |
| 1000+ tenants | Simple queries |

### Recommended Shard Keys

| Collection | Shard Key | Why |
|------------|-----------|-----|
| `wallets` | `{ odsi: 1 }` (userId) | Queries always include user |
| `transactions` | `{ odsi: 1, createdAt: 1 }` | User + time range queries |
| `transfers` | `{ fromUserId: 1 }` | Queries by sender |
| `users` | `{ tenantId: 1, _id: 1 }` | Multi-tenant isolation |

### Scenarios

**Scenario 1: Small Scale (NO Sharding)**
```
Users: 100,000
Transactions/day: 50,000
Data: 20GB

→ Use: Replica Set (1 primary + 2 secondaries)
→ Config: readPreference: 'nearest' (already configured)
```

**Scenario 2: Multi-Brand (NO Sharding)**
```
Brands: 50
Users/brand: 10,000
Data: 100GB

→ Use: Per-brand databases (strategy: 'per-brand')
→ Why: Isolation without sharding complexity
```

**Scenario 3: Large Scale (SHARD)**
```
Users: 10,000,000
Transactions/day: 5,000,000
Data: 2TB

→ Use: Sharded cluster
→ Shard key: { odsi: "hashed" }
→ Why: Write throughput exceeds single server
```

### Implementation

```javascript
// 1. Enable sharding
sh.enableSharding("payment_service")

// 2. Create index
db.wallets.createIndex({ odsi: "hashed" })

// 3. Shard collection
sh.shardCollection("payment_service.wallets", { odsi: "hashed" })
```

### Current System: Sharding-Ready

- Queries include userId
- Cursor pagination (no offset)
- No cross-collection joins
- Saga pattern for distributed operations
- Per-brand strategy available

---

## Disaster Recovery

### Saga, Transaction, and Recovery Boundaries

**Critical Rule**: Each system has a distinct responsibility. Do not overlap.

| System | Responsibility | When to Use |
|--------|----------------|-------------|
| **MongoDB Transaction** | Local atomicity | Single-service operations |
| **Saga Engine** | Cross-step coordination | Multi-step operations |
| **Recovery System** | Crash repair only | Stuck operations (no heartbeat) |

**Never Do:**
- ❌ Retry a saga step inside a MongoDB transaction
- ❌ Recover something a saga already compensated
- ❌ Use compensation mode for financial operations

**Safe Patterns:**

```typescript
// ✅ Financial operations: Saga with transaction mode
sagaOptions: { useTransaction: true }  // MongoDB handles rollback

// ✅ Non-financial multi-step: Saga with compensation
sagaOptions: { useTransaction: false } // Manual compensate functions

// ✅ Standalone transfer: Self-managed transaction + recovery
createTransferWithTransactions(params); // No external session = tracked

// ✅ Transfer inside saga transaction: Uses saga's session
createTransferWithTransactions(params, { session }); // Not tracked
```

**How Recovery Knows Not to Interfere:**
- Recovery ONLY acts on operations with stale heartbeats (no update in 60s)
- Operations inside saga transactions don't use state tracking
- Successfully completed operations are marked and ignored

### Operation Recovery (Built-in)

The recovery system automatically handles stuck operations:

- **Transfer Recovery**: Stuck transfers are detected and reversed
- **Redis State Tracking**: Operations tracked with TTL
- **Background Job**: Runs every 5 minutes by default
- **Audit Trail**: Reverse operations maintain full history

### Infrastructure Backups

| Component | Backup Strategy |
|-----------|-----------------|
| **MongoDB** | Use `mongodump` / replica set oplog |
| **Redis** | RDB snapshots + AOF for persistence |
| **Config** | Stored in MongoDB (`service_configs`) |

**Recommendation**: Configure backups at infrastructure level (AWS Backup, Azure Backup, MongoDB Atlas).

---

## Roadmap

### TODO - MongoDB Hot Path Scaling ⚠️ CRITICAL

At 10M+ users, MongoDB becomes the first bottleneck. Current architecture uses MongoDB as ledger + query engine + consistency engine simultaneously.

**Symptoms you'll see:**
- P95 latency spikes on `createTransferWithTransactions`, balance reads
- MongoDB CPU fine, but lock wait time rises
- "Everything is indexed" but still slow

**Current Hot Paths (all hit MongoDB directly):**
- `getOrCreateWallet()` - findOne per call, no caching
- `createTransferWithTransactions()` - 2 wallet reads + writes per transfer
- `userWallets` query - direct collection scan
- Balance validation - reads wallet document every time

**Phase 1 - Immediate (no infra change):**
- [ ] **Write-through cache for balances** - Cache wallet.balance in Redis on write
- [ ] **Balance reads from Redis** - Fast path for balance checks
- [ ] **Read replicas for queries** - Route `userWallets` to secondaries

```typescript
// Example: Write-through pattern for balances
async function updateWalletBalance(walletId: string, newBalance: number, session: ClientSession) {
  // 1. Write to MongoDB (source of truth)
  await walletsCollection.updateOne({ id: walletId }, { $set: { balance: newBalance } }, { session });
  
  // 2. Write-through to Redis (after transaction commits)
  await setCache(`wallet:balance:${walletId}`, newBalance, 300); // 5min TTL
}

async function getWalletBalance(walletId: string): Promise<number> {
  // Fast path: Redis
  const cached = await getCache<number>(`wallet:balance:${walletId}`);
  if (cached !== null) return cached;
  
  // Slow path: MongoDB + populate cache
  const wallet = await walletsCollection.findOne({ id: walletId });
  await setCache(`wallet:balance:${walletId}`, wallet.balance, 300);
  return wallet.balance;
}
```

**Phase 2 - Next step (still MongoDB):**
- [ ] **Append-only transaction log** - Transactions are immutable events
- [ ] **Periodic balance reconciliation** - Job that rebuilds wallet.balance from transactions
- [ ] **Wallet document as derived state** - Balance = SUM(transactions), not source of truth

This buys ~5-10x headroom before needing infrastructure changes.

### TODO - Redis Segmentation by Purpose ⚠️

At scale, mixed workloads on same Redis can cause issues. Purpose-based segmentation isolates workloads.

**Current Architecture:**
- ✅ **Master-slave / Sentinel / Read replicas** - Already supported for HA + read scaling
- ⚠️ **Purpose segmentation** - All workloads share same logical Redis

**Mixed Usage (all purposes on same Redis):**
| Purpose | Key Prefix | Risk at Scale |
|---------|-----------|---------------|
| Cache | `{collection}:*` | High churn, eviction pressure |
| Recovery state | `operation_state:*` | Periodic scans by recovery job |
| Pending ops | `pending:*` | Pattern scans for token lookup |
| Sessions | Service-specific | Hot keys (VIP users) |
| Pub/Sub | Channels | Subscriber load |

**Why segmentation helps (when needed):**
- Cache eviction won't affect sessions
- Recovery job scans isolated from cache
- Pub/Sub load doesn't affect query cache
- Different eviction policies per workload

**Future Segmentation (if needed at scale):**
| Redis Instance | Purpose |
|----------------|---------|
| `redis-core` | Sessions, auth tokens |
| `redis-state` | Recovery, pending ops |
| `redis-cache` | Wallet & query cache |
| `redis-pub` | Pub/Sub, SSE, Socket.IO |

**Implementation:**
- [ ] Support multiple Redis URLs: `REDIS_CACHE_URL`, `REDIS_STATE_URL`, etc.
- [ ] Route operations to appropriate Redis instance by key prefix

**Already implemented:**
- ✅ SCAN used instead of KEYS (no blocking)
- ✅ TTLs set on all keys
- ✅ Master-slave / Sentinel / Read replica support
- ✅ Key prefixing via service accessor
- ✅ Per-brand Redis instances (optional)

### TODO - Event-Driven Recovery (Scale Optimization) ⚠️

Current recovery job uses **scan-based** approach - O(total) complexity:

```typescript
// Current: Scans ALL operation_state:transfer:* keys every 5 minutes
const keys = await scanKeysArray({ pattern: 'operation_state:transfer:*' });
for (const key of keys) {
  const data = await redis.get(key);  // N GETs
  if (isStuck(data)) recover(key);
}
```

**At scale (10M users):** Thousands of concurrent transfers = Redis pressure every 5 min.

**Mitigating factors already in place:**
- ✅ TTLs bound key count (60s in-progress, 300s completed)
- ✅ SCAN not KEYS (non-blocking)
- ✅ `maxKeys: 1000` safeguard

**Recommended: Event-driven recovery (O(stuck) complexity):**
```typescript
// Instead of scanning all keys, each operation schedules its own recovery
async function startOperation(operationId: string) {
  await stateTracker.setState(operationId, 'transfer', { status: 'in_progress' });
  
  // Schedule delayed recovery check (Redis Streams or Sorted Set)
  await scheduleRecoveryCheck(operationId, 'transfer', 60); // 60s timeout
}

// Recovery worker processes only scheduled checks (not all keys)
async function processRecoveryQueue() {
  // Only processes operations that scheduled a check AND didn't complete
  const due = await redis.zRangeByScore('recovery:scheduled', 0, Date.now());
  for (const operationId of due) {
    const state = await stateTracker.getState(operationId, 'transfer');
    if (state?.status === 'in_progress') {
      await recoverOperation(operationId);
    }
    await redis.zRem('recovery:scheduled', operationId);
  }
}
```

**Implementation options:**
- [ ] Redis Sorted Sets (ZADD with timestamp, ZRANGEBYSCORE for due items)
- [ ] Redis Streams (XADD with delay, consumer groups)
- [ ] BullMQ delayed jobs

**Benefit:** Recovery becomes O(stuck) not O(total) - only checks operations that:
1. Scheduled a recovery check AND
2. Didn't complete/cancel the check

**Note:** Current implementation works fine up to ~10K concurrent operations. Optimize when needed.

### TODO - Real-Time Connection Scaling (SSE + Socket.IO) ⚠️

At scale, SSE and Socket.IO connections become a horizontal scaling bottleneck.

**Current Architecture:**
```typescript
// Gateway manages connection state in memory
const sseConnections = new Map<string, SSEConnection>();  // Per gateway instance
activeSubscriptions.set(socketId, new Map());             // Per gateway instance
```

**Issues at scale (10M users):**
- SSE = long-lived connections, memory per node grows
- Socket.IO = stateful, needs sticky sessions or Redis adapter
- Horizontal scaling doesn't help without session affinity

**What's already good:**
- ✅ Redis pub/sub fallback for cross-instance events
- ✅ Notification service delegates to gateway (doesn't manage connections)
- ✅ Socket.IO supports Redis adapter (not yet configured)

**Phase 1 - Enable Socket.IO Redis Adapter:**
```typescript
import { createAdapter } from '@socket.io/redis-adapter';

const io = new SocketIOServer(server, {
  adapter: createAdapter(pubClient, subClient),  // Add this
});
```

**Phase 2 - Dedicated Real-Time Edge Layer (if needed):**
| Current | Recommended at Scale |
|---------|---------------------|
| Gateway handles connections | Dedicated edge service |
| Notification-service pushes | Notification-service = producer only |
| Stateful per node | Stateless business services |

**Core Rule:** Business services should not manage connection state. Push delivery to dedicated edge layer.

**Implementation options:**
- [ ] Socket.IO Redis adapter for clustering
- [ ] Dedicated WebSocket gateway (e.g., Centrifugo, Pusher)
- [ ] Managed service (AWS API Gateway WebSocket, Azure SignalR)

### TODO - Auth Service Scaling ⚠️

Auth-service handles: login, sessions, OTP, social login, pending operations.

**What's already optimized ✅:**
- JWT contains roles/permissions (no DB lookup per request)
- Token verification at gateway (no auth-service call per request)
- Permission caching with multi-level cache (Memory → Redis)
- Cross-instance invalidation via Redis pub/sub

**Remaining concerns at scale:**
| Issue | Impact |
|-------|--------|
| Sessions in MongoDB | Token refresh requires DB lookup |
| Login/logout hits DB | Login storms → DB pressure |
| Admin queries | Can scan large datasets |

**Phase 1 - Session caching (recommended):**
```typescript
// Cache session validation in Redis
async function validateRefreshToken(token: string): Promise<Session | null> {
  const tokenHash = await hashToken(token);
  
  // Fast path: Redis cache
  const cached = await getCache<Session>(`session:${tokenHash}`);
  if (cached) return cached;
  
  // Slow path: MongoDB + populate cache
  const session = await db.collection('sessions').findOne({ tokenHash });
  if (session) await setCache(`session:${tokenHash}`, session, 300);
  return session;
}
```

**Phase 2 - Split auth (if needed at scale):**
| Service | Responsibility |
|---------|----------------|
| `identity-service` | Login, tokens, sessions |
| `authorization-service` | Access-engine, permissions |

**Already implemented:**
- ✅ Gateway handles token verification (stateless)
- ✅ Permissions embedded in JWT (no lookup per request)
- ✅ Access-engine caches compiled permissions

### TODO - Notification Service Resilience ⚠️

The notification service has fan-out risk (Email + SMS + WhatsApp + SSE + Socket.IO). Missing protections:

- [ ] **Provider Circuit Breakers** - Add `CircuitBreaker` to Email, SMS, WhatsApp providers
- [ ] **Per-Channel Retry Policies** - Implement retry with backoff per provider type
- [ ] **Internal Event Queue** - Use Redis Streams or BullMQ for async processing
- [ ] **Backpressure Handling** - Add concurrency limits to `sendMultiChannel`

**Risk if not addressed**: Provider outages can cause retry storms and become system-wide latency amplifiers.

**Implementation Pattern**:
```typescript
// In provider constructor
this.circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  name: 'email-provider',
});

// In send method
return await this.circuitBreaker.execute(async () => {
  return await retry(() => this.transporter.sendMail(options), {
    maxAttempts: 3,
    baseDelay: 1000,
  });
});
```

### TODO - Observability

- [ ] **Distributed Tracing (OpenTelemetry)** - Integrate OpenTelemetry SDK, add tracing spans
- [ ] **Performance Metrics (Prometheus)** - Add `/metrics` endpoint

### Rate Limiting Note

> Implement rate limiting at infrastructure level (nginx, Cloudflare, AWS WAF) for better performance and DDoS protection.

### TODO - Testing Infrastructure ⚠️

Current tests have operational friction that blocks CI/CD scaling.

**Current Issues:**
| Issue | Evidence | Impact |
|-------|----------|--------|
| **Order-dependent** | "Make sure payment tests have run first" | Can't parallelize |
| **Drop databases** | `dropAllDatabases()` in payment tests | Slow CI, data loss |
| **Cross-service coupling** | Bonus tests depend on payment-created users | Fragile pipelines |
| **Shared mutable state** | Tests modify same users/wallets | Race conditions |

**Current test flow (problematic):**
```
Payment tests (drops DBs, creates users) → Bonus tests (uses payment users) → Auth tests
                    ↑                                    ↑
                 ORDER MATTERS                    COUPLING
```

**Recommended fixes:**

**Phase 1 - Immutable fixtures:**
```typescript
// Each test creates its own isolated data
async function withTestUser(testFn: (user: TestUser) => Promise<void>) {
  const user = await createIsolatedTestUser();  // Unique per test
  try {
    await testFn(user);
  } finally {
    await cleanupTestUser(user);  // Cleanup only own data
  }
}
```

**Phase 2 - Contract tests per service:**
```typescript
// Each service has independent tests with mocked dependencies
describe('payment-service', () => {
  beforeAll(() => mockAuthService());  // Mock, don't depend
  it('creates transfer', () => { ... });
});
```

**Phase 3 - Seeded test environments:**
```typescript
// Pre-seeded database snapshots for consistent state
await loadTestFixture('baseline-users');  // Immutable snapshot
// Tests run against snapshot, don't modify
```

**Benefits:**
- ✅ Parallel test execution
- ✅ Faster CI (no DB drops)
- ✅ Reproducible failures
- ✅ Independent service testing

### Completed

- Cursor-based pagination (O(1) performance)
- Multi-level caching (Memory → Redis)
- Batch cache operations (`getCacheMany`, `setCacheMany`)
- Connection pool optimization with monitoring
- Redis read replica support (Sentinel, read/write splitting)
- GraphQL query complexity protection
- Circuit breaker and retry patterns
- Correlation IDs for request tracing
- Generic recovery system
- Event-driven architecture

---

**Last Updated**: 2026-01-29
