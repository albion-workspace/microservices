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

All commands support `--config=dev` (default) or `--config=shared` to switch configuration profiles.

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
| `npm run docker:down` | Stop containers |
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
│   │   ├── docker-compose.dev.yml
│   │   └── docker-compose.prod.yml
│   └── k8s/
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
| `shared` | `services.shared.json` | MongoDB Replica Set, Redis Sentinel |
| `local-k8s` | `services.local-k8s.json` | Docker Desktop Kubernetes testing |

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
