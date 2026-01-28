# Dynamic Database Configuration

**Status**: ✅ **COMPLETE** (All 4 services migrated)  
**Last Updated**: 2026-01-28  
**Database Migration**: ✅ **COMPLETE** - `auth_service` → `core_service` (2026-01-28)

## 🎯 Overview

Similar to dynamic config management, database connection settings (URI, dbName, connection config) can now be stored **dynamically in MongoDB** instead of hardcoded in environment variables.

**Implementation Status**:
- ✅ Core implementation complete (`resolveDatabaseStrategyFromConfig`, `resolveRedisUrlFromConfig`)
- ✅ Auth-service: Database strategy + Redis URL configurable from MongoDB
- ✅ Payment-service: Database strategy + Redis URL configurable from MongoDB
- ✅ Bonus-service: Database strategy + Redis URL configurable from MongoDB
- ✅ Notification-service: Database strategy + Redis URL configurable from MongoDB

**Benefits:**
- ✅ **No redeployment**: Change database URIs without rebuilding containers
- ✅ **Multi-brand/tenant**: Different database URIs per brand/tenant
- ✅ **Sharding**: Different database URIs per shard
- ✅ **Dynamic scaling**: Add/remove databases without code changes
- ✅ **Same pattern**: Uses same strategies as config-store (per-service, per-brand, per-shard, etc.)

---

## ✅ Implementation

### Database Config Store

```typescript
import { 
  createDatabaseConfigStore,
  getDatabaseConfig 
} from 'core-service';

// Create database config store
const dbConfigStore = createDatabaseConfigStore();

// Set database config for a brand
await dbConfigStore.set({
  brand: 'brand-a',
  uri: 'mongodb://cluster.example.com/brand_a',
  dbName: 'brand_a',
  config: {
    maxPoolSize: 200,
    readPreference: 'nearest',
  },
  metadata: {
    description: 'Database for Brand A',
    updatedBy: 'admin',
  },
});

// Get database config (used automatically by database-strategy)
const dbConfig = await getDatabaseConfig({
  brand: 'brand-a',
  defaultValue: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/default',
  },
});
// → Returns: { uri: 'mongodb://cluster.example.com/brand_a', dbName: 'brand_a', config: {...} }
```

---

## 🔄 Integration with Database Strategy

The `database-strategy` automatically uses `DatabaseConfigStore` when available:

```typescript
import { 
  createPerBrandDatabaseStrategy,
  createDatabaseConfigStore 
} from 'core-service';

// 1. Set database configs dynamically
const dbConfigStore = createDatabaseConfigStore();
await dbConfigStore.set({
  brand: 'brand-a',
  uri: 'mongodb://cluster-a.example.com/brand_a',
});

await dbConfigStore.set({
  brand: 'brand-b',
  uri: 'mongodb://cluster-b.example.com/brand_b',
});

// 2. Use database strategy (automatically reads from DatabaseConfigStore)
const strategy = createPerBrandDatabaseStrategy();
const db = await strategy.resolve({
  service: 'auth-service',
  brand: 'brand-a',
});
// → Automatically connects to: mongodb://cluster-a.example.com/brand_a
```

**How it works:**
1. Database strategy builds default URI from template
2. **Before connecting**, checks `DatabaseConfigStore` for dynamic config
3. If found, uses dynamic URI/config instead of template
4. Falls back to template/default if not found

---

## 📊 Use Cases

### 1. Multi-Brand with Different Database Clusters

```typescript
// Brand A uses cluster-a
await dbConfigStore.set({
  brand: 'brand-a',
  uri: 'mongodb://cluster-a.example.com/brand_a',
});

// Brand B uses cluster-b
await dbConfigStore.set({
  brand: 'brand-b',
  uri: 'mongodb://cluster-b.example.com/brand_b',
});

// Strategy automatically routes to correct cluster
const db = await strategy.resolve({ brand: 'brand-a' });
// → cluster-a
```

### 2. Sharding with Different Database URIs

```typescript
// Each shard can have its own database cluster
await dbConfigStore.set({
  shardKey: 0,
  uri: 'mongodb://shard-cluster-0.example.com/shard_0',
});

await dbConfigStore.set({
  shardKey: 1,
  uri: 'mongodb://shard-cluster-1.example.com/shard_1',
});

// Strategy automatically routes to correct shard cluster
const db = await strategy.resolve({ 
  service: 'auth-service',
  shardKey: 'user-123', // Hash routes to shard 0 or 1
});
```

### 3. Per-Service Database URIs

```typescript
// Core service uses dedicated cluster (stores users and core entities)
await dbConfigStore.set({
  service: 'core-service',
  uri: 'mongodb://core-cluster.example.com/core_service',
});

// Payment service uses different cluster
await dbConfigStore.set({
  service: 'payment-service',
  uri: 'mongodb://payment-cluster.example.com/payment_service',
});
```

---

## 🔧 Configuration Priority

**Priority order (highest to lowest):**
1. **DatabaseConfigStore** (dynamic, MongoDB) ← **NEW**
2. URI template from strategy (`uriTemplate`)
3. Environment variable (`MONGO_URI`)
4. Default template (`mongodb://localhost:27017/{dbName}`)

**Example:**
```typescript
// Strategy template
const strategy = createPerBrandDatabaseStrategy(
  'brand_{brand}',
  'mongodb://default-cluster.example.com/brand_{brand}' // Template URI
);

// Dynamic override (takes precedence)
await dbConfigStore.set({
  brand: 'brand-a',
  uri: 'mongodb://brand-a-cluster.example.com/brand_a', // Dynamic URI
});

// Result: Uses dynamic URI (mongodb://brand-a-cluster.example.com/brand_a)
// Not template URI (mongodb://default-cluster.example.com/brand_brand-a)
```

---

## 🎯 Benefits

### Before (Static)
```typescript
// Hardcoded in environment variables
MONGO_URI=mongodb://cluster.example.com/default

// To change database, must:
// 1. Update env var
// 2. Rebuild container
// 3. Redeploy service
```

### After (Dynamic)
```typescript
// Stored in MongoDB
await dbConfigStore.set({
  brand: 'brand-a',
  uri: 'mongodb://new-cluster.example.com/brand_a',
});

// To change database:
// 1. Update MongoDB (via GraphQL/admin UI)
// 2. Done! (no rebuild/redeploy needed)
```

---

## 📝 Summary

**Dynamic Database Configuration** provides:
- ✅ **Same pattern as config-store**: Familiar API, same strategies
- ✅ **Automatic integration**: Database-strategy uses it automatically
- ✅ **No code changes**: Change database URIs without redeploying
- ✅ **Multi-brand/tenant/shard**: Different URIs per context
- ✅ **Fallback support**: Falls back to templates/env vars if not found

**Use Case**: When you need to change database connections dynamically (multi-brand, sharding, scaling) without rebuilding containers.

---

## 🗄️ Database Migration

**Status**: ✅ **COMPLETE** (2026-01-28)

### Migration: `auth_service` → `core_service`

The central database storing users and core system entities has been renamed from `auth_service` to `core_service` to better reflect its role as the central database for the system.

**Migration Script**: `scripts/typescript/config/migrate-auth-to-core-database.ts`
- Copies all collections from `auth_service` to `core_service`
- Renames `auth-service_webhooks` → `core-service_webhooks`
- Preserves all documents and indexes
- Usage: `npm run migrate:auth-to-core`

**Code Updates**:
- ✅ All services use `CORE_DATABASE_NAME` constant from `core-service`
- ✅ Cross-service references updated (e.g., `payment-service` → `core_service` for users)
- ✅ Database name templates updated

---

## 🏷️ Brand & Tenant Collections

**Status**: ✅ **COMPLETE** (2026-01-28)

Brands and tenants are now stored as collections in `core_service` database with Redis caching for performance.

**Collections**:
- `brands` - Brand definitions (id, code, name, active, metadata)
- `tenants` - Tenant definitions (id, code, name, brandId, active, metadata)

**Features**:
- ✅ Redis caching (1-hour TTL) with in-memory fallback
- ✅ Cache invalidation helpers
- ✅ Lookup by ID or code
- ✅ Query tenants by brand

**Usage**:
```typescript
import { getBrandByCode, getTenantByCode, resolveContext } from 'core-service';

// Resolve brand/tenant dynamically
const context = await resolveContext(user);
// Priority: User context → Collections → Config store → Env vars

// Direct lookup
const brand = await getBrandByCode('brand-a');
const tenant = await getTenantByCode('tenant-123');
```

**Integration**: `resolveContext()` automatically queries brand/tenant collections when resolving context, providing seamless multi-brand/tenant support.

---

## 🔧 MongoDB Driver v4 Compatibility

**Status**: ✅ **COMPLETE** (2026-01-28)

The MongoDB connection handling has been updated for compatibility with MongoDB Node.js driver v4+.

**Changes**:
- ✅ Replaced deprecated `client.topology.isConnected()` checks with ping-based verification
- ✅ Connection verification uses `db('admin').command({ ping: 1 })`
- ✅ `getDatabase()` and `getClient()` simplified to return cached instances
- ✅ All services build successfully with updated connection patterns

**Code Example**:
```typescript
// core-service/src/databases/mongodb.ts
export async function connectDatabase(uri?: string): Promise<Db> {
  if (client) {
    // Verify connection is still alive using ping
    try {
      await client.db('admin').command({ ping: 1 });
      return cachedDb!;
    } catch {
      // Connection lost, will reconnect below
      client = null;
      cachedDb = null;
    }
  }
  
  // Connect to MongoDB
  const mongoUri = uri || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  client = new MongoClient(mongoUri, mongoClientOptions);
  await client.connect();
  
  // Verify connection is healthy
  await client.db('admin').command({ ping: 1 });
  
  cachedDb = client.db(DB_NAME);
  return cachedDb;
}
```

---

## 📋 CODING_STANDARDS Compliance

**Status**: ✅ **REVIEWED** (2026-01-28)

All services have been reviewed for CODING_STANDARDS.md compliance:

### Static Imports (No Dynamic Imports)
- ✅ `auth-service`: `connectDatabase`, `getDatabase` now static imports
- ✅ `bonus-service`: `getUserId`, `getRedis` now static imports
- ✅ Dynamic imports only used for circular dependency avoidance (bonus-approval ↔ bonus-engine)

### Dead Code Removal
- ✅ `notification-service`: Removed unreachable code after `throw` statements

### Generic Helpers in core-service
- ✅ `initializeWebhooks()` - Generic webhook initialization helper
- ✅ `createServiceConfigStore()` - Generic config store creation helper

### Access Engine Imports
- ✅ All services use `core-service/access`, not direct `access-engine` imports

### Centralized Config Storage (Bootstrap Problem)
- ✅ All services store `service_configs` in `core_service` database (centralized)
- ✅ Service databases only contain business data collections
- ✅ Config is centralized due to bootstrap problem (see explanation below)

**Config Storage Strategy (Updated 2026-01-28)**:
Config storage now **follows the database strategy** with one exception:

1. **Bootstrap Config (`database` key)**: ALWAYS in `core_service.service_configs`
   - Required to solve chicken-egg problem (need strategy before knowing which DB)
2. **Service-Specific Config (other keys)**: Follows the strategy
   - `per-service`: Each service database has its own `service_configs`
   - `shared`: All config in `core_service.service_configs`

**Expected Database Collections (Per-Service Strategy)**:
| Database | Collections |
|----------|-------------|
| `core_service` | `service_configs` (bootstrap only: `database` keys), `sessions`, `users`, `brands`, `tenants` |
| `bonus_service` | `service_configs` (service-specific), `bonus_templates`, `user_bonuses`, `bonus_transactions`, `bonus_webhooks` |
| `payment_service` | `service_configs` (service-specific), `wallets`, `transfers`, `transactions`, `exchange_rates`, `payment_webhooks` |
| `notification_service` | `service_configs` (service-specific), `notifications` |

**Expected Database Collections (Shared Strategy)**:
| Database | Collections |
|----------|-------------|
| `core_service` | `service_configs` (ALL services), `sessions`, `users`, `brands`, `tenants`, ALL business data |

**Cleanup**: 
- Remove `configs` collection from `core_service` (legacy, renamed to `service_configs`)
- Remove `database_configs` from service databases (should be in `core_service.service_configs` as `database` key)

---

## 🧹 Legacy Code Cleanup (2026-01-28)

All legacy code has been removed per CODING_STANDARDS (no backward compatibility):

**Removed from bonus-service**:
- `bonusEngine` singleton → Use `createBonusEngine(options)` factory
- `validatorChain` singleton → Use `createValidatorChain(options)` factory
- `templatePersistence`, `userBonusPersistence`, `transactionPersistence` → Use `getInitializedPersistence()`
- Legacy `hasMadeFirstDeposit()`, etc. → Use `createUserStatusFunctions(options)`

**Removed from scripts**:
- `getServiceDatabaseName()` → Use `getDatabase().databaseName`
- `getMongoDatabase()` → Use `getDatabase()`

**New Pattern (bonus-service)**:
```typescript
// Use persistence-singleton for database access
import { getInitializedPersistence } from './bonus-engine/persistence-singleton.js';

const persistence = await getInitializedPersistence();
const template = await persistence.template.findByCode(code);
```

---

## 🎯 Centralized Database Connection API (NEW)

**Status**: ✅ **COMPLETE** (2026-01-28)

A simplified, centralized API for database connections that handles strategy resolution automatically.

### API Overview

```typescript
import { 
  getCentralDatabase,      // Bootstrap layer - always core_service
  getServiceDatabase,      // Business layer - uses strategy from config  
  initializeServiceDatabase, // Full initialization helper
  clearDatabaseCaches,     // Clear caches (for testing)
} from 'core-service';
```

### Usage Examples

**Simple Usage** (most common):
```typescript
// Get service database - strategy is resolved automatically from config
const db = await getServiceDatabase('bonus-service', { brand, tenantId });
const bonuses = db.collection('user_bonuses');
```

**Service Initialization** (recommended for service startup):
```typescript
const { database, strategy, context } = await initializeServiceDatabase({
  serviceName: 'bonus-service',
  brand: process.env.BRAND,
  tenantId: process.env.TENANT_ID,
});

// Use for handlers, webhooks, etc.
handlerRegistry.initialize({ databaseStrategy: strategy, defaultContext: context });
await initializeWebhooks(myWebhooks, { databaseStrategy: strategy, defaultContext: context });
```

**Bootstrap Access** (for config, auth data):
```typescript
// Central database is always core_service - fixed location
const coreDb = getCentralDatabase();
const users = coreDb.collection('users');
const configs = coreDb.collection('service_configs');
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Encapsulation** | Services don't need to know about strategy resolution |
| **Consistency** | Same pattern for all services |
| **Caching** | Database and strategy instances are cached for performance |
| **Strategy Agnostic** | Works with any strategy (per-service, per-brand, per-tenant, per-shard) |
| **Bootstrap Solved** | Central database is fixed, business databases use strategy |
