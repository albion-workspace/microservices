# Architecture Improvements - Path to 10/10

**Goal**: Improve architecture to 10/10 in all categories (except testing)

**Current Status**: 9/10 ✅ (improved from 8.5/10)

**Last Updated**: 2026-01-29

---

## 📊 Current Ratings & Target Improvements

| Category | Current | Target | Priority | Status |
|----------|---------|--------|----------|--------|
| Architecture Design | 9/10 | 10/10 | High | ⏳ In Progress |
| Code Quality | 9/10 | 10/10 | High | ⚠️ Issues Found |
| Reusability | 9/10 | 10/10 | Medium | ✅ Mostly Complete |
| Performance | 9/10 | 10/10 | High | ✅ Multi-level caching, batch ops, pool optimization |
| Maintainability | 9/10 | 10/10 | Medium | ⚠️ Issues Found |
| Resilience | 9/10 | 10/10 | High | ⏳ In Progress |
| Scalability | 9/10 | 10/10 | High | ✅ Redis replicas ready, pool monitoring |

---

## ✅ Immediate Action Items (CODING_STANDARDS Compliance) - COMPLETED

**Fixed Date**: 2026-01-29

### 1. ✅ @deprecated Code Removed + Domain Types Cleanup - FIXED

| File | Items Removed |
|------|---------------|
| `core-service/src/types/events.ts` | **DELETED** - Domain-specific types don't belong in core-service |
| `core-service/src/types/references.ts` | Removed `WalletReference`, `BonusReference`, `WalletBalanceSnapshot`, `WalletBonusSummary`, `TransactionReference` (kept generic `UserReference`, `ServiceResponse`) |
| `core-service/src/common/integration.ts` | Removed `publishEvent`, `subscribeToEvents`, `startEventListener` aliases |
| `core-service/src/databases/mongodb/utils.ts` | Removed `findUserById()` |
| `core-service/src/databases/redis/connection.ts` | Removed `scanKeys()` (use `scanKeysIterator` or `scanKeysArray`) |
| `core-service/src/index.ts` | Updated exports, removed domain-specific types |
| `core-service/src/types/index.ts` | Updated exports |

**CODING_STANDARDS Compliance**: Domain-specific types should be defined in their respective services:
- `DepositCompletedData`, `WalletReference` → payment-service
- `BonusCreditedData`, `BonusReference` → bonus-service
- Generic types (`UserReference`, `ServiceResponse`, `IntegrationEvent<T>`) remain in core-service

### 2. 🟡 TODO/FIXME Comments (5 remain) - PENDING

| File | Line | TODO | Status |
|------|------|------|--------|
| `auth-service/src/services/registration.ts` | 192, 554 | Uncomment when providers configured | ⏳ Pending provider setup |
| `auth-service/src/services/otp.ts` | 43, 84 | Remove after testing, Uncomment when configured | ⏳ Pending provider setup |
| `auth-service/src/services/password.ts` | 476 | Uncomment when providers configured | ⏳ Pending provider setup |

**Note**: These TODOs are waiting for notification provider configuration. They are intentional placeholders.

### 3. ✅ Offset Pagination Removed from Core Types - FIXED

| File | Change |
|------|--------|
| `core-service/src/types/repository.ts` | Removed `skip?: number` from `FindManyOptions` |
| `core-service/src/databases/mongodb/repository.ts` | Removed `.skip()` from `findMany()` |

**Note**: Use `paginateCollection()` for cursor-based pagination instead.

### 4. ✅ Documentation Updated - FIXED

`auth-service/ARCHITECTURE.md` - Updated pagination example to use cursor-based pagination (`first`/`after`).

---

## 🟡 Advisory Items (Low Priority)

### 5. TypeScript `any` Usage (409 occurrences) 🟡

| Service | Approx Count | Primary Files |
|---------|--------------|---------------|
| auth-service | ~80 | `graphql.ts` (args casting), `user-repository.ts` |
| payment-service | ~90 | `wallet.ts`, `transfer.ts`, `transaction.ts` |
| bonus-service | ~100 | handlers, `persistence.ts`, `bonus.ts` |
| core-service | ~140 | `gateway/server.ts`, `transfer-helper.ts`, `repository.ts` |

**Status**: Documented as acceptable - most usage is for GraphQL dynamic building and args casting.

### 6. Import Grouping 🟡

Some files don't follow strict import grouping (blank lines between groups).

**Status**: Low priority - functionality not affected.

---

## ✅ Verified Compliant

| Check | Status | Notes |
|-------|--------|-------|
| @deprecated code | ✅ | All removed (2026-01-29) |
| Offset pagination | ✅ | Removed from core types |
| Access-engine imports | ✅ | All microservices use `core-service/access` |
| User repository cursor pagination | ✅ | Uses `paginateCollection()` correctly |
| Event-driven communication | ✅ | No direct HTTP between business services |
| GraphQL cursor pagination | ✅ | All queries use cursor pagination |
| Documentation | ✅ | ARCHITECTURE.md pagination fixed |

---

## 🎉 Completed Improvements

### ✅ Quick Wins (All 5 Completed)

1. ✅ **Remove Legacy Code** - COMPLETED
   - Removed `core-service/src/common/ledger.ts` (1682 lines)
   - Created `extractDocumentId()` helper to replace manual patterns
   - Deprecated functions properly marked with `@deprecated`
   - **Files**: `core-service/src/common/ledger.ts` (deleted), `core-service/src/common/mongodb-utils.ts`

2. ✅ **Add Core-Service Versioning** - COMPLETED
   - Version `1.0.0` set in `core-service/package.json`
   - Semantic versioning implemented
   - Exports field properly configured
   - **Files**: `core-service/package.json`

3. ✅ **Implement Cursor Pagination Everywhere** - COMPLETED
   - All GraphQL queries updated to use cursor pagination (`first`, `after`, `last`, `before`)
   - Backend schema generation enforces cursor pagination only (no `skip` parameter)
   - Frontend updated: Transactions and Transfers queries use cursor pagination
   - Removed redundant queries (deposits/withdrawals - unified transactions query)
   - Updated `auth-service/src/repositories/user-repository.ts` to use cursor pagination only (no backward compatibility)
   - Removed all offset pagination and backward compatibility code
   - **Files**: `core-service/src/common/pagination.ts`, `core-service/src/common/repository.ts`, `app/src/pages/PaymentGateway.tsx`, `auth-service/src/repositories/user-repository.ts`

4. ✅ **Add Health Check Endpoints** - COMPLETED
   - Unified `/health` endpoint implemented (replaces `/health/live`, `/health/ready`, `/health/metrics`)
   - Returns comprehensive status (database, Redis, cache, uptime)
   - Status codes: 200 for healthy, 503 for degraded
   - Frontend integrated (Dashboard, HealthMonitor)
   - **Files**: `core-service/src/gateway/server.ts`, `app/src/pages/HealthMonitor.tsx`, `app/src/pages/Dashboard.tsx`

5. ✅ **Add Correlation IDs** - COMPLETED
   - Frontend: `generateCorrelationId()` in `graphql-utils.ts`
   - Headers: `X-Correlation-ID` and `X-Request-ID` added to all GraphQL requests
   - Backend: Correlation ID functions in `logger.ts` (`setCorrelationId`, `getCorrelationId`, `generateCorrelationId`, `withCorrelationId`)
   - Gateway: Extracts correlation ID from headers
   - Logging: Correlation IDs included in log entries
   - **Files**: `app/src/lib/graphql-utils.ts`, `core-service/src/common/logger.ts`, `core-service/src/gateway/server.ts`

### ✅ Additional Improvements Completed

6. ✅ **Circuit Breaker Pattern** - COMPLETED
   - Created `CircuitBreaker` class with three states (closed/open/half-open)
   - Prevents cascading failures from external services
   - Integrated into webhook manager (per-URL circuit breakers)
   - Integrated into exchange rate service (API calls)
   - Configurable thresholds and monitoring windows
   - **Files**: `core-service/src/common/circuit-breaker.ts`, `core-service/src/common/webhooks.ts`, `payment-service/src/services/exchange-rate.ts`

7. ✅ **Enhanced Retry Logic** - COMPLETED
   - Created `retry()` function with multiple strategies (exponential/linear/fixed)
   - Jitter support to prevent thundering herd problem
   - Retry budgets to limit retries per time window
   - Pre-configured retry configs (fast/standard/slow/fixed)
   - Integrated into webhook manager (replaced manual retry loop)
   - **Files**: `core-service/src/common/retry.ts`, `core-service/src/common/webhooks.ts`

8. ✅ **Webhook Data Model Optimization** - COMPLETED
   - Merged webhook delivery records as sub-documents within webhook documents
   - Removed separate `webhook_deliveries` collections (saves data and operations)
   - Updated GraphQL schema to reflect merged structure (`deliveries` array, `deliveryCount`)
   - Removed backward compatibility code and legacy collection references
   - Updated React app UI with improved webhook display
   - **Files**: `core-service/src/common/webhooks.ts`, `app/src/pages/Webhooks.tsx`

9. ✅ **Bonus Pool Refactoring** - COMPLETED
   - Refactored to use system user's `bonusBalance` as bonus pool
   - Removed separate `bonus-pool@system.com` user requirement
   - Direct transfers: `system (bonus) → user (bonus)`
   - **Files**: `bonus-service/src/services/bonus.ts`, `payment-service/src/services/wallet.ts`

10. ✅ **ID Extraction Helper** - COMPLETED
    - Created `extractDocumentId()` helper in `core-service/src/common/mongodb-utils.ts`
    - Replaced all manual `id`/`_id` checking patterns across services
    - Consistent document ID handling throughout codebase
    - **Files**: `core-service/src/common/mongodb-utils.ts`, used across all services

11. ✅ **Comprehensive Documentation** - COMPLETED
    - Created comprehensive `auth-service/README.md`
    - Session management documentation
    - Removed redundant markdown files
    - **Files**: `auth-service/README.md`

12. ✅ **React App Enhancements** - COMPLETED
    - Added bonus balance indicators to wallet dashboard
    - System card shows bonus pool balance
    - Visual indicators with 🎁 emoji and orange color
    - **Files**: `app/src/pages/PaymentGateway.tsx`

13. ✅ **Standardized Database Access Pattern** - COMPLETED (2026-01-29)
    - Created `createServiceDatabaseAccess()` in core-service for consistent database access
    - All microservices migrated to use the new pattern:
      - `auth-service/src/database.ts` - uses 'core-service' (shared database)
      - `payment-service/src/database.ts` - uses 'payment-service'
      - `notification-service/src/database.ts` - uses 'notification-service'
      - `bonus-service/src/database.ts` - uses 'bonus-service'
    - Clear API: `db.initialize()` at startup, `await db.getDb()` for database access
    - Works with all database strategies (shared, per-service, per-tenant, etc.)
    - Future-proof: new services have clear pattern to follow
    - **Files**: 
      - `core-service/src/databases/mongodb/service-accessor.ts` (NEW)
      - `auth-service/src/database.ts` (NEW)
      - `payment-service/src/database.ts` (NEW)
      - `notification-service/src/database.ts` (NEW)
      - `bonus-service/src/database.ts` (NEW)

14. ✅ **MongoDB Pattern Consolidation** - COMPLETED (2026-01-29)
    - Created centralized collection constants: `COLLECTION_NAMES` (wallets, transfers, transactions)
    - Created collection getters: `getWalletsCollection()`, `getTransfersCollection()`, `getTransactionsCollection()`
    - Created `DEFAULT_TRANSACTION_OPTIONS` for consistent MongoDB transaction settings
    - Created `buildWalletActivityUpdate()` and `buildWalletUpdate()` helpers
    - Replaced hardcoded collection strings with getters across core-service
    - Standardized import grouping across services per CODING_STANDARDS
    - **Files**: `core-service/src/common/wallet-types.ts`, `core-service/src/common/transfer-helper.ts`, `core-service/src/common/transaction-helper.ts`

15. ✅ **ServiceDatabaseAccessor Enhanced API** - COMPLETED (2026-01-29)
    - Extended `ServiceDatabaseAccessor` with full database management capabilities:
      - `getClient()` - Get MongoDB client for sessions/transactions and cross-service database access
      - `checkHealth()` - Database health check with latency & connection info
      - `getStats()` - Database statistics (collections, data size, indexes)
      - `registerIndexes(collection, indexes)` - Register indexes for a collection
      - `ensureIndexes()` - Create all registered indexes
      - `getRegisteredIndexes()` - Get all registered indexes
    - Added typed interfaces: `DatabaseIndexConfig`, `HealthCheckResult`, `DatabaseStats`
    - Updated `ConfigStore` to accept `ServiceDatabaseAccessor` via `accessor` option
    - Services use `db.getClient()` for cross-service database access (e.g., accessing core_service from payment-service)
    - Organized core-service exports into PUBLIC vs INTERNAL/ADVANCED sections in `index.ts`
    - **Files**:
      - `core-service/src/databases/mongodb/service-accessor.ts` (UPDATED)
      - `core-service/src/common/config-store.ts` (UPDATED)
      - `core-service/src/index.ts` (UPDATED exports)
      - `payment-service/src/common/reference-resolver.ts` (migrated to accessor)
      - `bonus-service/src/services/bonus-engine/user-status.ts` (migrated to accessor)

---

## 📋 Detailed Improvement Plan

## 1. Architecture Design (9/10 → 10/10)

### 1.1 Add Core-Service Versioning ✅ COMPLETED
- ✅ Version `1.0.0` set in `core-service/package.json`
- ✅ Semantic versioning implemented
- ✅ Exports field properly configured
- ⏳ CHANGELOG.md - **PENDING** (should be created for future breaking changes)
- ⏳ Service dependencies - Currently using `file:../core-service` (local development), version ranges can be added for production

### 1.2 Service Independence ⏳ MEDIUM PRIORITY

**Problem**: Services are tightly coupled through `core-service`.

**Solution**:
- **Interface Segregation**: Split `core-service` into smaller packages:
  - `@core/transfer` - Transfer utilities only
  - `@core/transaction` - Transaction utilities only
  - `@core/recovery` - Recovery system only
  - `@core/database` - Database utilities only
  - `@core/gateway` - Gateway only
- **Dependency Injection**: Services only import what they need
- **API Contracts**: Define clear interfaces between services

**Status**: Not started (requires significant refactoring)

### 1.3 API Gateway Improvements ⏳ MEDIUM PRIORITY

**Current**: Basic gateway exists

**Enhancements**:
- Rate limiting per user/service
- Request/response caching
- Request tracing (distributed tracing)
- API versioning support
- GraphQL query complexity analysis

**Status**: Basic gateway exists, needs enhancements

---

## 2. Code Quality (9/10 → 10/10)

### 2.1 Remove Legacy Code ✅ COMPLETED
- ✅ `core-service/src/common/ledger.ts` - **REMOVED** (deleted from codebase)
- ✅ Removed backward compatibility code from `auth-service/src/repositories/user-repository.ts` (cursor pagination only)
- ✅ Removed backward compatibility from OTP verification (requires `otpToken`, no optional fields)
- ✅ Removed backward compatibility comments from GraphQL schema
- ✅ Created `extractDocumentId()` helper to replace manual patterns
- ✅ **@deprecated code + domain types removed** (2026-01-29):
  - `core-service/src/types/events.ts` - **DELETED** (domain-specific types belong in services)
  - `core-service/src/common/integration.ts` - Removed deprecated aliases
  - `core-service/src/databases/mongodb/utils.ts` - Removed `findUserById()`
  - `core-service/src/databases/redis/connection.ts` - Removed `scanKeys()`
- ✅ **Redis Strategy Pattern implemented** (2026-01-29):
  - `core-service/src/databases/redis/service-accessor.ts` - ServiceRedisAccessor with auto-prefixing
  - Per-service accessors: `bonus-service/src/redis.ts`, `auth-service/src/redis.ts`
  - Key prefixing: `{brand}:{service}:{key}` for multi-tenant isolation
  - Full API: get/set/del, mget/mset, scan, publish/subscribe, checkHealth, getStats
- ✅ **Database folder reorganization** (2026-01-29):
  - Reorganized `core-service/src/databases/` into `mongodb/` and `redis/` subfolders
  - Normalized file names: `connection.ts`, `service-accessor.ts`, `utils.ts`, `errors.ts`, etc.
  - New structure:
    ```
    databases/
    ├── mongodb/
    │   ├── connection.ts      (MongoDB client, health, indexes)
    │   ├── service-accessor.ts (ServiceDatabaseAccessor)
    │   ├── repository.ts      (CRUD operations)
    │   ├── pagination.ts      (Cursor-based pagination)
    │   ├── strategy.ts        (Database strategy resolver)
    │   ├── strategy-config.ts (Config-based strategy)
    │   ├── utils.ts           (ObjectId helpers)
    │   ├── errors.ts          (Duplicate key handling)
    │   ├── constants.ts       (CORE_DATABASE_NAME)
    │   ├── brand-tenant-store.ts
    │   ├── user-utils.ts
    │   └── index.ts           (re-exports)
    ├── redis/
    │   ├── connection.ts      (Redis client, health, pub/sub)
    │   ├── service-accessor.ts (ServiceRedisAccessor)
    │   └── index.ts           (re-exports)
    ├── cache.ts               (Hybrid memory + Redis cache)
    └── index.ts               (re-exports mongodb/, redis/, cache)
    ```
  - All internal imports updated across core-service
  - External API unchanged (exports from `core-service/src/index.ts` remain same)

### 2.2 Clean Up TODOs ⚠️ PARTIALLY COMPLETE

**Status**: ⚠️ **5 TODOs remain** (2026-01-29 scan)

**Completed**:
- ✅ `payment-service/src/services/exchange-rate.ts` - Documented as future enhancement (intentional)

**Remaining TODOs** (need resolution):
- 🔴 `auth-service/src/services/registration.ts:192` - "Uncomment when providers configured"
- 🔴 `auth-service/src/services/registration.ts:554` - "Uncomment when providers configured"
- 🔴 `auth-service/src/services/otp.ts:43` - "@TODO: Remove this after testing"
- 🔴 `auth-service/src/services/otp.ts:84` - "Uncomment when providers configured"
- 🔴 `auth-service/src/services/password.ts:476` - "Uncomment when providers configured"

**Action**: Either implement notification provider integration, remove the TODOs, or document why they remain.

### 2.3 Code Consistency ⏳ MEDIUM PRIORITY

**Improvements**:
- Standardize error messages across all services
- Consistent naming conventions (camelCase vs snake_case)
- Unified date/time handling (use ISO strings consistently)
- Standardize meta object structure across services

**Status**: Partially complete, needs standardization

---

## 3. Reusability (9/10 → 10/10)

### 3.1 Extract More Generic Patterns ⏳ MEDIUM PRIORITY

**Current**: Good generic patterns exist

**Additional Patterns**:
- **Generic Repository Pattern**: Extract to `@core/repository`
- **Generic Service Pattern**: Extract service creation pattern
- **Generic Event Handler**: Extract event handling pattern

**Status**: Good foundation exists, can be enhanced

### 3.2 Plugin System ⏳ LOW PRIORITY

**Enhancement**: Make recovery system more plugin-based
- Allow custom recovery strategies
- Plugin registry for extensions
- Hot-reloadable plugins (for development)

**Status**: Not started

---

## 4. Performance (8/10 → 10/10)

### 4.1 Implement Cursor Pagination Everywhere ✅ COMPLETED

**Status**: ✅ **COMPLETED** (2026-01-29)

**Implementation**:
- ✅ All GraphQL queries updated to use cursor pagination (`first`, `after`, `last`, `before`)
- ✅ Backend schema generation enforces cursor pagination only (no `skip` parameter)
- ✅ Frontend updated: Transactions query uses cursor pagination
- ✅ Frontend updated: Transfers query uses cursor pagination
- ✅ Removed redundant queries (deposits/withdrawals - unified transactions query covers all)
- ✅ `auth-service/src/repositories/user-repository.ts` - Uses `paginateCollection()`
- ✅ **Core types cleaned** (2026-01-29):
  - Removed `skip` from `FindManyOptions` in `core-service/src/types/repository.ts`
  - Removed `.skip()` from `findMany()` in `core-service/src/databases/mongodb/repository.ts`
- ✅ `auth-service/ARCHITECTURE.md` - Updated pagination example to cursor-based

**Performance Impact**: O(1) performance for pagination regardless of page number (vs O(n) with offset)

### 4.2 Add Batch Operations ✅ COMPLETED (2026-01-29)

**Status**: ✅ **COMPLETED**

**Implemented**:
- ✅ `getCacheMany(keys)` - Batch get from cache using Redis MGET
- ✅ `setCacheMany(entries)` - Batch set using Redis pipeline
- ✅ `deleteCacheMany(keys)` - Batch delete multiple keys
- ✅ `warmCache(entries)` - Pre-load frequently accessed data
- ✅ `bulkInsert()` / `bulkUpdate()` - Already in repository (unordered parallel operations)
- ✅ `bulkWalletBalances` - GraphQL resolver for batch wallet queries

**Files**: `core-service/src/databases/cache.ts`

### 4.3 Enhanced Caching Strategy ✅ COMPLETED (2026-01-29)

**Status**: ✅ **COMPLETED**

**Implemented**:
- ✅ **Multi-level caching**: L1 Memory → L2 Redis (memory checked FIRST, ~0.001ms vs ~0.5-2ms)
- ✅ **Write-through**: Writes go to both Memory and Redis simultaneously
- ✅ **Redis promotion**: Cache hits from Redis are promoted to memory cache
- ✅ **Cache warming**: `warmCache()` function for pre-loading data
- ✅ **Comprehensive stats**: Hit rates, memory utilization, operation counts
- ✅ **Configurable settings**: `configureCacheSettings({ maxMemorySize, defaultTtl, ... })`
- ✅ **SCAN-based deletion**: Pattern deletion uses SCAN (non-blocking) instead of KEYS

**Performance**:
- Memory hit: ~0.001ms
- Redis hit: ~0.5-2ms (+ promotes to memory)
- Database: ~5-50ms

**Files**: `core-service/src/databases/cache.ts`

### 4.4 Database Connection Pool Optimization ✅ COMPLETED (2026-01-29)

**Status**: ✅ **COMPLETED**

**Implemented**:
- ✅ `waitQueueTimeoutMS: 10000` - Fail fast if pool exhausted (10s max wait)
- ✅ `maxIdleTimeMS: 30000` - Close idle connections after 30s
- ✅ **Enhanced pool monitoring**: 
  - Total connections, checked out, available
  - Wait queue size and timeout tracking
  - Checkout/checkin counters
- ✅ `getConnectionPoolStats()` - Comprehensive pool statistics
- ✅ `getPoolHealthStatus()` - Health check with utilization warnings
  - 'healthy' (< 80%), 'warning' (80-95%), 'critical' (> 95% or timeouts)
- ✅ Event-based tracking using MongoDB 7.x official events

**Configuration**:
```typescript
DEFAULT_MONGO_CONFIG = {
  maxPoolSize: 100,
  minPoolSize: 10,
  maxIdleTimeMS: 30000,
  waitQueueTimeoutMS: 10000,  // NEW: Fail fast protection
  readPreference: 'nearest',
  writeConcern: 'majority',
  retryWrites: true,
  retryReads: true,
}
```

**Files**: `core-service/src/databases/mongodb/connection.ts`

### 4.5 Redis Read Replica Support ✅ COMPLETED (2026-01-29)

**Status**: ✅ **COMPLETED** (infrastructure ready for future use)

**Implemented**:
- ✅ **Sentinel support**: Master-slave with automatic failover
- ✅ **Read/write splitting**: `getRedis()` for writes, `getRedisForRead()` for reads
- ✅ `hasReadReplica()` - Check if read replica is available
- ✅ `getRedisConnectionStats()` - Connection statistics
- ✅ Configurable via `RedisConfig`:
  - `sentinel: { hosts: [...], name: 'mymaster' }`
  - `readReplicas: { enabled: true, urls: [...] }`

**Usage** (when infrastructure supports it):
```typescript
// Configure with Sentinel
await connectRedis({
  url: 'redis://localhost:6379',
  sentinel: {
    hosts: [{ host: 'sentinel1', port: 26379 }],
    name: 'mymaster',
  },
});

// Or with read replicas
await connectRedis({
  url: 'redis://master:6379',
  readReplicas: {
    enabled: true,
    urls: ['redis://replica1:6379', 'redis://replica2:6379'],
  },
});
```

**Files**: `core-service/src/databases/redis/connection.ts`

### 4.5 Query Optimization ⏳ MEDIUM PRIORITY

**Enhancements**:
- Add query result caching for expensive queries
- Use MongoDB aggregation pipelines for complex queries
- Add query performance monitoring
- Optimize indexes based on query patterns

**Status**: Not started

---

## 5. Maintainability (9/10 → 10/10)

### 5.1 Enhanced Documentation ✅ PARTIAL

**Completed**:
- ✅ Comprehensive auth-service documentation
- ✅ Session management documentation

**Pending**:
- ⏳ Add JSDoc comments to all public APIs
- ⏳ Add code examples in documentation
- ⏳ Create architecture decision records (ADRs)
- ⏳ Document design patterns used

### 5.2 Type Safety Enhancements ⏳ MEDIUM PRIORITY

**Improvements**:
- Add branded types for IDs (prevent ID mixing)
- Add stricter type guards
- Use discriminated unions for better type narrowing

**Status**: Not started

---

## 6. Resilience (9/10 → 10/10)

### 6.1 Circuit Breaker Pattern ✅ COMPLETED

**Status**: ✅ **COMPLETED**

**Implementation**:
- ✅ Created `CircuitBreaker` class in `core-service/src/common/circuit-breaker.ts`
- ✅ Three states: `closed` (normal), `open` (failing), `half-open` (testing recovery)
- ✅ Configurable thresholds: failure count, reset timeout, monitoring window
- ✅ Integrated into webhook manager (per-URL circuit breakers)
- ✅ Integrated into exchange rate service (API calls)

**Files**: `core-service/src/common/circuit-breaker.ts`

### 6.2 Enhanced Retry Logic ✅ COMPLETED

**Status**: ✅ **COMPLETED**

**Implementation**:
- ✅ Created `retry()` function in `core-service/src/common/retry.ts`
- ✅ Multiple retry strategies: `exponential`, `linear`, `fixed`
- ✅ Jitter support to prevent thundering herd problem
- ✅ Retry budgets (limit retries per time window)
- ✅ Configurable retryable error detection
- ✅ Pre-configured retry configs: `fast`, `standard`, `slow`, `fixed`
- ✅ Integrated into webhook manager (replaced manual retry loop)

**Files**: `core-service/src/common/retry.ts`

### 6.3 Health Checks & Monitoring ✅ COMPLETED (Basic), ⏳ ENHANCEMENTS PENDING

**Status**: ✅ **Basic Health Checks COMPLETED**, ⏳ **Advanced Monitoring PENDING**

**Completed**:
- ✅ Unified `/health` endpoint (liveness + readiness + metrics)
- ✅ Database health checks
- ✅ Redis connection status
- ✅ Cache statistics
- ✅ Frontend integration (Dashboard, HealthMonitor)

**Pending Enhancements**:
- ⏳ **Liveness probe**: Is service running? (basic exists, can enhance)
- ⏳ **Readiness probe**: Can service handle requests? (basic exists, can enhance)
- ⏳ **Startup probe**: Is service starting up?
- ⏳ **Metrics endpoint**: Prometheus-compatible metrics
- ⏳ **Distributed tracing**: OpenTelemetry integration

### 6.4 Observability ✅ PARTIAL

**Status**: ✅ **Correlation IDs COMPLETED**, ⏳ **Tracing/Metrics PENDING**

**Completed**:
- ✅ **Correlation IDs**: Track requests across services
  - Frontend: `generateCorrelationId()` in `graphql-utils.ts`
  - Headers: `X-Correlation-ID` and `X-Request-ID` added to all GraphQL requests
  - Backend: Correlation ID functions in `logger.ts`
  - Gateway: Extracts correlation ID from headers
  - Logging: Correlation IDs included in log entries
- ✅ **Structured logging**: Consistent log format with correlation IDs

**Pending**:
- ⏳ **Distributed tracing**: OpenTelemetry integration - **HIGH PRIORITY**
- ⏳ **Performance metrics**: Response times, throughput - **HIGH PRIORITY**
- ⏳ **Error tracking**: Aggregate and alert on errors - **MEDIUM PRIORITY**

### 6.5 Graceful Degradation ⏳ MEDIUM PRIORITY

**Enhancements**:
- Fallback mechanisms when dependencies fail
- Degraded mode operation
- Feature flags for non-critical features

**Status**: Not started

---

## 7. Scalability (8/10 → 10/10)

### 7.1 Horizontal Scaling Support ✅ MOSTLY COMPLETE

**Status**: ✅ **Stateless services verified**, ⏳ **Enhancements pending**

**Completed**:
- ✅ All services are stateless (no in-memory state)
- ✅ Shared state uses Redis (sessions, locks)
- ✅ MongoDB for persistent state

**Pending Enhancements**:
- ⏳ **Load balancing**: Support multiple service instances (infrastructure)
- ⏳ **Service discovery**: Dynamic service registration (infrastructure)

### 7.2 Database Sharding Strategy ⏳ HIGH PRIORITY

**Current**: Single database per service

**Enhancements**:
- Document sharding strategy
- Shard key selection (by tenantId, userId)
- Cross-shard query handling

**Status**: Not started (documentation needed)

### 7.3 Read Replicas ⏳ MEDIUM PRIORITY

**Enhancements**:
- Use MongoDB read preferences
- Route read queries to replicas
- Route write queries to primary

**Status**: Not started

### 7.4 Connection Pool Optimization ⏳ HIGH PRIORITY

**Enhancements**:
- Optimize pool sizes per service
- Monitor pool usage
- Auto-scale pool based on load

**Status**: Basic connection exists, needs optimization

### 7.5 Event-Driven Architecture ⏳ MEDIUM PRIORITY

**Enhancements**:
- More async communication between services
- Event sourcing for audit trail
- Event replay for recovery

**Status**: Some event-driven patterns present, can expand

---

## 🧪 Code Quality & Testing Improvements

### TypeScript Type Safety

#### Review TypeScript `any` Usage ✅ PARTIALLY ADDRESSED

**File**: `core-service/src/gateway/server.ts`

**Status**: Reviewed and improved where practical without increasing complexity

**Changes Made** (2026-01-27):
- ✅ **Error handling**: Changed `catch (error: any)` → `catch (error: unknown)` with proper type guards
- ✅ **Socket.IO callbacks**: Added specific types for callback responses `{ success: boolean; room?: string; error?: string }`
- ✅ **Documentation**: Added inline comments explaining why `any` is used for GraphQL dynamic building

**Remaining `any` Usage** (Justified):
- **GraphQL dynamic field building** (lines 310, 331, 437, 444, 475, 560): GraphQL's type system is complex and dynamic. Using strict types would require extensive type definitions that would significantly increase code size and complexity without practical benefit.
- **GraphQL context functions** (lines 767, 778): `graphql-http` and `graphql-sse` expect specific context types that don't match our `GatewayContext`. Type assertion is necessary for compatibility.

**Justification**: 
- GraphQL schema building is inherently dynamic - fields are added at runtime from service definitions
- GraphQL's type system (`GraphQLType`, `GraphQLFieldConfig`, etc.) is complex and doesn't map cleanly to TypeScript's type system
- Attempting to use strict types would require extensive type definitions (~200+ lines) for minimal benefit
- The current approach balances type safety with code maintainability

**Impact**: Type safety improved where practical (error handling, Socket.IO), GraphQL `any` usage documented and justified

**Status**: ✅ **ACCEPTABLE** - Remaining `any` usage is justified and documented

---

### Testing Improvements (From Access Engine Refactoring)

After refactoring access control to use `RoleResolver` from `access-engine`, the following tests should be added to verify safety features work correctly:

#### Add Tests for Circular Inheritance Protection ⏳ PENDING

**Context**: After refactoring `store.getRolePermissions()` to use `RoleResolver`, verify circular inheritance protection works correctly.

**Action Required**:
- Add test cases for circular role inheritance
- Verify `RoleResolver` prevents infinite loops
- Test with `maxDepth` protection

**Impact**: Ensures safety feature works correctly

**Effort**: Low-Medium

**Files**: `access-engine/test/access-engine.test.ts` or `core-service/test/access.test.ts`

---

#### Add Tests for Role Expiration Filtering ⏳ PENDING

**Context**: After refactoring `CachedAccessEngine.compileUserPermissions()` to use `RoleResolver`, verify role expiration filtering works.

**Action Required**:
- Add test cases for expired roles
- Verify expired roles are filtered out
- Test with `UserRole[]` format with `expiresAt` field

**Impact**: Ensures expired roles don't grant permissions

**Effort**: Low-Medium

**Files**: `access-engine/test/access-engine.test.ts` or `core-service/test/access.test.ts`

---

#### Add Tests for Active Role Filtering ⏳ PENDING

**Context**: After refactoring to use `RoleResolver`, verify inactive roles are filtered correctly.

**Action Required**:
- Add test cases for inactive roles (`active: false`)
- Verify inactive roles are filtered out
- Test with `UserRole[]` format with `active` field

**Impact**: Ensures inactive roles don't grant permissions

**Effort**: Low-Medium

**Files**: `access-engine/test/access-engine.test.ts` or `core-service/test/access.test.ts`

---

## 🎯 Implementation Priority

### Phase 0: CODING_STANDARDS Compliance ✅ COMPLETED (2026-01-29)

1. ✅ **Remove @deprecated Code** - COMPLETED
   - Removed 21 @deprecated items from core-service
   - Updated exports in index.ts files

2. ✅ **Remove Offset Pagination from Core Types** - COMPLETED
   - Removed `skip` from `FindManyOptions`
   - Updated `findMany()` to use limit only

3. ✅ **Fix auth-service/ARCHITECTURE.md** - COMPLETED
   - Updated pagination example to cursor-based (`first`/`after`)

4. 🟡 **auth-service TODOs** - DOCUMENTED
   - 5 TODO comments remain for notification provider integration
   - Intentional placeholders, waiting for provider configuration

### Phase 1: High Priority (Next Steps)

1. ⏳ **Distributed Tracing (OpenTelemetry)** - HIGH PRIORITY
   - Integrate OpenTelemetry SDK
   - Add tracing spans to critical operations
   - Export traces to collector
   - **Estimated Time**: 8-12 hours

2. ⏳ **Performance Metrics (Prometheus)** - HIGH PRIORITY
   - Add Prometheus-compatible metrics endpoint
   - Track response times, throughput, error rates
   - Export metrics for monitoring
   - **Estimated Time**: 6-8 hours

3. ✅ **Batch Operations Optimization** - COMPLETED (2026-01-29)
   - ✅ Batch cache operations (getCacheMany, setCacheMany, deleteCacheMany)
   - ✅ Cache warming (warmCache function)
   - ✅ Bulk insert/update already in repository

4. ✅ **Multi-Level Caching** - COMPLETED (2026-01-29)
   - ✅ Memory → Redis (memory checked FIRST)
   - ✅ Write-through to both layers
   - ✅ Redis promotion to memory
   - ✅ Cache warming utilities
   - ✅ Configurable settings

5. ✅ **Database Connection Pool Optimization** - COMPLETED (2026-01-29)
   - ✅ waitQueueTimeoutMS for fail-fast protection
   - ✅ Enhanced pool monitoring with detailed stats
   - ✅ Pool health status (healthy/warning/critical)
   - ✅ Event-based tracking (MongoDB 7.x)

6. ✅ **Redis Read Replica Support** - COMPLETED (2026-01-29)
   - ✅ Sentinel configuration support
   - ✅ Read/write splitting infrastructure
   - ✅ Connection statistics

### Phase 2: Medium Priority

7. ⏳ **Database Sharding Strategy Documentation** - MEDIUM PRIORITY
   - Document sharding strategy
   - Shard key selection guidelines
   - Cross-shard query patterns
   - **Estimated Time**: 4-6 hours

8. ⏳ **Service Independence** - MEDIUM PRIORITY
   - Split `core-service` into smaller packages
   - Interface segregation
   - **Estimated Time**: 16-24 hours (significant refactoring)

9. ⏳ **API Gateway Improvements** - MEDIUM PRIORITY
   - Rate limiting per user/service
   - Request/response caching
   - GraphQL query complexity analysis
   - **Estimated Time**: 8-12 hours

10. ⏳ **Read Replicas Support** - MEDIUM PRIORITY
    - Use MongoDB read preferences
    - Route read queries to replicas
    - **Estimated Time**: 4-6 hours

### Phase 3: Low Priority / Future

11. ⏳ **Plugin System** - LOW PRIORITY
    - Make recovery system more plugin-based
    - Plugin registry for extensions
    - **Estimated Time**: 12-16 hours

12. ⏳ **Event-Driven Architecture Expansion** - LOW PRIORITY
    - More async communication between services
    - Event sourcing for audit trail
    - **Estimated Time**: 16-24 hours

13. ⏳ **Advanced Type Safety** - LOW PRIORITY
    - Branded types for IDs
    - Stricter type guards
    - **Estimated Time**: 8-12 hours

---

## 📊 Progress Summary

### ✅ CODING_STANDARDS Compliance (4 items) - COMPLETED (2026-01-29)
- ✅ Remove @deprecated code (21 items removed from core-service)
- ✅ Remove offset pagination from core types (FindManyOptions.skip removed)
- ✅ Fix auth-service/ARCHITECTURE.md pagination example
- 🟡 auth-service TODO comments (5 items - documented as intentional placeholders)

### ✅ Completed (19 items)
- Remove legacy code (ledger.ts deleted, extractDocumentId helper created)
- Remove @deprecated code (events.ts, integration.ts, mongodb-utils.ts, redis.ts)
- Add core-service versioning
- Implement cursor pagination everywhere (GraphQL + core types)
- Add health checks
- Add correlation IDs
- Circuit breaker pattern
- Enhanced retry logic
- Webhook data model optimization
- Bonus pool refactoring
- ID extraction helper
- Comprehensive documentation
- React app enhancements
- Documentation fixes (ARCHITECTURE.md pagination)
- Redis Strategy Pattern (ServiceRedisAccessor with multi-tenant key prefixing)
- **Multi-level caching** (Memory → Redis, batch ops, cache warming) ✅ NEW
- **Connection pool optimization** (waitQueueTimeoutMS, monitoring, health status) ✅ NEW
- **Batch cache operations** (getCacheMany, setCacheMany, deleteCacheMany) ✅ NEW
- **Redis read replica support** (Sentinel, read/write splitting infrastructure) ✅ NEW

### ⏳ In Progress / Next Priority (3 items)
- Distributed tracing (OpenTelemetry)
- Performance metrics (Prometheus)
- TypeScript `any` reduction (409 occurrences - documented as acceptable where justified)

### ⏳ Future Enhancements (6 items)
- Database sharding strategy documentation
- Service independence (split core-service)
- API Gateway improvements
- Plugin system
- Event-driven architecture expansion
- Advanced type safety

### ⏳ Testing Improvements (3 items)
- Add tests for circular inheritance protection
- Add tests for role expiration filtering
- Add tests for active role filtering

---

## 🎯 Expected Outcomes

After implementing remaining improvements:

| Category | Before | Current | Target | Improvement |
|----------|--------|---------|--------|-------------|
| Architecture Design | 8.5/10 | 9/10 | 10/10 | Service independence, API versioning |
| Code Quality | 8.5/10 | 9/10 | 10/10 | Legacy code removed ✅, TODOs cleaned |
| Reusability | 8.5/10 | 9/10 | 10/10 | More generic patterns |
| Performance | 8/10 | 8/10 | 10/10 | Cursor pagination ✅, caching/batching pending |
| Maintainability | 8.5/10 | 9/10 | 10/10 | Documentation ✅, JSDoc pending |
| Resilience | 8.5/10 | 9/10 | 10/10 | Circuit breaker ✅, tracing/metrics pending |
| Scalability | 8/10 | 8/10 | 10/10 | Cursor pagination ✅, sharding/pooling pending |

---

## 📝 Notes

- **Quick Wins**: All 5 completed ✅
- **Current Rating**: 9/10 (improved from 8.5/10)
- **CODING_STANDARDS Compliance**: ✅ All critical issues fixed (2026-01-29)
- **Next Focus**: Distributed tracing, performance metrics, caching, and batch operations
- **Code Cleanup**: ✅ Complete - All @deprecated code removed, offset pagination removed
- **Code Quality**: TypeScript `any` usage reviewed (409 occurrences, most documented as acceptable)
- **Code Reuse Improvements** (2026-01-29):
  - `startup-helpers.ts`: Refactored to use centralized `retry()` function (removed ~40 lines duplication)
  - `user-utils.ts`: Consolidated `findUserIdByRole` and `findUserIdsByRole` into shared internal function (removed ~50 lines duplication)
  - `wallet-types.ts`: NEW - Created type-safe wallet utilities:
    - `Wallet` interface for proper typing
    - `getWalletId()`, `getWalletBalance()`, `getWalletAllowNegative()`, etc. - type-safe accessors
    - `validateBalanceForDebit()` - shared balance validation logic
    - `resolveDatabaseConnection()` - extracted database resolution pattern (removed ~60 lines duplication)
    - `buildWalletUpdate()` - standardized wallet update builders
    - `withTransaction()` - session management wrapper
    - `getBalanceFieldName()` - single source of truth for balance field names
  - `transfer-helper.ts`: Refactored to use wallet-types utilities, proper types instead of `as any`
  - `transaction-helper.ts`: Refactored to use wallet-types utilities
  - `transfer-recovery.ts`: Removed unnecessary `as any` cast (already typed parameter)
  - `mongodb-utils.ts`: Replaced `Filter<any>` with proper generics `Filter<T extends Document>`
  - Removed deprecated `getBalanceField()` - replaced all usages with `getBalanceFieldName()`

- **Import Grouping Standardization** (2026-01-29):
  - Applied standard import order across all services (Node built-ins → External packages → Internal packages → Local imports)
  - Fixed files:
    - `core-service/src/common/transfer-helper.ts`
    - `core-service/src/common/transaction-helper.ts`
    - `auth-service/src/utils.ts` - moved imports from middle of file to top
    - `payment-service/src/index.ts` - merged duplicate core-service imports, consolidated local imports
    - `payment-service/src/services/transaction.ts` - moved Node built-in (crypto) to top
    - `bonus-service/src/index.ts` - grouped core-service/access with core-service imports

- **MongoDB Collection Consolidation** (2026-01-29):
  - Created `COLLECTION_NAMES` constants in `wallet-types.ts` (single source of truth)
  - Created collection getter helpers: `getWalletsCollection()`, `getTransfersCollection()`, `getTransactionsCollection()`
  - Replaced 18 hardcoded collection string literals across:
    - `transfer-helper.ts` - 6 occurrences
    - `transaction-helper.ts` - 4 occurrences
    - `transfer-recovery.ts` - 4 occurrences
  - Benefits: Type-safe collection access, single source of truth for collection names, easier refactoring

- **Transaction Options Consolidation** (2026-01-29):
  - Created `DEFAULT_TRANSACTION_OPTIONS` constant in `wallet-types.ts`
  - Replaced 7 duplicated transaction option blocks across:
    - `wallet-types.ts` (withTransaction helper)
    - `transfer-helper.ts` (3 occurrences)
    - `transaction-helper.ts` (2 occurrences)
    - `saga/engine.ts` (1 occurrence)
    - `recovery.ts` (1 occurrence)
  - Benefits: Single source of truth for MongoDB transaction settings, consistent behavior across all transactional operations

- **Wallet Activity Update Consolidation** (2026-01-29):
  - Created `buildWalletActivityUpdate()` helper in `wallet-types.ts`
  - Returns `{ $set: { lastActivityAt, updatedAt } }` with consistent timestamps
  - Replaced 7 duplicated timestamp patterns across:
    - `transfer-helper.ts` (5 occurrences)
    - `transaction-helper.ts` (2 occurrences)
  - Also updated `buildWalletUpdate()` to use this helper internally
  - Benefits: Consistent timestamps (same Date object for both fields), single source of truth

- **CODING_STANDARDS Documentation Update** (2026-01-29):
  - Updated to reflect actual architecture where core-service provides database abstractions
  - Changed from "Never include MongoDB in core-service" to "core-service is single source of truth for database operations"
  - Added rule: "Never import `mongodb` directly in microservices - always use `core-service` exports"
- **Remaining TODOs**: 5 items in auth-service - intentional placeholders for notification provider setup
- **Last Scan**: 2026-01-29 - Full codebase scan performed

---

**Last Updated**: 2026-01-29
