# Service Generator

The **service generator** (`service-infra service --name <name> ...`) is the single source of truth for microservice structure. New services are generated from this template; existing services (auth, bonus, payment, notification) should be aligned to the same pattern so all services share the same common infra and config approach.

This document describes:
1. **Config analysis** – which services use dynamic config vs `process.env`
2. **Steps for the template** – what the generator must contain so it matches “all common stuff” of other services
3. **Steps to align existing services** – how to make auth, bonus, payment, notification match the generated template

---

## 1. Config analysis (dynamic vs process.env)

**CODING_STANDARDS.md** requires: *"Do not use `process.env` in microservices. All config must come from the MongoDB config store via `getConfigWithDefault`."*

| Service | config.ts | index.ts / other | Aligned to template? |
|--------|-----------|-------------------|----------------------|
| **kyc-service** (generated) | ✅ getConfigWithDefault only | ✅ config.redisUrl | **Yes** – reference |
| auth-service | ❌ env overrides (port, mongo, redis, jwt, oauth, smtp, twilio, urls, cors, etc.) | ❌ REDIS_URL in index; JWT/URLs in graphql, oauth-routes, password, otp-provider | **No** |
| bonus-service | ❌ env overrides (port, mongo, redis, nodeEnv, serviceName, cors, jwt) | ❌ REDIS_URL in index; MONGO_TRANSACTIONS in bonus.ts | **No** |
| payment-service | ❌ env overrides (port, mongo, redis, jwt, exchangeRate, transaction, wallet, transfer) | ❌ REDIS_URL in index; MONGO_TRANSACTIONS in transfer/transaction/wallet | **No** |
| notification-service | ❌ env overrides (port, mongo, redis, smtp, twilio, push, queue, realtime) | ❌ CORS + JWT in index.ts | **No** |

**Conclusion:** Only the **generated** service (e.g. kyc-service) is fully aligned. Other services use a hybrid: `getConfigWithDefault` for some keys but `process.env` overrides in `config.ts` and `process.env` in `index.ts` / domain code. Aligning them means making them behave as if they were generated from the template and then given service-specific additions (extra config keys, resolvers, event handlers).

---

## 2. Steps for the template (generator)

Ensure the **service template** (output of `service-generator.ts`) contains all **common** infra that every service should have. When adding behavior that is shared across auth, bonus, payment, notification, add it to the generator so new services get it by default and alignment is straightforward.

### 2.1 What the template already contains

- **package.json** – name, scripts (start, dev, build, build:run, test), dependencies (access-engine, core-service), devDependencies (@types/node, typescript)
- **tsconfig.json** – ES2020, ESNext, strict, rootDir src, outDir dist
- **src/database.ts** – `createServiceDatabaseAccess(serviceName)` (or core-service for `--core-db`)
- **src/redis.ts** – `createServiceRedisAccess(serviceName)` (when `--redis`)
- **src/error-codes.ts** – `{SERVICE}_ERRORS`, `{SERVICE}_ERROR_CODES`, type `{Service}ErrorCode`, prefix `MS{Service}`
- **src/config-defaults.ts** – `{SERVICE}_CONFIG_DEFAULTS` with port, serviceName, nodeEnv, corsOrigins, jwt, database (mongoUri, redisUrl); sensitivePaths for secrets
- **src/config.ts** – `loadConfig(brand?, tenantId?)` using **only** `getConfigWithDefault(SERVICE_NAME, key, { brand, tenantId }) ?? default`; no `process.env`
- **src/types.ts** – `{Service}Config` (port, nodeEnv, serviceName, corsOrigins, mongoUri, redisUrl, jwt*)
- **src/graphql.ts** – `{shortName}GraphQLTypes`, `create{Service}Resolvers(config)` with health + `{name}Health`
- **src/services/index.ts** – placeholder export
- **src/index.ts** – registerServiceConfigDefaults → resolveContext → loadConfig → validateConfig → printConfigSummary → db.initialize → createGateway(services, permissions, mongoUri, redisUrl) → Redis init using **config.redisUrl** → ensureDefaultConfigsCreated → startListening using **config.redisUrl** → registerServiceErrorCodes

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

## 3. Steps to align existing services to the template

Goal: auth, bonus, payment, notification (and any other existing service) should **look as if** they were generated from the template and then extended with service-specific config, resolvers, and domain logic. No behavior change required for deployment if infra already injects env vars; we only change **where** the app reads config (config store only).

### 3.1 Config (config.ts and config-defaults.ts)

1. **config.ts**
   - For **every** key used at runtime, use only:
     - `await getConfigWithDefault(SERVICE_NAME, key, { brand, tenantId }) ?? default`
     - where `default` is a literal or a value from the same file (e.g. from a constants object), **not** `process.env`.
   - Remove all `process.env.*` fallbacks (PORT, MONGO_URI, REDIS_URL, NODE_ENV, SERVICE_NAME, CORS_ORIGINS, JWT_*, and any service-specific env vars).
   - Keep the same keys and types; only the source of the value changes (config store instead of env).

2. **config-defaults.ts**
   - Ensure **every** key read in `loadConfig` exists in `{SERVICE}_CONFIG_DEFAULTS` with `value`, `description`, and `sensitivePaths` where appropriate (e.g. jwt, database, smtp, twilio).
   - If a key exists in config.ts but not in config-defaults, add it so that `registerServiceConfigDefaults` and `ensureDefaultConfigsCreated` can create it in the store.

3. **Order of migration (per service)**
   - Prefer doing one service at a time (e.g. bonus, then payment, then notification, then auth).
   - Within a service: first port, mongoUri, redisUrl, nodeEnv, serviceName, corsOrigins, jwt; then domain-specific keys (exchangeRate, transaction, wallet, transfer, smtp, twilio, oauth, etc.).

### 3.2 Index and bootstrap

4. **index.ts**
   - Replace any `process.env.REDIS_URL` with `config.redisUrl` for:
     - `configureRedisStrategy({ defaultUrl: ... })`
     - `redis.initialize(...)`
     - `startListening(...)` (guard with `if (config.redisUrl)`).
   - Ensure gateway options (port, cors, jwt, mongoUri, redisUrl) come from `config` only (already the case once config is loaded from config store).

5. **Order of execution**
   - Match the template: registerServiceConfigDefaults → resolveContext → loadConfig → validateConfig → printConfigSummary → db.initialize → createGateway(...) → Redis init (if config.redisUrl) → ensureDefaultConfigsCreated → startListening (if config.redisUrl) → registerServiceErrorCodes. Reorder only if necessary for legacy reasons; document the reason.

### 3.3 Domain code (no process.env)

6. **Use config or inject options**
   - Any file that today reads `process.env` for **app config** (e.g. JWT secret, URLs, feature flags) should instead receive config via arguments or a shared `loadConfig()` result. Examples:
     - **auth**: graphql.ts, oauth-routes.ts, password.ts, otp-provider.ts – use config (jwt, frontendUrl, appUrl, notificationServiceUrl) from the single loaded config; do not read `process.env.JWT_SECRET`, `process.env.FRONTEND_URL`, etc.
   - **Feature flags / operational options** (e.g. “use MongoDB transactions”): add a key to config (e.g. `transaction.useTransactions`) and read it via `getConfigWithDefault` in config.ts; expose on `{Service}Config`. Remove `process.env.MONGO_TRANSACTIONS` from payment-service and bonus-service and use the config value instead.

### 3.4 Auth-service specifics

7. Auth has the most env usage (OAuth, SMTP, Twilio, URLs, password/OTP/session). Migrate in stages:
   - Stage 1: port, mongoUri, redisUrl, nodeEnv, serviceName, jwt, corsOrigins → config store only; index.ts uses config.redisUrl.
   - Stage 2: urls (frontendUrl, appUrl), password/OTP/session defaults → config-defaults + getConfigWithDefault only.
   - Stage 3: OAuth, SMTP, Twilio, WhatsApp, Telegram → config-defaults + getConfigWithDefault only; remove process.env in config.ts.
   - Stage 4: graphql.ts, oauth-routes.ts, password.ts, otp-provider.ts – stop using process.env; use config passed from index or a shared getConfig().

### 3.5 Verification

8. After alignment for a service:
   - Grep for `process.env` in that service’s `src`: there should be **no** matches (except possibly in a test or script that is clearly tooling).
   - Build and run the service; ensure gateway still starts it with the same env vars if needed – the app will ignore them and read from the config store once defaults are created (e.g. by ensureDefaultConfigsCreated or by an admin seeding the store from env).

---

## 4. Quick reference

- **Generate a new service:**  
  `cd core-service && npm run build`  
  `npx service-infra service --name <name> [--port <port>] [--output ..] [--webhooks] [--core-db]`

- **Template source:** `core-service/src/infra/service-generator.ts`

- **Standards:** CODING_STANDARDS.md – “Adding a New Service”, “Microservice naming conventions”, “Service configuration – no process.env (dynamic config only)”

- **Gateway:** Add the new service to `gateway/configs/services.dev.json` (and other profiles); run `npm run generate` from gateway; use same port as in config-defaults.

- **Finding process.env usage:** When aligning a service, run `grep -r "process\.env" src/` in that service to get a file-by-file list; use it to drive the alignment steps above.
