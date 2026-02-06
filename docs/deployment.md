# Deployment Guide

> Docker, Kubernetes, and infrastructure operations.

## Quick Start

All orchestration is centralized in the `gateway/` folder:

```bash
cd gateway
npm install

# Start all services (per-service mode)
npm run dev

# Check health
npm run health
```

## Service Ports

| Service | Port | Endpoint |
|---------|------|----------|
| auth-service | 9001 | http://localhost:9001/graphql |
| payment-service | 9002 | http://localhost:9002/graphql |
| bonus-service | 9003 | http://localhost:9003/graphql |
| notification-service | 9004 | http://localhost:9004/graphql |
| kyc-service | 9005 | http://localhost:9005/graphql |
| **gateway** | **9999** | http://localhost:9999/graphql |
| React App | 9000 | http://localhost:9000 |

## Deployment Modes

| Mode | Command | Description |
|------|---------|-------------|
| Per-Service | `npm run dev` | Each service on own port (development) |
| Docker | `npm run docker:up` | Services in containers |
| Docker (fresh) | `npm run docker:fresh` | Clean build + start |
| K8s | `npm run k8s:apply` | Deploy to local Kubernetes |

---

## Docker Operations

### Basic Commands

```bash
# Check Docker status
npm run docker:status

# Build images (reuses core-base if present)
npm run docker:build

# Rebuild core-base (after changing core-service or access-engine)
npm run docker:build:base

# Start containers
npm run docker:up

# Fresh deployment (clean → build → start → health)
npm run docker:fresh

# View logs
npm run docker:logs

# Stop containers
npm run docker:down
```

### Configuration Profiles

| Profile | Command | Description |
|---------|---------|-------------|
| default (ms) | `npm run docker:up` | Single Mongo/Redis, all 5 services. Gateway 9999, services 9001-9005 |
| test | `npm run docker:up:test` | Isolated test stack. Gateway 9998, services 9011-9015 |
| combo | `npm run docker:up:combo` | Reuses ms infra, deploys only KYC. Gateway 9997 |
| shared | `npm run docker:up:shared` | Production-style (Replica Set, Sentinel) |

### Switching Configs

When switching between configs, always stop first:

```bash
npm run docker:down        # Stop current stack
npm run docker:up:test     # Start different config
```

**Both stacks can run simultaneously** on same Docker host (different ports).

### Infra Recovery

If MongoDB reports replica set errors after switching configs:

```bash
npm run docker:recovery:infra   # Resets Mongo/Redis volumes and restarts infra
```

This runs `docker compose down -v` then `docker:up:infra`. Wait ~30-45s for Mongo to show `(healthy)`.

### Fresh Deployment Commands

| Command | Description |
|---------|-------------|
| `npm run docker:fresh` | Full fresh deploy (default/ms) |
| `npm run docker:fresh:test` | Fresh deploy (test config) |
| `npm run docker:fresh:combo` | Fresh deploy (combo) |
| `npm run docker:fresh:shared` | Fresh deploy (shared/production) |
| `npm run docker:fresh:auth` | Fresh deploy auth-service only |

---

## Kubernetes Operations

### Basic Commands

```bash
# Generate manifests
npm run generate:k8s

# Apply to local cluster
npm run k8s:apply

# Check status
npm run k8s:status

# Port forward for testing
npm run k8s:forward

# Stream logs
npm run k8s:logs

# Delete resources
npm run k8s:delete
```

### K8s with Different Configs

| Command | Description |
|---------|-------------|
| `npm run k8s:apply` | Apply (dev config) |
| `npm run k8s:apply:local` | Apply (local-k8s) |
| `npm run k8s:apply:test` | Apply (test config) |
| `npm run k8s:apply:combo` | Apply (combo config) |

### K8s Prerequisites

- Docker Desktop with Kubernetes enabled
- `kubectl` configured

### Production Deployment

```bash
# Create secrets first
kubectl create secret generic db-secrets \
  --from-literal=mongodb-uri="mongodb://..." \
  --from-literal=redis-url="redis://..." \
  -n microservices

# Apply manifests
kubectl apply -f generated/k8s/

# Scale services
kubectl scale deployment auth-service --replicas=3 -n microservices
```

---

## Gateway Routing

In production, clients use header-based routing through single endpoint:

```typescript
const response = await fetch('http://localhost:9999/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Target-Service': 'payment',  // Routes to payment-service
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ query: '...' }),
});
```

**Valid header values:** `auth`, `payment`, `bonus`, `notification`, `kyc`

**Default:** If no header, routes to `auth` service.

---

## Health Checks

```bash
# Local development
npm run health

# Docker containers
npm run health:docker
npm run health:docker:test

# Kubernetes pods
npm run health:k8s
```

---

## Infrastructure Configuration

### MongoDB Modes

| Mode | Description |
|------|-------------|
| `single` | Standalone MongoDB (default, no transactions) |
| `replica` | Replica set (required for transactions) |

**Note:** MongoDB transactions require replica set. Default dev config uses `single` for simplicity. Use `shared` profile for replica set.

### Redis Modes

| Mode | Description |
|------|-------------|
| `single` | Standalone Redis (default) |
| `sentinel` | Redis Sentinel (high availability) |

---

## Generated Files

```
gateway/generated/
├── nginx/
│   └── nginx.conf
├── docker/
│   ├── docker-compose.dev.yml        # ms (default)
│   ├── docker-compose.prod.yml
│   ├── docker-compose.dev.test.yml   # test
│   └── docker-compose.prod.test.yml
├── k8s/                              # ms manifests
│   └── *.yaml
└── k8s-test/                         # test manifests
    └── *.yaml
```

---

## Adding a New Service

1. **Generate scaffold:**
   ```bash
   cd core-service && npm run build
   npx service-infra service --name <name> --port <port> --output ..
   ```

2. **Register in gateway:** Add to `gateway/configs/services.dev.json`:
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

3. **Regenerate and run:**
   ```bash
   npm run generate
   npm run dev
   ```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Service port | `9001` |
| `NODE_ENV` | Environment | `development` / `production` |
| `MONGODB_URI` | MongoDB connection | `mongodb://localhost:27017/auth_service` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |

---

## Implementation Status

### Done

- Default (ms) – single Mongo & Redis
- Test config – isolated stack
- Combo config – reuses ms infra
- Shared mode – replica set & Sentinel
- Docker operations with `--remove-orphans`
- Fresh deploy with health checks
- K8s manifests with proper Services

### What Remains (Optional)

- Cross-namespace infra sharing
- Shared app services between namespaces
- K8s Redis AUTH alignment

---

**See also:** [Development](development.md), [Architecture](architecture.md)
