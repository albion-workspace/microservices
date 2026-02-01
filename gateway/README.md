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
- **Combo config**: Use `infra.combo.json` and `services.combo.json` with `reuseFrom`, `reuseInfra`, and `reuseServicePorts` (e.g. `"ms:auth": 9001`). Combo reuses **default (ms)** Redis, MongoDB, and auth-service; it **deploys only KYC** (plus gateway). Combo has its own project (`combo`), network (`combo_network`), gateway port 9997. Use `--config=combo` (e.g. `npm run generate:combo`, `npm run docker:up:combo`, `npm run k8s:apply:combo`). **Deploy ms first, then combo.** Test namespace is unchanged and remains a full standalone stack. (More detail below under "Implementing shared infra and shared services".) “Shared infra” means **data-plane only**: Redis, MongoDB (and in future e.g. message queues). It does **not** mean sharing app services like auth-service. Today each namespace has its own Redis and MongoDB. It is **possible** for a namespace (e.g. test) to use another’s Redis/Mongo: K8s allows cross-namespace DNS (`redis.microservices.svc.cluster.local`), and config already supports per-environment `mongoUri`/`redisUrl`. Implementing “test uses ms Redis” would mean: (1) **Config**: add an option (e.g. `sharedInfra: { redis: "microservices" }`) so test points at ms. (2) **K8s**: when shared, use that host in generated secrets and **omit** Redis (and optionally MongoDB) manifests for the test namespace. (3) **Docker**: test stack would use an external network and env pointing at `ms-redis`/`ms-mongo`. (4) **Isolation**: shared Redis may need key prefixes or Redis DB numbers; MongoDB already uses per-service DB names. — **Sharing app services** (e.g. test using ms auth-service instead of deploying its own) would be a **separate** option: test would not deploy auth-service and would call `auth-service.microservices.svc.cluster.local`; that would require config (e.g. `sharedServices: ["auth"]`) and omitting that deployment in the test namespace.

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
| `npm run health:docker` | Check Docker containers |
| `npm run health:k8s` | Check K8s pods |
| `npm run health:shared` | Check shared config (localhost) |
| `npm run health:shared:docker` | Check shared config (Docker) |
| `npm run health:shared:k8s` | Check shared config (K8s) |

### Docker Operations

| Command | Description |
|---------|-------------|
| `npm run docker:status` | Check Docker and container status |
| `npm run docker:build` | Build all service images |
| `npm run docker:up` | Start containers (dev config) |
| `npm run docker:up:shared` | Start containers (shared config) |
| `npm run docker:up:test` | Start containers (test config; group **test** in Docker Desktop: test-redis, test-mongo, test-auth-service, …) |
| `npm run docker:up:combo` | Start containers (combo config; reuses ms Redis/Mongo/auth, deploys only KYC; deploy ms first) |
| `npm run docker:down` | Stop containers |
| `npm run docker:down:test` | Stop test stack (project **test**) |
| `npm run docker:down:combo` | Stop combo stack (project **combo**) |
| `npm run docker:logs` | Stream container logs |
| `npm run docker:up:prod` | Start prod mode with gateway |
| `npm run docker:down:prod` | Stop prod containers |

### Kubernetes Operations

| Command | Description |
|---------|-------------|
| `npm run k8s:status` | Check cluster/pod status (dev) |
| `npm run k8s:status:local` | Check status (local-k8s config) |
| `npm run k8s:status:shared` | Check status (shared config) |
| `npm run k8s:apply` | Apply manifests (dev) |
| `npm run k8s:apply:local` | Apply manifests (local-k8s) |
| `npm run k8s:apply:shared` | Apply manifests (shared config) |
| `npm run k8s:delete` | Delete all resources |
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

## Implementing shared infra and shared services

You can support two options: **(1) shared infrastructure** (test uses ms Redis/Mongo) and **(2) shared services** (test uses ms auth-service, etc.). Below is what implementing each means in practice.

### Why both options

- **Shared infra**: Fewer resources (one Redis/Mongo for ms + test), simpler ops, test can hit same data if needed.
- **Shared services**: Test runs only the services under test (e.g. bonus, payment) and reuses ms auth (and optionally others), so test stack is smaller and behavior matches prod (same auth).

### Option 1: Shared infrastructure

**Config** (e.g. in `infra.test.json` or `services.test.json`):

```json
"sharedInfra": {
  "redis": "microservices",
  "mongodb": "microservices"
}
```

Optional: `redisDb: 1` (or key prefix) so test uses a different Redis DB than ms and avoids key collisions.

**K8s** (`generate.ts`):

- When generating for a config that has `sharedInfra.redis`: in `generateK8sSecrets`, set Redis URL to `redis.${sharedInfra.redis}.svc.cluster.local` (and same namespace for Mongo if `sharedInfra.mongodb`). Use same password as the provider namespace or from config.
- In `generateK8s`: **do not** write `05-mongodb.yaml` / `06-redis.yaml` when `sharedInfra.mongodb` / `sharedInfra.redis` is set (test namespace has no Redis/Mongo deployments).
- Namespace must exist; ms namespace must be deployed first so Redis/Mongo exist there.

**Docker** (`generate.ts`):

- When `sharedInfra` is set: in dev/prod compose for test, **omit** the `mongo` and `redis` service blocks. Add the ms network as external, e.g. `networks: test_network: ... ; ms_network: external: true`. Put test services on both networks (or only ms_network) and set env: `REDIS_URL=redis://ms-redis:6379`, `MONGO_URI=mongodb://ms-mongo:27017/...` (use ms project name from infra, e.g. `ms` → `ms-redis`).
- Ensure ms stack is up first so `ms-redis` / `ms-mongo` exist.

**Config loader**: In `config-loader.ts` (or wherever you resolve infra), read `sharedInfra` and expose it so generate and docker scripts can branch.

---

### Option 2: Shared services

**Config** (e.g. in `services.test.json`):

```json
"sharedServices": ["auth"]
```

Means: “In this config (test), do not deploy auth-service; use the one from the provider namespace/project.”

You need a single **provider** namespace/project (e.g. ms). So either:

- Add `sharedServicesFrom": "microservices"` (K8s namespace) and `sharedServicesFromProject": "ms"` (Docker project name), or
- Derive provider from existing infra (e.g. default ms = microservices / ms).

**K8s** (`generate.ts`):

- When generating deployments for a config that has `sharedServices`: **skip** emitting `10-${svc.name}-deployment.yaml` for any `svc.name` in `sharedServices` (e.g. skip auth).
- Test namespace still needs a way to **call** ms auth: either
  - **A)** Other test services (bonus, payment, …) call auth via gateway (Ingress in ms) or via direct URL. So you need a **Service** in test namespace that points at ms auth (ExternalName or multi-cluster). E.g. create a Service in test: `auth-service` → ExternalName `auth-service.microservices.svc.cluster.local`. Then test pods use `http://auth-service` and resolve to ms.
  - **B)** Test gateway/Ingress routes `X-Target-Service: auth` to ms auth-service (e.g. backend `auth-service.microservices.svc.cluster.local:9001`). So nginx/Ingress in test namespace must have upstream for auth pointing at the other namespace.
- So: **(1)** Skip deployment for shared services. **(2)** Either create ExternalName (or equivalent) Services in test namespace for each shared service, or configure test gateway/Ingress to proxy to ms namespace for those services. ConfigMap / Ingress annotations need to know the provider namespace.

**Docker** (`generate.ts`):

- When `sharedServices` is set: **omit** the `auth-service` (and any other shared) service block from test compose. Test stack does not start auth container.
- Other test services that call auth need the URL. Options:
  - **A)** Test containers join ms network (external) and use `ms-auth-service:9001` (or `auth-service` if you add an alias). Set env e.g. `AUTH_SERVICE_URL=http://ms-auth-service:9001` if apps support it.
  - **B)** Test gateway (nginx) routes to ms: use `ms-auth-service` as upstream for auth. That requires nginx config for test to include an upstream pointing at `ms-auth-service:9001` (only possible if test gateway is on same Docker network as ms).
- So: **(1)** Omit shared service blocks from compose. **(2)** Add ms network as external; put test gateway (and optionally other services) on ms network so gateway can proxy to `ms-auth-service`. **(3)** Generate nginx (or gateway) config for test so the “auth” route points at ms-auth-service.

**Gateway / Ingress**: For “test uses ms auth”, test’s gateway must proxy auth traffic to ms. So when generating nginx or K8s Ingress for test, if `sharedServices` includes `auth`, the auth upstream/host should be `auth-service.microservices.svc.cluster.local` (K8s) or `ms-auth-service` (Docker) instead of local auth-service.

---

### Summary: what to touch

| Area | Shared infra | Shared services |
|------|----------------|------------------|
| **Config** | `sharedInfra: { redis, mongodb }` (+ optional `redisDb`) | `sharedServices: ["auth", ...]` + provider (e.g. `sharedServicesFrom: "microservices"`) |
| **config-loader** | Load and expose `sharedInfra` | Load and expose `sharedServices` and provider |
| **generate.ts K8s** | Secrets use provider-namespace Redis/Mongo; skip 05-mongodb, 06-redis when shared | Skip 10-*-deployment for shared svc; add ExternalName Services or Ingress backends to ms namespace |
| **generate.ts Docker** | Omit mongo/redis; use external ms network; env → ms-redis, ms-mongo | Omit shared service blocks; test on ms network; gateway upstreams → ms-auth-service etc. |
| **generate.ts nginx** | N/A | For test, auth upstream = ms-auth-service (or provider host) |
| **Order** | Deploy ms first (Redis/Mongo and shared services) | Deploy ms first (shared services must exist) |

**Isolation**: Shared Redis: use different Redis DB or key prefix for test. Mongo: DB names are per-service already. Shared auth: same JWT/issuer so tokens from ms auth work in test.

---

## Directory Structure

```
gateway/
├── configs/
│   ├── services.dev.json     # Development config (single MongoDB/Redis)
│   └── services.shared.json  # Production config (Sentinel, ReplicaSet)
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
| `dev` | `services.dev.json` | Single MongoDB/Redis, local development (default) |
| `test` | `services.test.json` | Test profile; infra from `infra.test.json` (`docker.projectName`: **test**, network: **test_network** → separate Docker Desktop group) |
| `shared` | `services.shared.json` | MongoDB Replica Set, Redis Sentinel; **Docker Compose runs only one app service** (the one with `strategy: "shared"`, e.g. auth) so Docker Desktop shows **ms** → redis, mongo, one service |
| `local-k8s` | `services.local-k8s.json` | Docker Desktop Kubernetes testing |

**Docker Desktop grouping (dynamic from infra):**

- **Default (dev)**: project name **ms** → containers: ms-redis, ms-mongo, ms-auth-service, ms-payment-service, …
- **Test**: project name **test** → containers: test-redis, test-mongo, test-auth-service, …
- **Shared**: project name **ms** → containers: ms-redis, ms-mongo, one app service (auth when `strategy: "shared"`)

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

**Last Updated**: 2026-01-30
