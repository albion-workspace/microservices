# Microservices Payment System

**Version**: 1.0.0 | **Status**: Production Ready | **Last Updated**: 2026-02-06

---

## Overview

A production-ready microservices platform for fintech/gaming backends, featuring:

- **Wallet Management** - Multi-balance wallets with atomic transfers
- **Bonus System** - Configurable promotions, referrals, loyalty rewards
- **Authentication** - JWT, OAuth, OTP, 2FA
- **Notifications** - Email, SMS, push, real-time (SSE, WebSocket)
- **KYC** - Multi-tier identity verification

### Key Features

| Feature | Description |
|---------|-------------|
| Event-Driven | Services communicate via Redis pub/sub, not HTTP |
| Saga Pattern | Distributed transactions with automatic rollback |
| Multi-Level Cache | Memory -> Redis -> Database |
| URN Permissions | `resource:action:target` (e.g., `wallet:read:own`) |
| Cursor Pagination | O(1) performance regardless of data size |
| Dynamic Config | MongoDB-stored configs, not environment variables |

---

## Quick Start

```bash
# Navigate to gateway (central orchestration)
cd gateway

# Install dependencies
npm install

# Start all services
npm run dev

# Check health
npm run health
```

**Endpoints available:**

| Service | URL |
|---------|-----|
| Auth | http://localhost:9001/graphql |
| Payment | http://localhost:9002/graphql |
| Bonus | http://localhost:9003/graphql |
| Notification | http://localhost:9004/graphql |
| KYC | http://localhost:9005/graphql |
| Gateway | http://localhost:9999/graphql |

---

## Project Structure

```
tst/
├── access-engine/           # Standalone RBAC/ACL library
├── app/                     # React frontend
├── auth-service/            # Authentication (port 9001)
├── bonus-service/           # Bonuses & rewards (port 9003)
├── core-service/            # Shared library
├── gateway/                 # Infrastructure orchestration
├── kyc-service/             # Identity verification (port 9005)
├── notification-service/    # Notifications (port 9004)
├── payment-service/         # Payments & wallets (port 9002)
├── shared-validators/       # Client-safe validators
├── scripts/                 # Test and utility scripts
└── docs/                    # Detailed documentation
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, patterns, data model |
| [Services](docs/services.md) | Service-specific documentation |
| [Core Service API](docs/core-service.md) | Shared library reference |
| [Deployment](docs/deployment.md) | Docker, Kubernetes, DevOps |
| [Development](docs/development.md) | Setup, testing, workflows |
| [Scaling](docs/scaling.md) | Sharding, disaster recovery, roadmap |
| [Coding Standards](CODING_STANDARDS.md) | Development guidelines |
| [Project Analysis](docs/project-overview.md) | Technical deep-dive and recommendations |

---

## Architecture Highlights

### Data Model

```
Wallets (Source of Truth) ─── Transactions (Ledger) ─── Transfers (Operations)
         │                           │                          │
    Balance state              Audit trail              2 transactions per transfer
```

### Service Dependencies

```
┌─────────────────┐
│  access-engine  │  ← Standalone RBAC/ACL
└────────┬────────┘
         ▼
┌─────────────────┐
│  core-service   │  ← Shared library
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼
 payment   bonus      auth    notification
```

### Event-Driven Communication

```
User deposits → bonus.awarded event → payment-service credits wallet
User plays → bonus.activity event → turnover updated
Turnover met → bonus.converted event → balance converted
```

---

## Deployment Options

| Mode | Command | Description |
|------|---------|-------------|
| Local | `npm run dev` | Per-service development |
| Docker | `npm run docker:fresh` | Containerized deployment |
| K8s | `npm run k8s:apply` | Kubernetes deployment |

All commands run from `gateway/` directory. See [Deployment Guide](docs/deployment.md) for details.

---

## Testing

```bash
cd scripts

# Payment tests (run first)
npm run payment:test

# Bonus tests
npm run bonus:test

# Auth tests
npm run auth:test
```

See [Development Guide](docs/development.md) for full testing documentation.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Node.js 24.x |
| Language | TypeScript 5.9 |
| API | GraphQL (graphql-http, graphql-sse) |
| Database | MongoDB 7+ |
| Cache | Redis 5+ |
| Frontend | React 19, Vite 7, Tailwind CSS 4 |
| Real-time | Socket.IO, SSE |

---

## Configuration

Services use dynamic configuration from MongoDB, not environment variables:

```typescript
// Services load config at startup
const config = await getConfigWithDefault('payment-service', 'jwt');
```

### Config Priority

1. Environment variables (bootstrap only)
2. MongoDB config store (`core_service.service_configs`)
3. Registered defaults

See [CODING_STANDARDS.md](CODING_STANDARDS.md) for configuration patterns.

---

## Contributing

1. Review [CODING_STANDARDS.md](CODING_STANDARDS.md) before making changes
2. Follow the established patterns in existing services
3. Use the service generator for new services:
   ```bash
   cd core-service && npm run build
   npx service-infra service --name <name> --port <port> --output ..
   ```

---

**Last Updated**: 2026-02-06
