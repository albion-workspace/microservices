# Service Generator

The **service generator** (`service-infra service --name <name> ...`) is the single source of truth for microservice structure. New services are generated from this template. **All current services** (auth, bonus, payment, notification, kyc) are aligned to this pattern and use dynamic config only.

**Alignment status (done):** auth, bonus, payment, notification, kyc all use `getConfigWithDefault` only in config.ts; index uses `config.redisUrl` and `SERVICE_NAME`; no `process.env` in code (only in comments). Verification: `grep process.env` in each service `src/` returns only comment lines. You can run and test all services; see **STATUS_CONFIG_AND_STANDARDS.md** (repo root) for summary and optional next steps.

---

**Generic pattern only:** The template never emits `process.env`. The only exception is **outside** the generator: core-service itself or auth-service when using core DB may need `process.env` for bootstrap/strategy resolution (e.g. reading DB strategy before the config store is available). All other services use **dynamic config only** (getConfigWithDefault / config store).

**Per-service, per-brand DB init:** The template uses `db.initialize({ brand, tenantId })` and (when Redis) `redis.initialize({ brand })` after `resolveContext()` and `loadConfig(context.brand, context.tenantId)`. Uses `createServiceDatabaseAccess(serviceName)` and `createServiceRedisAccess(serviceName)`.

**Config: key-by-key and single-JSON:** Default is key-by-key `getConfigWithDefault(SERVICE_NAME, key, { brand, tenantId })`. Services may also use a **single key** that holds a whole JSON object (e.g. `database`, `jwt`, or service-specific `providers`): `await getConfigWithDefault<YourType>(SERVICE_NAME, 'yourKey', { brand, tenantId }) ?? defaultYourKey`. Add that key to config-defaults.ts.

**JWT (single secret, shared by default):** One JWT secret; same default everywhere (`shared-jwt-secret-change-in-production`). Gateway key has jwt, database, corsOrigins, nodeEnv; all services use `getConfigWithDefault(SERVICE_NAME, key) ?? getConfigWithDefault('gateway', key)`. Auth-service registers `gateway` with `GATEWAY_JWT_DEFAULTS` so `getConfigWithDefault('gateway', 'jwt')` can be used as fallback.

**Config interface – DefaultServiceConfig:** Common properties are in core-service `DefaultServiceConfig` (port, nodeEnv, serviceName, mongoUri, redisUrl, corsOrigins, jwt\*, optional useMongoTransactions). Each service: `export interface {Service}Config extends DefaultServiceConfig { ... }` in types.ts only; add only service-specific properties. Generator emits `export interface {Service}Config extends DefaultServiceConfig {}`.

**SERVICE_NAME:** Exported from config.ts (`export const SERVICE_NAME = '{service}-service'`). Used in config.ts for `getConfigWithDefault(SERVICE_NAME, key, ...)` and in index.ts for `registerServiceConfigDefaults(SERVICE_NAME, ...)` and `ensureDefaultConfigsCreated(SERVICE_NAME, ...)`. No static service name string in index.

This document describes:
1. **Current state** – all services aligned; what the template contains
2. **Template reference** – what the generator emits and how to keep it complete
3. **Maintenance reference** – when adding a new service or touching config, follow these rules

---

## 1. Current state (all services aligned)

All five microservices (auth, bonus, payment, notification, kyc) match the generator pattern:

| Service | config.ts | index.ts | Notes |
|--------|-----------|----------|-------|
| auth-service | getConfigWithDefault only; gateway fallback for jwt, database, nodeEnv, corsOrigins | config.redisUrl; SERVICE_NAME; registerServiceConfigDefaults(SERVICE_NAME, …) | Auth-specific keys in config-defaults; domain code uses getAuthConfig() |
| bonus-service | getConfigWithDefault only; gateway fallback | config.redisUrl; SERVICE_NAME; ensureDefaultConfigsCreated(SERVICE_NAME, …) | transaction.useTransactions in config |
| payment-service | getConfigWithDefault only; gateway fallback | config.redisUrl; SERVICE_NAME | exchangeRate, transaction, wallet, transfer keys |
| notification-service | getConfigWithDefault only; gateway fallback | SERVICE_NAME; registerServiceConfigDefaults(SERVICE_NAME, …) | smtp, twilio, push, queue, realtime keys |
| kyc-service | loadConfig with getConfigWithDefault only; gateway fallback | loadConfig; SERVICE_NAME; KYC_CONFIG_DEFAULTS exported from config-defaults | Single-JSON keys (providers, verification, etc.) in config-defaults |

**Verification:** In each service `src/`, `grep process.env` returns only comments (e.g. “No process.env (CODING_STANDARDS)”). No runtime use of process.env for app config.

---

## 2. Template reference (generator output)

The **service template** (output of `service-generator.ts`) is the canonical structure. When adding shared behavior across services, add it to the generator so new services get it by default.

### 2.1 What the template contains

- **package.json** – name, scripts (start, dev, build, build:run, test), dependencies (access-engine, core-service), devDependencies (@types/node, typescript)
- **tsconfig.json** – ES2020, ESNext, strict, rootDir src, outDir dist
- **src/database.ts** – `createServiceDatabaseAccess(serviceName)` (or core-service for `--core-db`)
- **src/redis.ts** – `createServiceRedisAccess(serviceName)` (when `--redis`)
- **src/error-codes.ts** – `{SERVICE}_ERRORS`, `{SERVICE}_ERROR_CODES`, type `{Service}ErrorCode`, prefix `MS{Service}`
- **src/config-defaults.ts** – `{SERVICE}_CONFIG_DEFAULTS` with port, serviceName, nodeEnv, corsOrigins, jwt, database (mongoUri, redisUrl); sensitivePaths for secrets. **No** registration call; index calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`.
- **src/config.ts** – `export const SERVICE_NAME = '{service}-service'`; `loadConfig(brand?, tenantId?)` using **only** `getConfigWithDefault(SERVICE_NAME, key, { brand, tenantId }) ?? default`; no `process.env`
- **src/types.ts** – `{Service}Config extends DefaultServiceConfig` (from core-service); add only service-specific properties
- **src/graphql.ts** – `{shortName}GraphQLTypes`, `create{Service}Resolvers(config)` with health + `{name}Health`
- **src/services/index.ts** – placeholder export
- **src/index.ts** – imports `SERVICE_NAME` from config; `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)` → resolveContext → loadConfig → validateConfig → printConfigSummary → db.initialize → createGateway(...) → Redis init using **config.redisUrl** → ensureDefaultConfigsCreated(SERVICE_NAME, ...) → startListening using **config.redisUrl** → registerServiceErrorCodes

### 2.2 Steps to keep the template complete and common

1. **Config**
   - Template must **never** emit `process.env` in `config.ts` or in the generated `index.ts` for Redis/listening. All values come from `getConfigWithDefault` and `config` object.
   - Defaults in `config-defaults.ts` must include every key used in `config.ts`: port, serviceName, nodeEnv, corsOrigins, jwt, database (mongoUri, redisUrl). Add any new key to both.

2. **Redis**
   - Generator uses `config.redisUrl` (not `process.env.REDIS_URL`) for `configureRedisStrategy` and `startListening` in the emitted index. Keep it that way.

3. **Port**
   - Pass `--port` from CLI into the template so gateway and service agree (e.g. kyc 9005). Default in generator is 9006; override when generating so the default in config-defaults matches gateway’s `services.*.json`.

4. **Optional common pieces**
   - If a pattern appears in **all** or **most** services (e.g. event dispatcher, webhooks), it stays optional behind flags (`--webhooks`) so the template stays minimal but complete. Document in this file and in CODING_STANDARDS.

5. **Naming**
   - Keep naming consistent: `{shortName}GraphQLTypes`, `create{Service}Resolvers`, `{SERVICE}_CONFIG_DEFAULTS`, `{SERVICE}_ERRORS`, `{Service}Config`, `{Service}ErrorCode`. See CODING_STANDARDS “Microservice naming conventions”.

6. **When adding to the template**
   - When you add a new **common** file or block (e.g. a shared middleware or hook), add it in `service-generator.ts` and document it here under “What the template contains”. Then alignment steps for existing services include “add this block/file if missing”.

---

## 3. Maintenance reference (new services and config changes)

Use this section when **adding a new service** (generate with the CLI, then add business logic) or when **changing config** in an existing service. All current services already follow this; the rules below keep them and new ones consistent.

### 3.1 Config (config.ts and config-defaults.ts)

**File responsibilities (no mixing):**

- **types.ts** – Type definitions only: `{Service}Config extends DefaultServiceConfig`, domain types, input/output interfaces. No default values, no `loadConfig`, no registration.
- **config.ts** – Loading logic only: `loadConfig(brand?, tenantId?)`, `validateConfig`, `printConfigSummary`, getter/setter for current config. Imports `{Service}Config` from `./types.js`; re-exports it. No interface definitions for the service config; no default value constants (those live in config-defaults).
- **config-defaults.ts** – Default value definitions only: export `{SERVICE}_CONFIG_DEFAULTS` with every key used by `loadConfig` (and by domain code). Optionally export a derived type for default shapes (e.g. `ConfigDefaultValues<typeof AUTH_CONFIG_DEFAULTS>`). **No** `loadConfig`, **no** `registerServiceConfigDefaults` call in this file; index.ts calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`.
- **SERVICE_NAME** – Defined and exported from config.ts (`export const SERVICE_NAME = '{service}-service'`). Used in config.ts for `getConfigWithDefault(SERVICE_NAME, key, ...)` and in index.ts for `registerServiceConfigDefaults(SERVICE_NAME, ...)` and `ensureDefaultConfigsCreated(SERVICE_NAME, ...)`. Single constant, no static string for the service name in index.

1. **config.ts**
   - For every key used at runtime: `await getConfigWithDefault(SERVICE_NAME, key, { brand, tenantId }) ?? default` (default is literal or from same file, **not** `process.env`).
   - Export `SERVICE_NAME`; use it for all getConfigWithDefault and in index for registerServiceConfigDefaults / ensureDefaultConfigsCreated.
   - No `process.env` fallbacks.

2. **config-defaults.ts**
   - Every key read in `loadConfig` must exist in `{SERVICE}_CONFIG_DEFAULTS` with `value`, `description`, and `sensitivePaths` where appropriate.
   - No registration logic in this file; index calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`.

### 3.2 Index and bootstrap

3. **index.ts**
   - Import `SERVICE_NAME` from config. Use `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)` and `ensureDefaultConfigsCreated(SERVICE_NAME, ...)` (no static service name string).
   - Use `config.redisUrl` for configureRedisStrategy, redis.initialize, startListening (guard with `if (config.redisUrl)`). All gateway options from `config` only.
   - Order: registerServiceConfigDefaults(SERVICE_NAME, …) → resolveContext → loadConfig → validateConfig → printConfigSummary → db.initialize → createGateway(...) → Redis init (if config.redisUrl) → ensureDefaultConfigsCreated(SERVICE_NAME, …) → startListening (if config.redisUrl) → registerServiceErrorCodes.

### 3.3 Domain code

4. **Use config, not process.env**
   - App config (JWT, URLs, feature flags) must come from the loaded config (e.g. getAuthConfig(), or config passed from index). No `process.env` for app config in domain code.
   - Feature flags (e.g. use MongoDB transactions): add a key in config-defaults and loadConfig; expose on `{Service}Config`; use config in domain code.

**Why the gateway runs MongoDB without replica set (and why transactions are off by default):** The **gateway** (not the core-service infra template) is the source of the default dev Docker/infra. In `gateway/configs/services.dev.json`, `infrastructure.mongodb.mode` is `"single"`. The gateway’s Docker generator (`gateway/scripts/generate.ts`) uses that: for `mode === 'single'` it emits a plain MongoDB service **without** `--replSet` (standalone). So the default dev stack runs MongoDB as a **standalone** instance. MongoDB transactions require a **replica set** (or mongos). So with the default gateway setup, transactions are not supported by the server. Services (payment, bonus) default `useTransactions: true` in config; to avoid “Transaction numbers are only allowed on a replica set member or mongos”, either (a) set `transaction.useTransactions: false` for local/single-Mongo, or (b) use a config that runs Mongo as a replica set (e.g. shared profile, or a single-node replica set). The **core-service** infra template (`core-service/src/infra/templates/docker-compose.ts`) does generate MongoDB **with** replica set (`--replSet rs0` and `rs.initiate`); that template is used by `service-infra service` and is separate from the gateway’s generated compose, which follows gateway config (single by default). So: default = simplest local setup (one Mongo, no replica) → no transactions unless you switch to replica set or disable transaction usage in config.

### 3.4 Verification

5. When adding or changing config:
   - `grep process.env` in that service’s `src/` should only hit comments (or a documented bootstrap exception).
   - Build and run the service; gateway can still pass env for infra/bootstrap; the app reads from the config store once defaults exist.

---

## 4. Quick reference

- **Generate a new service:**  
  `cd core-service && npm run build`  
  `npx service-infra service --name <name> [--port <port>] [--output ..] [--webhooks] [--core-db]`

- **Template source:** `core-service/src/infra/service-generator.ts`

- **Standards:** CODING_STANDARDS.md – “Adding a New Service”, “Microservice naming conventions”, “Service configuration – no process.env (dynamic config only)”

- **Gateway:** Add the new service to `gateway/configs/services.dev.json` (and other profiles); run `npm run generate` from gateway; use same port as in config-defaults.

- **Status:** See **STATUS_CONFIG_AND_STANDARDS.md** (repo root) for what’s done and optional next steps. All five services are aligned; you can run and test them now.

- **Verification:** `grep -r "process\.env" src/` in a service should only return comment lines (or documented bootstrap exception). Use this when adding config or touching a service.
