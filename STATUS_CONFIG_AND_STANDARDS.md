# Microservices config & standards – status

Status of configuration consolidation, `DefaultServiceConfig`, file separation, and SERVICE_NAME usage across microservices. Use this for tracking and handover.

**Last updated**: 2026-02-02

**Plan**: This status implements and extends the Cursor plan **Service Generator Generic Pattern** (`service_generator_generic_pattern_2ab6f42b.plan.md`). That plan defines the goal (generic template, no process.env, align existing services); this doc records what’s done and what’s next.

---

## Done

### 1. JWT secret consolidation

- **Single `jwtSecret`**: Replaced `shared_jwt_secret` / `jwt_secret` with one configurable `jwtSecret` (default `shared-jwt-secret-change-in-production`), shared by default or overridable per environment.
- **Gateway**: `config-loader.ts` and `docker.ts` use unified `JWT_SECRET`; `services.dev.json` and `infra.json` use single `jwtSecret` default.
- **Services**: auth, bonus, payment, kyc, notification use `getConfigWithDefault(..., 'jwt', ...)` with gateway fallback; validation messages refer to `JWT_SECRET` only.
- **Scripts / app**: `clean-build-run.ps1`, `users.ts`, `channels-tests.ts`, `app/src/lib/auth.ts`, `vite-env.d.ts` use single `JWT_SECRET` / `VITE_JWT_SECRET`.

### 2. Common config pattern (gateway fallback)

- **Gateway-level defaults**: `GATEWAY_DATABASE_DEFAULTS`, `GATEWAY_COMMON_DEFAULTS` (corsOrigins, nodeEnv), `GATEWAY_JWT_DEFAULTS` in auth-service `config-defaults.ts`; auth `index.ts` registers gateway defaults.
- **Per-service fallback**: All five services use `getConfigWithDefault(SERVICE_NAME, key) ?? getConfigWithDefault('gateway', key)` for `nodeEnv`, `corsOrigins`, `jwt`, `database` where applicable.

### 3. DefaultServiceConfig (single config interface per service)

- **core-service**: `core-service/src/types/config.ts` defines `DefaultServiceConfig` (port, nodeEnv, serviceName, mongoUri, redisUrl, corsOrigins, jwtSecret, jwtExpiresIn, jwtRefreshSecret?, jwtRefreshExpiresIn?, useMongoTransactions?); exported from `core-service`.
- **Microservices**: Each service has one config interface extending `DefaultServiceConfig`:
  - **auth-service**: `AuthConfig extends DefaultServiceConfig` + auth-specific props (password policy, OTP, OAuth, SMTP, Twilio, etc.) in `types.ts` only.
  - **bonus-service**: `BonusConfig extends DefaultServiceConfig` in `types.ts`.
  - **payment-service**: `PaymentConfig extends DefaultServiceConfig` + payment-specific props in `types.ts`.
  - **kyc-service**: `KYCConfig extends DefaultServiceConfig` in `types.ts`.
  - **notification-service**: `NotificationConfig extends DefaultServiceConfig` + notification-specific props in `types.ts`.
- **config.ts**: Each service imports and re-exports the config type from `types.ts`; no duplicate or base config interfaces (e.g. no `BaseAuthConfig`).

### 4. File separation (types.ts / config.ts / config-defaults.ts)

- **types.ts**: Type/interface definitions only (`{Service}Config`, domain types). No default values, no `loadConfig`, no registration.
- **config.ts**: Loading only (`loadConfig`, `validateConfig`, `printConfigSummary`, getter/setter). Imports config type from `types.ts`; no config interface definition, no default constants.
- **config-defaults.ts**: Default value object `{SERVICE}_CONFIG_DEFAULTS` only. No `loadConfig`, no registration call; **index.ts** calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`.
- **KYC alignment**: KYC previously had `registerKYCConfigDefaults()` in config-defaults; refactored to export `KYC_CONFIG_DEFAULTS` and perform registration in index with `registerServiceConfigDefaults('kyc-service', KYC_CONFIG_DEFAULTS)` (now using `SERVICE_NAME`).

### 5. SERVICE_NAME constant

- **config.ts**: Each service exports `SERVICE_NAME` (`export const SERVICE_NAME = '{service}-service'`).
- **index.ts**: Each service imports `SERVICE_NAME` from config and uses it for:
  - `registerServiceConfigDefaults(SERVICE_NAME, ...)`
  - `ensureDefaultConfigsCreated(SERVICE_NAME, ...)` (auth, bonus, payment; notification/kyc call it where applicable).
- **Service generator**: Template emits `export const SERVICE_NAME` in config.ts and `import { ..., SERVICE_NAME } from './config.js'` in index; uses `SERVICE_NAME` in `registerServiceConfigDefaults` and `ensureDefaultConfigsCreated` (no static string for service name in index).

### 6. Documentation

- **CODING_STANDARDS.md**: Config section updated with single JWT, `DefaultServiceConfig`, file separation, and SERVICE_NAME constant; reference to SERVICE_GENERATOR.md §3.1.
- **SERVICE_GENERATOR.md**: §3.1 documents file responsibilities (types/config/config-defaults) and SERVICE_NAME usage; template and alignment steps reference the same pattern.
- **Gateway**: README/STATUS and configs reflect single JWT and shared defaults where relevant.

### 7. Build verification

- core-service, auth-service, bonus-service, payment-service, notification-service, kyc-service all build successfully after the above changes.

---

## What is next (suggested)

### High level

1. **process.env audit (optional)**  
   CODING_STANDARDS and SERVICE_GENERATOR require dynamic config only (no `process.env` in microservice config). Any remaining `process.env` in service `src/` should be either removed or documented as a bootstrap/core-DB exception (e.g. strategy resolution before config store). Grep `process.env` in each service and align or document.

2. **Default values DRY (optional)**  
   Some services have inline fallback objects in `loadConfig` that duplicate values from config-defaults. Optionally derive fallbacks from `{SERVICE}_CONFIG_DEFAULTS.*.value` in config.ts to keep a single source of truth (especially for auth-service with many keys).

3. **New services**  
   Use the service generator for any new microservice so it gets `SERVICE_NAME`, `DefaultServiceConfig`, and the types/config/config-defaults split by default. Then add service-specific config keys and domain logic.

4. **Gateway / infra**  
   Keep gateway `STATUS.md` and configs in sync when adding profiles or changing JWT/database defaults. No further config consolidation required for current scope.

### Optional follow-ups

- **Tests**: Improve test isolation and reduce order-dependency (see CODING_STANDARDS “Test Scripts” and “Current Test Limitations”).
- **GraphQL ↔ TypeScript**: Run `verify-graphql-types` when changing schemas or types.
- **KYC config-defaults type**: If desired, add a derived type for default shapes (e.g. `ConfigDefaultValues<typeof KYC_CONFIG_DEFAULTS>`) and use it in `loadConfig` for `getConfigWithDefault` typing, similar to auth-service.

---

## Quick reference

| Area              | Location / pattern |
|-------------------|--------------------|
| Service config    | `{Service}Config extends DefaultServiceConfig` in `types.ts`; single type per service. |
| Loading           | `config.ts`: `loadConfig`, `validateConfig`, `printConfigSummary`; re-export type from types. |
| Defaults          | `config-defaults.ts`: `{SERVICE}_CONFIG_DEFAULTS`; index calls `registerServiceConfigDefaults(SERVICE_NAME, ...)`. |
| Service name      | `export const SERVICE_NAME` in config.ts; use in index for register/ensureDefaultConfigsCreated. |
| JWT               | One `jwtSecret`; gateway fallback via `getConfigWithDefault('gateway', 'jwt')`. |
| Docs              | CODING_STANDARDS.md (config + file separation + SERVICE_NAME); SERVICE_GENERATOR.md §3.1. |
