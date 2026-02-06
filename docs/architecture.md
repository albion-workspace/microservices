# Architecture

> Detailed technical architecture of the microservices platform.

## Principles

1. **Wallets = Single Source of Truth** - Wallet balances are authoritative
2. **Transactions = The Ledger** - Each transaction is a ledger entry (credit or debit)
3. **Transfers = User-to-User Operations** - Creates 2 transactions (double-entry)
4. **Atomic Operations** - MongoDB transactions ensure consistency
5. **Event-Driven Communication** - Services communicate via Redis pub/sub, not HTTP

## Data Model

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `wallets` | Balance storage | `balance`, `bonusBalance`, `lockedBalance`, `userId`, `currency` |
| `transactions` | Ledger entries | `userId`, `amount`, `balance`, `charge`, `objectId`, `objectModel` |
| `transfers` | User-to-user operations | `fromUserId`, `toUserId`, `amount`, `status` |

## Service Dependency Graph

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
        ┌────────────────────┼────────────────────┬────────────────────┐
        ▼                    ▼                    ▼                    ▼
   ┌────────┐          ┌────────┐          ┌────────┐          ┌──────────────┐
   │payment │          │bonus   │          │auth    │          │notification  │
   │service │          │service │          │service │          │service       │
   └────────┘          └────────┘          └────────┘          └──────────────┘
```

## Implemented Patterns

### 1. Repository Pattern
Generic MongoDB repository with caching, lean queries, cursor-based pagination.

### 2. Saga Pattern
Distributed transactions with two strategies:
- **Compensation-based** (default) - Each step has `compensate()` function
- **MongoDB Transactions** - Atomic multi-document operations

```typescript
// Financial operations MUST use transactions
await executeSaga(steps, input, sagaId, {
  useTransaction: true,  // Critical for money operations
  maxRetries: 3
});
```

### 3. Circuit Breaker
Prevents cascading failures with CLOSED/OPEN/HALF-OPEN states.

### 4. Event-Driven Architecture
Services communicate via Redis pub/sub events, not HTTP calls.

### 5. Factory Pattern
`NotificationProviderFactory` creates providers dynamically.

### 6. Facade Pattern
`BonusEngine` hides internal complexity behind clean API.

### 7. URN-Based RBAC/ACL/HBAC
Permission format: `resource:action:target` (e.g., `wallet:read:own`)

### 8. Multi-Level Caching

```
┌─────────────────────────────────────────────┐
│ L1: Memory Cache (~0.001ms)                 │
│ - In-process Map with TTL                   │
└────────────────────┬────────────────────────┘
                     │ Miss
                     ▼
┌─────────────────────────────────────────────┐
│ L2: Redis Cache (~0.5-2ms)                  │
│ - Shared across instances                   │
└────────────────────┬────────────────────────┘
                     │ Miss
                     ▼
┌─────────────────────────────────────────────┐
│ Database (~5-50ms)                          │
└─────────────────────────────────────────────┘
```

### 9. Dynamic Configuration
MongoDB-stored configs in `core_service.service_configs`, not environment variables.

### 10. Unified Real-time Communication

Common interface for SSE and Socket.IO that abstracts differences while leveraging Socket.IO's bidirectional capabilities:

```
┌─────────────────────────────────────────────────────────────┐
│              UnifiedRealtimeProvider Interface              │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  SSE Provider    │         │ Socket.IO Provider │        │
│  │  (Unidirectional)│         │  (Bidirectional)   │        │
│  └──────────────────┘         └──────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**Common Broadcast Patterns (both SSE and Socket.IO):**

```typescript
// Push to user
provider.getBroadcast().toUser(userId, 'notification', { subject: 'Hello' });

// Push to tenant
provider.getBroadcast().toTenant(tenantId, 'announcement', { message: 'Update' });

// Push to all
provider.getBroadcast().toAll('system:alert', { level: 'critical' });

// Push to room (Socket.IO only, SSE falls back to toAll)
provider.getBroadcast().toRoom('support-chat', 'message', { from: 'admin' });
```

**Socket.IO Specific Features:**

```typescript
const features = provider.getSocketIOFeatures();

// Request with acknowledgment
features.toUserWithAck(userId, 'request:status', {}, (response) => {
  console.log('User responded:', response);
});

// Room management
features.joinRoom(userId, 'support-chat');
features.leaveRoom(userId, 'support-chat');
```

**When to Use:**

| Use Case | Channel |
|----------|---------|
| Simple event streaming | SSE |
| Server notifications | SSE |
| Bidirectional communication | Socket.IO |
| Real-time chat | Socket.IO |
| Room-based broadcasting | Socket.IO |
| Need acknowledgments | Socket.IO |

## Database Strategies

| Strategy | Database Name | Use Case |
|----------|---------------|----------|
| `shared` | `core_service` | Single tenant |
| `per-service` | `{service}_service` | Default (microservices) |
| `per-brand` | `brand_{brand}` | Multi-brand platform |
| `per-brand-service` | `brand_{brand}_{service}` | Max isolation |
| `per-tenant` | `tenant_{tenantId}` | Multi-tenant SaaS |
| `per-shard` | `shard_0`, `shard_1` | Horizontal partitioning |

## Event Flow Examples

### Bonus Flow
```
User deposits → bonus.awarded event → payment-service credits wallet
User plays → bonus.activity event → turnover updated
Turnover met → bonus.converted event → payment-service moves to real balance
```

### Transfer Flow
```
Client requests transfer → Payment service starts saga
  → Step 1: Debit sender wallet (with session)
  → Step 2: Credit receiver wallet (with session)
  → Commit transaction
  → Emit transfer.completed event
```

---

**See also:** [CODING_STANDARDS.md](../CODING_STANDARDS.md), [Core Service API](core-service.md)
