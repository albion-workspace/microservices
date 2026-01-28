# Database Access Patterns

**Last Updated**: 2026-01-28  
**Database Migration**: ✅ `auth_service` → `core_service` complete

## 🎯 Overview

This document clarifies when to use `getDatabase()` vs database strategies across different layers of the application.

---

## 📊 Database Access Patterns by Layer

### 1. **GraphQL Resolvers** ✅ **Use `getDatabase()`**

**Pattern**: GraphQL resolvers use `getDatabase()` because database strategies are initialized at the gateway level.

**Rationale**:
- GraphQL resolvers are at the **API layer**, not business logic layer
- Gateway initializes database connection at startup
- `getDatabase()` returns the default database connection for the service
- For per-service strategy (default), this works correctly
- ResolverContext doesn't include database strategy info (by design)

**Example**:
```typescript
// payment-service/src/services/wallet.ts
userWallets: async (args: Record<string, unknown>, ctx: ResolverContext) => {
  // GraphQL resolvers use getDatabase() as database strategies are initialized at gateway level
  const db = getDatabase();
  const walletsCollection = db.collection('wallets');
  // ... resolver logic
}
```

**When to use**: All GraphQL Query/Mutation resolvers

**Files**:
- `payment-service/src/services/wallet.ts` - GraphQL resolvers
- `payment-service/src/services/transaction.ts` - GraphQL resolvers
- `payment-service/src/services/exchange-rate.ts` - GraphQL resolvers
- `payment-service/src/services/transfer-approval.ts` - GraphQL resolvers
- `payment-service/src/index.ts` - GraphQL resolvers

---

### 2. **Business Logic Layer** ✅ **Use Database Strategies**

**Pattern**: Services, repositories, handlers, and business logic components use database strategies.

**Rationale**:
- Business logic needs flexibility (per-brand, per-tenant, per-shard)
- Database strategies provide dynamic resolution based on context
- Supports multi-brand/tenant architectures
- Follows CODING_STANDARDS.md (no backward compatibility fallbacks)

**Example**:
```typescript
// bonus-service/src/services/bonus-engine/engine.ts
export class BonusEngine {
  constructor(options?: BonusEngineOptions) {
    this.persistence = createBonusPersistence(options || {});
    // Uses databaseStrategy from options
  }
  
  async convert(bonusId: string, userId: string, tenantId?: string) {
    // Uses persistence layer which resolves database via strategy
    const bonus = await this.persistence.userBonus.findById(bonusId, tenantId);
  }
}
```

**When to use**: 
- Service constructors
- Repository classes
- Handler classes
- Business logic methods that need tenant/brand context

**Files**:
- `bonus-service/src/services/bonus-engine/*` - All handlers and engine
- `auth-service/src/repositories/user-repository.ts` - Repository pattern
- `auth-service/src/services/registration.ts` - Service layer
- `core-service/src/common/config-store.ts` - Config store
- `core-service/src/access/store.ts` - Access store

---

### 3. **Cross-Service Database Access** ✅ **Use `getClient()` for Other Services**

**Pattern**: When accessing another service's database, use `getClient()` to get the MongoDB client and access the specific database.

**Rationale**:
- Cross-service references need to access other service databases
- `getClient()` provides access to all databases via the MongoDB client
- This is intentional for cross-service data access

**Example**:
```typescript
// payment-service/src/common/reference-resolver.ts
export async function resolveReference(
  refId: string | undefined | null,
  refType: string | undefined | null
): Promise<any | null> {
  // CRITICAL: User references must come from core_service database, not payment_service
  if (refType === 'user' || refType === 'player') {
    const client = getClient();
    const coreDb = client.db(CORE_DATABASE_NAME);
    const usersCollection = coreDb.collection('users');
    const doc = await findOneById(usersCollection, refId, {});
    return doc;
  }
  
  // All other references come from payment_service database
  const db = getDatabase();
  // ... resolve from payment_service database
}
```

**When to use**: 
- Cross-service data access
- Reference resolution (e.g., resolving user IDs from auth-service)
- Data aggregation across services

**Files**:
- `payment-service/src/common/reference-resolver.ts` - Cross-service references

---

### 4. **Strict Database Strategy Pattern** ✅ **Require Database Strategy - No Fallbacks**

**Pattern**: Business logic handlers MUST be initialized with database strategy. No fallback to `getDatabase()` per coding standards.

**Rationale** (per CODING_STANDARDS.md):
- Pre-production: "No backward compatibility concerns"
- "Never: Keep deprecated code 'for compatibility' - remove it directly"
- Handlers should throw clear errors if not properly initialized

**Example**:
```typescript
// bonus-service/src/services/bonus-engine/base-handler.ts
protected async getUserBonusesCollection(tenantId?: string): Promise<Collection> {
  if (!this.options?.databaseStrategy && !this.options?.database) {
    throw new Error('BaseBonusHandler requires database or databaseStrategy in options. Ensure handler is initialized via handlerRegistry.initialize() with database strategy.');
  }
  const db = await resolveDatabase(this.options, 'bonus-service', tenantId);
  return db.collection('user_bonuses');
}
```

**When to use**:
- All business logic handlers must require database strategy
- Services must properly initialize handlers at startup
- Test scripts must set up proper initialization

**Files**:
- `bonus-service/src/services/bonus-engine/base-handler.ts` - Throws error if not initialized
- `bonus-service/src/services/bonus-engine/persistence.ts` - Requires database strategy
- `bonus-service/src/services/bonus-engine/validators.ts` - Requires database strategy
- `bonus-service/src/services/bonus-engine/user-status.ts` - Uses cross-service pattern for auth-db access

**Important**: Per coding standards, we do not support fallback patterns. All code paths must properly initialize handlers with database strategy via `handlerRegistry.initialize(options)`.

---

## 🔄 Decision Flow

```
┌─────────────────────────────────────┐
│ Need Database Access?               │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ GraphQL Resolver?     │ → YES → Use getDatabase()
    └──────────────────────┘
               │ NO
               ▼
    ┌──────────────────────┐
    │ Cross-Service Access? │ → YES → Use getClient().db('service_name')
    └──────────────────────┘
               │ NO
               ▼
    ┌──────────────────────┐
    │ Handler with optional │ → YES → Use Strategy with getDatabase() fallback
    │ strategy support?     │
    └──────────────────────┘
               │ NO
               ▼
    ┌──────────────────────┐
    │ Business Logic?      │ → YES → Use Database Strategy
    └──────────────────────┘
               │
               ▼
         Use resolveDatabase()
         with databaseStrategy
```

---

## 📋 Summary Table

| Layer | Pattern | Function | When to Use |
|-------|---------|----------|-------------|
| **GraphQL Resolvers** | `getDatabase()` | ✅ Acceptable | Query/Mutation resolvers at API layer |
| **Business Logic** | Database Strategy | ✅ Required | Services, repositories, core handlers |
| **Cross-Service** | `getClient().db()` | ✅ Required | Accessing other service databases |
| **Config/Access Store** | Database Strategy | ✅ Required | Dynamic config/access management |
| **Business Logic Handlers** | Database Strategy Required | ✅ Required | Handlers initialized via registry with strategy |

---

## ✅ Current Status

### GraphQL Resolvers (Payment Service)
- ✅ `payment-service/src/services/wallet.ts` - Uses `getDatabase()` ✅ **Correct**
- ✅ `payment-service/src/services/transaction.ts` - Uses `getDatabase()` ✅ **Correct**
- ✅ `payment-service/src/services/exchange-rate.ts` - Uses `getDatabase()` ✅ **Correct**
- ✅ `payment-service/src/services/transfer-approval.ts` - Uses `getDatabase()` ✅ **Correct**
- ✅ `payment-service/src/index.ts` - Uses `getDatabase()` ✅ **Correct**

### Cross-Service Access
- ✅ `payment-service/src/common/reference-resolver.ts` - Uses `getClient()` ✅ **Correct**

### Business Logic
- ✅ All bonus-service handlers use database strategies with `getDatabase()` fallback ✅ **Correct**
- ✅ All auth-service repositories use database strategies ✅ **Correct**
- ✅ All core-service components use database strategies ✅ **Correct**

### Strict Database Strategy Pattern (Bonus Service)
- ✅ `bonus-service/src/services/bonus-engine/base-handler.ts` - Requires database strategy ✅ **Correct**
- ✅ `bonus-service/src/services/bonus-engine/persistence.ts` - Requires database strategy ✅ **Correct**
- ✅ `bonus-service/src/services/bonus-engine/persistence-singleton.ts` - Centralized initialization ✅ **NEW**
- ✅ `bonus-service/src/services/bonus-engine/validators.ts` - Requires database strategy ✅ **Correct**
- ✅ `bonus-service/src/services/bonus-engine/user-status.ts` - Factory function only ✅ **Correct**
- ✅ `bonus-service/src/index.ts` - `initializeHandlerRegistry()` with strategy ✅ **Correct**
- ✅ `bonus-service/src/services/bonus.ts` - Uses `getInitializedPersistence()` ✅ **Correct**

### Legacy Code Removed (per CODING_STANDARDS - no backward compatibility)
- ✅ Removed `bonusEngine` singleton → Use `createBonusEngine(options)`
- ✅ Removed `validatorChain` singleton → Use `createValidatorChain(options)`
- ✅ Removed `templatePersistence`, `userBonusPersistence`, `transactionPersistence` → Use `getInitializedPersistence()`
- ✅ Removed legacy `hasMadeFirstDeposit()`, `hasMadeFirstPurchase()`, `hasCompletedFirstAction()` → Use `createUserStatusFunctions(options)`

---

## 🎯 Best Practices

1. **GraphQL Resolvers**: Use `getDatabase()` - it's the correct pattern for API layer
2. **Business Logic**: Always use database strategies - no fallbacks per coding standards
3. **Cross-Service**: Use `getClient().db('service_name')` for accessing other service databases
4. **Handlers**: Must be initialized with database strategy via `handlerRegistry.initialize()`
5. **Documentation**: Add comments explaining patterns used

---

## 📝 Notes

- **No Backward Compatibility**: Per CODING_STANDARDS.md, we don't support fallbacks (pre-production)
- **GraphQL Resolvers Exception**: `getDatabase()` in GraphQL resolvers is not a fallback - it's the intended pattern
- **No Handler Fallbacks**: Handlers must be properly initialized with database strategy - throw errors if not
- **Gateway Initialization**: Database strategies are initialized at gateway level, so resolvers use the default connection
- **Handler Registry**: Use `initializeHandlerRegistry()` in service startup to ensure handlers have access to database strategy
- **Multi-Brand/Tenant**: For multi-brand/tenant support in GraphQL, consider adding brand/tenant to ResolverContext in the future
- **Scripts**: Test scripts use `config/scripts.ts` which provides database access via database strategy pattern, supporting `--brand` and `--tenant` CLI arguments
- **MongoDB Driver v4**: Connection verification uses ping-based check instead of deprecated `topology.isConnected()`
- **Webhook Configuration**: Use `webhooks.configure()` to set database strategy after instantiation

---

## 🔧 Generic Helpers (core-service)

Per CODING_STANDARDS.md DRY principle, the following generic helpers are available in `core-service`:

### Webhook Initialization

```typescript
import { initializeWebhooks, createWebhookManager } from 'core-service';

// Create webhook manager (at module level)
export const myWebhooks = createWebhookManager<MyEvents>({ serviceName: 'my-service' });

// Initialize in main() after DB connection
await initializeWebhooks(myWebhooks, {
  databaseStrategy: strategy,
  defaultContext: { service: 'my-service', brand, tenantId },
});
```

### Config Store Creation

```typescript
import { createServiceConfigStore } from 'core-service';

// Creates config store with database strategy already resolved
const configStore = await createServiceConfigStore('my-service', { brand, tenantId });
```

### CODING_STANDARDS Compliance Checklist

Per CODING_STANDARDS.md, all services should:

1. ✅ **Use static imports** (not dynamic `await import()`) unless avoiding circular dependencies
2. ✅ **No dead code after throw** - Remove unreachable code after `throw` statements
3. ✅ **Use `core-service/access`** - Never import `access-engine` directly in microservices
4. ✅ **No fallback patterns** - Handlers must require database strategy (fail-fast)
5. ✅ **Generic helpers in core-service** - Common patterns should be in `core-service`, not duplicated
6. ✅ **Centralized config storage** - All `service_configs` in `core_service` database, not per-service

### Config Storage Strategy (Updated 2026-01-28)

Config storage now **follows the database strategy** with one exception:

**Bootstrap Config (`database` key): ALWAYS in `core_service.service_configs`**
- Required to solve the chicken-egg problem
- You need the strategy before knowing which database to connect to

**Service-Specific Config (other keys): Follows the strategy**
- `per-service`: Each service's database has its own `service_configs`
- `shared`: All config in `core_service.service_configs`
- `per-brand`: Config in brand database

**Example Database Layout (per-service strategy)**:
```
core_service (central + auth):
  - service_configs      # Bootstrap configs ONLY (database strategy definitions)
  - sessions, users      # Auth data
  - brands, tenants      # Multi-tenancy definitions

bonus_service (business data + service config):
  - service_configs      # Bonus-specific configs (jwt, corsOrigins, etc.)
  - bonus_templates, user_bonuses, bonus_transactions, bonus_webhooks

payment_service (business data + service config):
  - service_configs      # Payment-specific configs (exchangeRate, wallet, etc.)
  - wallets, transfers, transactions, exchange_rates, payment_webhooks

notification_service (business data + service config):
  - service_configs      # Notification-specific configs (smtp, twilio, etc.)
  - notifications
```

**Example Database Layout (shared strategy)**:
```
core_service (everything):
  - service_configs      # ALL configs for ALL services
  - sessions, users
  - brands, tenants
  - bonus_templates, user_bonuses, bonus_transactions  # Business data
  - wallets, transfers, transactions                    # Business data
  - notifications                                       # Business data
```

**Code Pattern**:
```typescript
// Bootstrap config (always from core_service)
const dbConfig = await getConfigWithDefault<DatabaseConfig>(SERVICE_NAME, 'database');

// Service-specific config (follows strategy: per-service, shared, etc.)
const jwtConfig = await getConfigWithDefault<JwtConfig>(SERVICE_NAME, 'jwt');
// If strategy is 'per-service': reads from bonus_service.service_configs
// If strategy is 'shared': reads from core_service.service_configs
```

---

## 🔄 Persistence Singleton Pattern (Bonus Service)

The bonus-service uses a persistence-singleton pattern to avoid circular dependencies:

```typescript
// bonus-service/src/services/bonus-engine/persistence-singleton.ts

// Centralized database initialization
export async function initializeDatabaseLayer(): Promise<{
  strategy: DatabaseStrategyResolver;
  context: DatabaseContext;
}> {
  // Uses initializeServiceDatabase from core-service
  const result = await initializeServiceDatabase({
    serviceName: 'bonus-service',
    brand: context.brand,
    tenantId: context.tenantId,
  });
  return { strategy: result.strategy, context: result.context };
}

// Get initialized persistence (recommended for use in sagas/resolvers)
export async function getInitializedPersistence(): Promise<BonusPersistence> {
  const { strategy, context } = await initializeDatabaseLayer();
  return createBonusPersistence({
    databaseStrategy: strategy,
    defaultContext: context,
  });
}
```

**Usage in Sagas**:
```typescript
// bonus-service/src/services/bonus.ts
import { getInitializedPersistence } from './bonus-engine/persistence-singleton.js';

// In saga step:
const persistence = await getInitializedPersistence();
const template = await persistence.template.findByCode(templateCode);
```

**Benefits**:
- Avoids circular dependencies (index.ts ↔ bonus.ts)
- Single source of truth for database initialization
- Lazy initialization with caching
- No legacy exports with empty options

---

## 🎯 Centralized Database Connection API

### Simplified API (Recommended)

Services can now use a centralized database connection API that handles strategy resolution automatically:

```typescript
import { 
  getCentralDatabase,    // Bootstrap layer - always core_service
  getServiceDatabase,    // Business layer - uses strategy from config
  initializeServiceDatabase,  // Full initialization helper
} from 'core-service';

// 1. Central database (for bootstrapping, config, auth data)
const coreDb = getCentralDatabase();
const users = coreDb.collection('users');

// 2. Service database (strategy-based, for business data)
const db = await getServiceDatabase('bonus-service', { brand, tenantId });
const bonuses = db.collection('user_bonuses');

// 3. Full initialization (for service startup)
const { database, strategy, context } = await initializeServiceDatabase({
  serviceName: 'bonus-service',
  brand: process.env.BRAND,
  tenantId: process.env.TENANT_ID,
});
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Encapsulation** | Services don't need to know about strategy resolution |
| **Consistency** | Same pattern for all services |
| **Caching** | Database and strategy instances are cached for performance |
| **Strategy Agnostic** | Works with any strategy (per-service, per-brand, per-tenant, per-shard) |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BOOTSTRAP LAYER (Fixed)                     │
│  getCentralDatabase() → core_service                           │
│  - Config (service_configs)                                     │
│  - Auth data (users, sessions)                                  │
│  - System data (brands, tenants)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BUSINESS LAYER (Strategy-based)               │
│  getServiceDatabase('service-name', { brand, tenantId })        │
│  - Reads strategy from config (core_service.service_configs)    │
│  - Resolves to: per-service | per-brand | per-tenant | ...      │
│  - Caches connections for performance                           │
└─────────────────────────────────────────────────────────────────┘
```
