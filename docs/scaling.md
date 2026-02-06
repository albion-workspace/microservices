# Scaling & Operations

> Sharding, disaster recovery, and scaling roadmap.

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

### Scale Scenarios

**Small Scale (NO Sharding)**
```
Users: 100,000 | Transactions/day: 50,000 | Data: 20GB
→ Use: Replica Set (1 primary + 2 secondaries)
```

**Multi-Brand (NO Sharding)**
```
Brands: 50 | Users/brand: 10,000 | Data: 100GB
→ Use: Per-brand databases (strategy: 'per-brand')
```

**Large Scale (SHARD)**
```
Users: 10,000,000 | Transactions/day: 5,000,000 | Data: 2TB
→ Use: Sharded cluster with { odsi: "hashed" }
```

### Implementation

```javascript
sh.enableSharding("payment_service")
db.wallets.createIndex({ odsi: "hashed" })
sh.shardCollection("payment_service.wallets", { odsi: "hashed" })
```

## Disaster Recovery

### Saga/Transaction/Recovery Boundaries

| System | Responsibility | When to Use |
|--------|----------------|-------------|
| **MongoDB Transaction** | Local atomicity | Single-service operations |
| **Saga Engine** | Cross-step coordination | Multi-step operations |
| **Recovery System** | Crash repair only | Stuck operations (no heartbeat) |

### Safe Patterns

```typescript
// Financial operations: Saga with transaction mode
sagaOptions: { useTransaction: true }  // MongoDB handles rollback

// Non-financial multi-step: Saga with compensation
sagaOptions: { useTransaction: false } // Manual compensate functions

// Standalone transfer: Self-managed transaction + recovery
createTransferWithTransactions(params); // Tracked automatically
```

### Infrastructure Backups

| Component | Strategy |
|-----------|----------|
| MongoDB | `mongodump` / replica set oplog |
| Redis | RDB snapshots + AOF |
| Config | Stored in MongoDB (`service_configs`) |

## Scaling Roadmap

### Priority 1: MongoDB Hot Path

**Problem:** At 10M+ users, MongoDB becomes bottleneck for wallet operations.

**Phase 1 (no infra change):**
- Write-through cache for balances in Redis
- Balance reads from Redis (fast path)
- Read replicas for queries

**Phase 2:**
- Append-only transaction log
- Wallet balances as derived state

### Priority 2: Redis Segmentation

At scale, separate Redis by purpose:

| Instance | Purpose |
|----------|---------|
| `redis-core` | Sessions, auth tokens |
| `redis-state` | Recovery, pending ops |
| `redis-cache` | Wallet & query cache |
| `redis-pub` | Pub/Sub, SSE, Socket.IO |

### Priority 3: Real-Time Scaling

**Current:** Gateway manages SSE/Socket.IO in memory.

**At scale:**
- Enable Socket.IO Redis adapter
- Consider dedicated edge layer (Centrifugo, Pusher)

### Priority 4: Notification Resilience

- Add circuit breakers per provider
- Implement retry policies per channel
- Add internal event queue (Redis Streams/BullMQ)

### Priority 5: Observability

- OpenTelemetry for distributed tracing
- Prometheus metrics endpoint (`/metrics`)
- Rate limiting at infrastructure level

## Currently Implemented

- Cursor-based pagination (O(1) performance)
- Multi-level caching (Memory -> Redis)
- Connection pool monitoring
- Redis read replica support
- GraphQL query complexity protection
- Circuit breaker and retry patterns
- Correlation IDs for request tracing
- Generic recovery system
- Event-driven architecture

---

**See also:** [Architecture](architecture.md), [Deployment](deployment.md)
