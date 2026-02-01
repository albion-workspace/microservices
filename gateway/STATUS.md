# Gateway – Implementation status

Status of gateway orchestration: default (ms), test, combo, and shared modes (Docker and Kubernetes).

**Last updated**: 2026-02-01

---

## Done

### Default (ms) – single Mongo & Redis

- **Config**: `services.dev.json` uses `infrastructure.mongodb.mode: "single"` and `infrastructure.redis.mode: "single"` (no replica set, no Sentinel).
- **Docker**: `npm run generate` and `npm run docker:fresh` produce a single `mongo` and single `redis` container; all 5 services + gateway start and pass health checks.
- **Kubernetes**: Default manifests use single MongoDB and Redis when config is single; replica set/sentinel use separate headless Services (`mongodb-pods`, `redis-pods`) so existing `mongodb`/`redis` ClusterIP Services are unchanged.

### Shared mode – replica set & Sentinel

- **Config**: `services.shared.json` and `infra.shared.json` with MongoDB replica set and Redis Sentinel; one app service (auth when `strategy: "shared"`).
- **Docker**: `infra.shared.json` uses project name `shared`, distinct ports (gateway 9996, auth 9021, Mongo 27019, Redis 6381). Replica set uses `mongo-primary` + secondaries; Redis uses Bitnami Sentinel. `npm run docker:fresh:shared` runs successfully.
- **Kubernetes**: Replica set and Sentinel supported; headless Services for StatefulSet peer discovery; ClusterIP Services for app connectivity.

### Docker operations

- **`docker:down`** runs with **`--remove-orphans`** so switching configs (ms ↔ test ↔ shared) removes containers from the previous compose file and frees ports.
- **Fresh deploy**: `docker:fresh` (and `:test`, `:combo`, `:shared`) does clean → build → start → health check → cleanup. Safe on Windows (short delay to avoid libuv handle errors).

### Kubernetes

- **Ingress**: Combo config uses Nginx server + `X-Target-Service` header for routing to KYC (and gateway default).
- **Port-forward**: `k8s:forward` skips `ExternalName` services so port-forward works for combo and other configs.
- **StatefulSets**: When using replica set or Sentinel, headless Services (`mongodb-pods`, `redis-pods`) are used for StatefulSet `serviceName`; `mongodb` and `redis` remain ClusterIP for app connectivity (avoids `clusterIP` immutable errors).

### Health checks

- **Docker**: Health check identifies MongoDB primary for replica set configs (e.g. `shared-mongo-primary`).
- **K8s**: Health checks work for default, test, combo, and shared.

---

## What remains (optional)

- **Cleanup when switching configs**: If you run ms, then switch to test without running `docker:down` first, the ms stack may still hold ports. **Workaround**: run `npm run docker:down` (or `docker:down:test` / `docker:down:shared`) before starting the other stack; `--remove-orphans` is already in use.
- **Cross-namespace infra**: “Test uses ms Redis/Mongo” (shared data-plane across namespaces) is not implemented; config and K8s/Docker support (e.g. `sharedInfra`, omit Redis/Mongo in test namespace) would be added if needed.
- **Shared app services**: “Test uses ms auth-service” (no auth deployment in test) would require config (e.g. `sharedServices: ["auth"]`) and omitting that deployment in the test namespace; not implemented.
- **K8s Redis AUTH**: If K8s Redis is configured with a password, ensure app secrets and Redis manifest match; recurring “Recovery job failed” or auth errors in logs may need env/secret alignment.
- **Documentation**: Keep README and this STATUS in sync when adding new profiles or changing default/test/shared/combo behavior.

---

## Quick reference

| Config   | Mongo/Redis     | Docker project | Typical use           |
|----------|------------------|----------------|------------------------|
| default  | single           | ms             | Day-to-day dev        |
| test     | single (or test) | test           | Isolated test stack   |
| combo    | reuses ms        | combo          | KYC-only, ms first    |
| shared   | replica + Sentinel | shared       | Production-style local |
