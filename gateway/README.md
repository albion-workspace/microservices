# Gateway - Infrastructure Orchestration

**Purpose**: Central orchestration for all microservices - development, deployment, and infrastructure.

This is the **single entry point** for running and managing all services locally and in production.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start all services in development mode (per-service)
npm run dev

# Check service health
npm run health
```

---

## Available Commands

All commands support `--config=dev` (default), `--config=shared`, `--config=test`, or `--config=combo` to switch configuration profiles. Config is fully dynamic:

- **Default (ms)** and **test** work as before: each is a full standalone stack (own Redis, MongoDB, all 5 services). **Combo** is a third namespace that reuses ms Redis/Mongo and auth, and deploys only KYC; deploy ms first, then combo.
- **Services**: `services.{mode}.json` is loaded for the chosen mode (e.g. `services.test.json` for `--config=test`).
- **Infra**: `infra.json` is the base; `infra.{mode}.json` deep-merges over it (e.g. `infra.test.json` overrides only what differs, such as `kubernetes.namespace` and `docker.projectName`).
- **Docker Desktop**: Each config uses a Compose project name from infra (`docker.projectName`): default/dev/shared → **ms**, test → **test**, combo → **combo**. Containers are named `{projectName}-redis`, `{projectName}-mongo`, `{projectName}-auth-service`, etc. (e.g. **ms** → ms-redis, ms-mongo, ms-auth-service; **test** → test-redis, test-mongo, test-auth-service; **combo** → combo-gateway, combo-kyc-service only; combo has no mongo/redis/auth containers).
- **Compose files**: Generated compose files are **kept** after `docker:fresh` so both ms and test definitions persist; only generated Dockerfiles are removed. Compose filenames are config-specific: `docker-compose.dev.yml` / `docker-compose.prod.yml` for ms, `docker-compose.dev.test.yml` / `docker-compose.prod.test.yml` for test.
- **Ports (brand co-existence)**: ms and test can run on the same Docker host. ms uses default ports (Mongo 27017, Redis 6379, services 9001–9005, gateway 9999). test uses distinct ports (Mongo 27018, Redis 6380, services 9011–9015, gateway 9998) so both stacks can run simultaneously.
- **Kubernetes (same behavior)**: ms uses namespace `microservices` and manifests in `generated/k8s/`. test uses namespace `microservices-test` and manifests in `generated/k8s-test/`. Both can coexist; generate/apply/delete use the current config’s dir and namespace. Generated K8s files are only cleaned for the current config (e.g. `k8s:fresh` with test cleans only `k8s-test/`).
- **Gateway behavior (all environments)**: The nginx gateway is the single entry point in Docker (dev and prod) and K8s (Ingress). Routing (X-Target-Service / default service), `/health`, and GraphQL paths behave the same everywhere. In dev (Docker) you may use either the gateway port (e.g. 9999) or direct service ports (9001–9005); using the gateway matches prod/K8s behavior.
- **Combo config**: Use `infra.combo.json` and `services.combo.json` with `reuseFrom`, `reuseInfra`, and `reuseServicePorts` (e.g. `"ms:auth": 9001`). Combo reuses **default (ms)** Redis, MongoDB, and auth-service; it **deploys only KYC** (plus gateway). Combo has its own project (`combo`), network (`combo_network`), gateway port 9997. Use `--config=combo` (e.g. `npm run generate:combo`, `npm run docker:up:combo`, `npm run docker:fresh:combo`). **Deploy ms first, then combo.** Test namespace is unchanged and remains a full standalone stack.  “Shared infra” means **data-plane only**: Redis, MongoDB (and in future e.g. message queues). It does **not** mean sharing app services like auth-service. Today each namespace has its own Redis and MongoDB. It is **possible** for a namespace (e.g. test) to use another’s Redis/Mongo: K8s allows cross-namespace DNS (`redis.microservices.svc.cluster.local`), and config already supports per-environment `mongoUri`/`redisUrl`. Implementing “test uses ms Redis” would mean: (1) **Config**: add an option (e.g. `sharedInfra: { redis: "microservices" }`) so test points at ms. (2) **K8s**: when shared, use that host in generated secrets and **omit** Redis (and optionally MongoDB) manifests for the test namespace. (3) **Docker**: test stack would use an external network and env pointing at `ms-redis`/`ms-mongo`. (4) **Isolation**: shared Redis may need key prefixes or Redis DB numbers; MongoDB already uses per-service DB names. — **Sharing app services** (e.g. test using ms auth-service instead of deploying its own) would be a **separate** option: test would not deploy auth-service and would call `auth-service.microservices.svc.cluster.local`; that would require config (e.g. `sharedServices: ["auth"]`) and omitting that deployment in the test namespace.

### Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services (dev config) |
| `npm run dev:shared` | Start all services (shared config) |
| `npm run dev:docker` | Start using Docker Compose |
| `npm run dev:docker:shared` | Docker Compose with shared config |

### Health Check

| Command | Description |
|---------|-------------|
| `npm run health` | Check localhost (local dev) |
| `npm run health:docker` | Check Docker containers (default/ms) |
| `npm run health:docker:test` | Check Docker containers (test config) |
| `npm run health:k8s` | Check K8s pods |
| `npm run health:shared` | Check shared config (localhost) |
| `npm run health:shared:docker` | Check shared config (Docker) |
| `npm run health:shared:k8s` | Check shared config (K8s) |

### Docker Operations

| Command | Description |
|---------|-------------|
| `npm run docker:status` | Check Docker and container status |
| `npm run docker:status:test` | Status for test config |
| `npm run docker:status:combo` | Status for combo config |
| `npm run docker:build` | Build all service images |
| `npm run docker:up` | Start containers (default/ms) |
| `npm run docker:up:shared` | Start containers (shared config) |
| `npm run docker:up:test` | Start containers (test config) |
| `npm run docker:up:combo` | Start containers (combo; reuses ms Redis/Mongo/auth; deploy ms first) |
| `npm run docker:down` | Stop containers |
| `npm run docker:down:test` | Stop test stack |
| `npm run docker:down:combo` | Stop combo stack |
| `npm run docker:logs` | Stream container logs |
| `npm run docker:up:prod` | Start prod mode with gateway |
| `npm run docker:down:prod` | Stop prod containers |

**Fresh deployment** (clean → build → start → health check → cleanup). Safe on Windows (cleanup uses a short delay to avoid libuv handle errors).

| Command | Description |
|---------|-------------|
| `npm run docker:fresh` | Full fresh deploy (default/ms) |
| `npm run docker:fresh:test` | Full fresh deploy (test config) |
| `npm run docker:fresh:combo` | Full fresh deploy (combo; deploy ms first) |
| `npm run docker:fresh:shared` | Full fresh deploy (shared config) |
| `npm run docker:fresh:auth` | Fresh deploy auth-service only (and variants for payment, bonus, notification, kyc) |

### Kubernetes Operations

| Command | Description |
|---------|-------------|
| `npm run k8s:status` | Check cluster/pod status (dev) |
| `npm run k8s:status:local` | Check status (local-k8s config) |
| `npm run k8s:status:shared` | Check status (shared config) |
| `npm run k8s:status:test` | Check status (test config) |
| `npm run k8s:status:combo` | Check status (combo config) |
| `npm run k8s:apply` | Apply manifests (dev) |
| `npm run k8s:apply:local` | Apply manifests (local-k8s) |
| `npm run k8s:apply:shared` | Apply manifests (shared config) |
| `npm run k8s:apply:test` | Apply manifests (test config) |
| `npm run k8s:apply:combo` | Apply manifests (combo config) |
| `npm run k8s:delete` | Delete all resources |
| `npm run k8s:delete:test` | Delete test namespace resources |
| `npm run k8s:delete:combo` | Delete combo namespace resources |
| `npm run k8s:forward` | Port forward (dev) |
| `npm run k8s:forward:local` | Port forward (local-k8s) |
| `npm run k8s:forward:shared` | Port forward (shared config) |
| `npm run k8s:logs` | Stream logs from all pods |
| `npm run k8s:secrets` | Create secrets |
| `npm run k8s:secrets:local` | Create secrets (local-k8s) |
| `npm run k8s:secrets:shared` | Create secrets (shared config) |

### Infrastructure Generation

| Command | Description |
|---------|-------------|
| `npm run generate` | Generate all (dev config) |
| `npm run generate:shared` | Generate all (shared config) |
| `npm run generate:all` | Generate everything (dev) |
| `npm run generate:all:shared` | Generate everything (shared) |
| `npm run generate:nginx` | Generate nginx config |
| `npm run generate:docker` | Generate docker-compose files |
| `npm run generate:k8s` | Generate Kubernetes manifests |
| `npm run generate:test` | Generate all (test config; uses infra.test.json overrides) |
| `npm run generate:combo` | Generate all (combo config; reuses ms Redis/Mongo and auth) |

---

## Supported deployment profiles

| Profile | Services config | Infra config | Description |
|--------|-----------------|--------------|-------------|
| **default (ms)** | `services.dev.json` | `infra.json` | Full stack: own Redis, MongoDB, all 5 services. Gateway 9999, services 9001â€“9005. |
| **test** | `services.test.json` | `infra.test.json` | Standalone stack: own Redis, MongoDB, all 5 services. Distinct ports (gateway 9998, services 9011â€“9015) so ms and test can run on the same host. |
| **combo** | `services.combo.json` | `infra.combo.json` | Reuses **ms** Redis, MongoDB, and auth; deploys only gateway + KYC. Gateway 9997. **Deploy ms first, then combo.** |
| **shared** | `services.shared.json` | `infra.shared.json` | Production-style (Replica Set, Redis Sentinel). Single app service in Docker. |
| **local-k8s** | `services.local-k8s.json` | (local) | Local Kubernetes testing. |

**Redis**: Single or Sentinel from config. If `infrastructure.redis.mode` is `"sentinel"` and `redis.sentinel` is set, Docker (dev and prod) and K8s generate one Redis master + Bitnami Sentinel containers; otherwise a single Redis container. Optional `redis.sentinel.hostPortBase` (default 26380) sets Docker sentinel host ports so ms and shared can run together (e.g. shared uses 26383). Apps connect to `redis:6379`. **K8s**: Replica set/sentinel use separate headless Services (`mongodb-pods`, `redis-pods`) so existing `mongodb`/`redis` ClusterIP Services are not changed (avoids clusterIP immutable error).

Combo uses `reuseFrom` / `reuseInfra` / `reuseServicePorts` in config so the combo stack joins the ms network and reuses ms Redis, Mongo, and auth-service. Test remains fully standalone (no shared infra).

---

## Directory Structure

```
gateway/
├── configs/
│   ├── infra.json            # Base infra (default/ms)
│   ├── infra.test.json       # Test overrides (ports, project name)
│   ├── infra.combo.json      # Combo overrides (reuse ms)
│   ├── services.json         # Base services list
│   ├── services.dev.json     # Development (default/ms)
│   ├── services.test.json    # Test (standalone)
│   ├── services.combo.json   # Combo (reuses ms; KYC only)
│   ├── services.shared.json # Production (Replica Set, Sentinel)
│   └── services.local-k8s.json
├── scripts/
│   ├── config-loader.ts      # Config loading utility
│   ├── dev.ts                # Unified development script
│   ├── docker.ts             # Docker orchestration
│   ├── generate.ts           # Infrastructure generator
│   ├── health-check.ts       # Service health checker
│   └── k8s.ts                # Kubernetes orchestration
├── generated/                # Generated configs (gitignored)
│   ├── nginx/
│   │   └── nginx.conf
│   ├── docker/
│   │   ├── docker-compose.dev.yml        # ms (default)
│   │   ├── docker-compose.prod.yml      # ms
│   │   ├── docker-compose.dev.test.yml  # test (when generated)
│   │   └── docker-compose.prod.test.yml # test (when generated)
│   ├── k8s/                  # ms (default) manifests
│   │   └── *.yaml
│   └── k8s-test/             # test manifests (when generated)
│       └── *.yaml
└── package.json
```

**Note**: All scripts are TypeScript for cross-platform compatibility (Windows, Linux, Mac).

---

## Configuration Profiles

Configuration files follow the pattern `services.{mode}.json`. Use `--config={mode}` to select.

### Built-in Profiles

| Mode | File | Description |
|------|------|-------------|
| `dev` (default/ms) | `services.dev.json` | Single MongoDB/Redis, all 5 services. Gateway 9999. |
| `test` | `services.test.json` | Standalone stack; `infra.test.json` (project **test**, gateway 9998). |
| `combo` | `services.combo.json` | Reuses ms Redis/Mongo/auth; deploys gateway + KYC only. Deploy ms first. |
| `shared` | `services.shared.json` | Replica Set, Sentinel; single app service in Docker. |
| `local-k8s` | `services.local-k8s.json` | Local Kubernetes testing. |

**Docker Desktop grouping (dynamic from infra):**

- **Default (dev)**: project name **ms** → containers: ms-redis, ms-mongo, ms-auth-service, ms-payment-service, …
- **Test**: project name **test** → containers: test-redis, test-mongo, test-auth-service, …
- **Shared**: project name **shared** → containers: shared-redis, shared-mongo-primary, shared-redis-sentinel-1/2/3, one app service (auth when `strategy: "shared"`)

### Custom Profiles (Brands)

Create your own config by copying an existing one:

```bash
# Create a brand-specific config
cp configs/services.dev.json configs/services.acme.json

# Edit with brand-specific settings
# Then use it:
npm run dev -- --config=acme
npm run generate -- --config=acme
npm run docker:up -- --config=acme
```

Example use cases:
- `services.brand-a.json` - Brand A configuration
- `services.staging.json` - Staging environment
- `services.local-k8s.json` - Local Kubernetes testing

---

## Services Configuration

All services are defined in `configs/services.json`:

| Service | Port | Database |
|---------|------|----------|
| auth | 9001 | auth_service |
| payment | 9002 | payment_service |
| bonus | 9003 | bonus_service |
| notification | 9004 | notification_service |
| kyc | 9005 | kyc_service |
| **gateway** | **9999** | - |

---

## Deployment Modes

### 1. Per-Service Mode (Default)

Each service runs on its own port. Best for development and debugging.

```bash
npm run dev
```

**Endpoints:**
```
http://localhost:9001/graphql  → auth-service
http://localhost:9002/graphql  → payment-service
http://localhost:9003/graphql  → bonus-service
http://localhost:9004/graphql  → notification-service
http://localhost:9005/graphql  → kyc-service
```

### 2. Gateway Mode (Production)

Single entry point with nginx routing by `X-Target-Service` header.

```bash
# Generate configs
npm run generate:all

# Start with Docker
npm run docker:up:prod
```

**Single endpoint:**
```
POST http://localhost:9999/graphql
Headers: X-Target-Service: payment

Routes to appropriate service based on header.
```

### 3. Docker Mode (Local Containers)

Run all services in Docker containers.

```bash
# Check Docker is running
npm run docker:status

# Build images
npm run docker:build

# Start containers
npm run docker:up

# View logs
npm run docker:logs
```

---

## Header-Based Routing

In gateway/production mode, nginx routes based on `X-Target-Service` header:

```typescript
// Client example
const response = await fetch('http://localhost:9999/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Target-Service': 'payment',  // Routes to payment-service
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    query: `mutation { deposit(input: { amount: 100 }) { success } }`
  }),
});
```

**Valid header values:**
- `auth` → auth-service:9001
- `payment` → payment-service:9002
- `bonus` → bonus-service:9003
- `notification` → notification-service:9004
- `kyc` → kyc-service:9005

**Default**: If no header, routes to `auth` service.

---

## Kubernetes Deployment

### Local Testing (Docker Desktop)

Docker Desktop includes a local Kubernetes cluster. Enable it in Docker Desktop settings.

```bash
# Generate k8s manifests
npm run generate:k8s

# Apply to local cluster
kubectl apply -f generated/k8s/

# Check status
kubectl get pods -n microservices

# Port forward for testing
kubectl port-forward svc/auth-service 9001:9001 -n microservices
```

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

## Adding a New Service

1. Add service to `configs/services.json`:
```json
{
  "name": "new-service",
  "host": "new-service",
  "port": 9006,
  "database": "new_service",
  "healthPath": "/health",
  "graphqlPath": "/graphql"
}
```

2. Regenerate configs:
```bash
npm run generate:all
```

3. Restart development:
```bash
npm run dev
```

---

## Troubleshooting

### Services not starting

```bash
# Check service health
npm run health

# Check if ports are in use
netstat -ano | findstr "900"
```

### Docker issues

```bash
# Check Docker status
npm run docker:status

# Rebuild images
npm run docker:build

# Check container logs
npm run docker:logs
```

### Kubernetes issues

```bash
# Check pods
kubectl get pods -n microservices

# Check pod logs
kubectl logs -f deployment/auth-service -n microservices

# Describe pod for events
kubectl describe pod -l app=auth-service -n microservices
```

---

## Environment Variables

Services read from environment:

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Service port | `9001` |
| `NODE_ENV` | Environment | `development` / `production` |
| `MONGODB_URI` | MongoDB connection | `mongodb://localhost:27017/auth_service` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |

---

**Last Updated**: 2026-02-01
