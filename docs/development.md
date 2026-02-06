# Development Guide

> Local setup, testing, scripts, and development workflows.

## Prerequisites

- Node.js 18+
- MongoDB 6.0+
- Redis 6.0+
- Docker Desktop (optional, for Docker/K8s modes)

## Quick Start

```bash
# 1. Build dependencies (required first time)
cd access-engine && npm run build && cd ..
cd core-service && npm run build && cd ..
cd shared-validators && npm run build && cd ..

# 2. Start all services
cd gateway && npm install && npm run dev

# 3. Verify health
npm run health
```

---

## Project Structure

```
tst/
├── access-engine/           # Standalone RBAC/ACL authorization
├── app/                     # React frontend (port 9000)
├── auth-service/            # Authentication (port 9001)
├── bonus-service/           # Bonuses & rewards (port 9003)
├── core-service/            # Shared library
├── gateway/                 # Infrastructure orchestration
├── kyc-service/             # Identity verification (port 9005)
├── notification-service/    # Notifications (port 9004)
├── payment-service/         # Payments & wallets (port 9002)
├── shared-validators/       # Client-safe validators
├── scripts/                 # Test and utility scripts
└── docs/                    # Documentation
```

---

## Testing

### Test Suites

Run from `scripts/` directory:

```bash
cd scripts

# Auth tests (registration, login, OTP, token, 2FA)
npm run auth:test

# Payment tests (complete suite)
npm run payment:test

# Bonus tests (onboarding, recurring, referral)
npm run bonus:test

# Channel tests (SSE, Socket.IO, Webhooks)
npm run channels-test
```

### Test Order

1. **Payment tests first** - Creates users, drops databases
2. **Bonus tests second** - Depends on payment-created users

### Test Commands Reference

#### Auth Service Tests

| Command | Description |
|---------|-------------|
| `npm run auth:test` | Run all auth tests |
| `npm run auth:test:registration` | Registration flow |
| `npm run auth:test:login` | Login flow |
| `npm run auth:test:password-reset` | Password reset |
| `npm run auth:test:otp` | OTP verification |
| `npm run auth:test:token` | Token refresh |
| `npm run auth:test:2fa` | 2FA flow |

#### Payment Service Tests

| Command | Description |
|---------|-------------|
| `npm run payment:test` | Complete test suite |
| `npm run payment:setup` | Setup users and wallets |
| `npm run payment:test:gateway` | Gateway tests |
| `npm run payment:test:funding` | User-to-user funding |
| `npm run payment:test:flow` | Complete payment flow |
| `npm run payment:test:duplicate` | Duplicate protection |
| `npm run payment:test:ledger` | Ledger diagnostic |
| `npm run payment:test:balance` | Balance summary |

#### Payment Database Commands

| Command | Description |
|---------|-------------|
| `npm run payment:db:duplicates` | Check duplicate externalRefs |
| `npm run payment:db:indexes` | Check database indexes |
| `npm run payment:db:wallets` | Check wallet balances |
| `npm run payment:db:transactions` | Check transaction counts |
| `npm run payment:clean` | Clean all databases |

---

## User Management

```bash
# Show user details
npm run auth:manage -- user@example.com show

# Promote to system with all permissions
npm run auth:manage -- user@example.com --all

# Set specific roles
npm run auth:manage -- user@example.com --roles admin,system

# Update user status
npm run auth:manage -- user@example.com status --status active

# Mark email as verified
npm run auth:manage -- user@example.com --email-verified
```

---

## Centralized User Configuration

Test scripts use centralized user configuration from `scripts/typescript/config/users.ts`:

**Available Users:**
- `system` - System user with full access (`system@demo.com`)
- `paymentGateway` - Payment gateway user
- `paymentProvider` - Payment provider user
- `user1` through `user5` - End users for testing

**Usage in Scripts:**
```typescript
import { loginAs, getUserId, registerAs } from '../config/users.js';

// Login by user key
const { token, userId } = await loginAs('system');

// Register/create user
const { userId, created } = await registerAs('system');

// Get user ID
const systemUserId = await getUserId('system');

// Generate JWT tokens
import { createSystemToken, createTokenForUser } from '../config/users.js';
const token = createSystemToken();
```

---

## Verification Plan

Execute phases in order from project root:

### Phase 1: Build Dependencies

```bash
cd access-engine && npm run build && cd ..
cd core-service && npm run build && cd ..
cd shared-validators && npm run build && cd ..
```

### Phase 2: Start Services Locally

**Option A - Gateway (single terminal):**
```bash
cd gateway
npm run dev
```

**Option B - PowerShell script (separate windows):**
```bash
.\scripts\bin\clean-build-run.ps1
```

### Phase 3: Health Check

```bash
cd gateway
npm run health
```

### Phase 4: Gateway Routing (Optional)

```powershell
Invoke-RestMethod -Uri "http://localhost:9999/health" -Headers @{ "X-Target-Service" = "auth" }
```

### Phase 5: Docker

```bash
cd gateway
npm run generate
npm run docker:build
npm run docker:up
npm run health:docker
```

### Phase 6: Kubernetes

```bash
cd gateway
npm run generate:local-k8s
npm run k8s:load-images
npm run k8s:apply:local
npm run health:k8s
```

### Phase 7: API Tests

```bash
cd scripts
npm run auth:test
npm run payment:test
npm run bonus:test
npm run channels-test
```

---

## Configuration

### Dynamic Config (Recommended)

Services use MongoDB-stored configuration, not environment variables:

```typescript
const config = await getConfigWithDefault('payment-service', 'jwt');
```

### Config Files Per Service

- `config-defaults.ts` - Default values with descriptions
- `config.ts` - Loading logic (`loadConfig`, `validateConfig`)
- `types.ts` - TypeScript interfaces

### Config Pattern

```typescript
// config-defaults.ts
export const PAYMENT_CONFIG_DEFAULTS = {
  jwt: { value: { expiresIn: '8h' }, sensitivePaths: ['jwt.secret'] },
  transaction: { value: { useTransactions: true } },
};

// config.ts
export const SERVICE_NAME = 'payment-service';
export async function loadConfig(brand?, tenantId?) {
  return {
    jwt: await getConfigWithDefault(SERVICE_NAME, 'jwt', { brand, tenantId }),
    // ...
  };
}
```

### JWT Configuration

Single JWT secret shared across services with gateway fallback:

```typescript
const jwt = await getConfigWithDefault(SERVICE_NAME, 'jwt')
         ?? await getConfigWithDefault('gateway', 'jwt');
```

---

## Scripts Directory Structure

```
scripts/
├── bin/                           # PowerShell scripts
│   ├── start-service-dev.ps1      # Start services in watch mode
│   ├── clean-build-run.ps1        # Clean, build, run all
│   ├── clean-all.ps1              # Clean all artifacts
│   ├── auth-test.ps1              # Auth service tests
│   └── test-all-api.ps1           # All API tests
│
└── typescript/                    # TypeScript scripts
    ├── auth/                      # Auth tests
    │   ├── auth-command-test.ts   # Unified test suite
    │   └── manage-user.ts         # User management
    │
    ├── payment/                   # Payment tests
    │   ├── payment-command-test.ts    # All payment tests
    │   └── payment-command-db-check.ts # Database checks
    │
    ├── bonus/                     # Bonus tests
    │   ├── bonus-setup.ts
    │   ├── bonus-test-all.ts
    │   └── bonus-clean.ts
    │
    ├── config/                    # Shared configuration
    │   ├── users.ts               # Centralized user config
    │   ├── scripts.ts             # Script utilities
    │   └── drop-all-databases.ts  # Database cleanup
    │
    ├── benchmark.ts               # Generic benchmark
    ├── channels-tests.ts          # Real-time tests
    └── load-test.ts               # Load testing
```

---

## Common Commands

### Gateway (from `gateway/` directory)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services |
| `npm run health` | Check service health |
| `npm run generate` | Generate Docker/K8s configs |
| `npm run docker:fresh` | Fresh Docker deployment |

### Scripts (from `scripts/` directory)

| Command | Description |
|---------|-------------|
| `npm run payment:test` | Payment test suite |
| `npm run bonus:test` | Bonus test suite |
| `npm run auth:test` | Auth test suite |
| `npm run channels-test` | Real-time channel tests |
| `npm run auth:manage` | User management utility |
| `npm run drop-databases` | Drop all databases |

---

## Debugging

### View Logs

```bash
# Docker logs
cd gateway && npm run docker:logs

# K8s logs
kubectl logs -f deployment/auth-service -n microservices
```

### Check Database

```bash
# MongoDB shell
mongosh mongodb://localhost:27017/payment_service

# Redis CLI
redis-cli
```

### Common Issues

**Services not starting:**
```bash
npm run health            # Check which services are down
netstat -ano | findstr "900"  # Check port conflicts
```

**MongoDB replica set errors:**
```bash
npm run docker:recovery:infra  # Reset infra volumes
```

**Test failures with "pending token not found":**
Check that SMTP/SMS providers are configured, or use the OTP retrieval command:
```bash
npx tsx scripts/typescript/auth/auth-command-test.ts otps
```

---

## Service Generator

Generate new microservices using the core-service generator:

```bash
cd core-service && npm run build
npx service-infra service --name <name> --port <port> --output ..
```

**Options:**
- `--name` - Service name (e.g., `test`)
- `--port` - Service port (e.g., `9006`)
- `--output` - Output directory (use `..` for repo root)
- `--webhooks` - Include webhook support
- `--core-db` - Use core_service database

**Generated Structure:**
```
{name}-service/
├── src/
│   ├── index.ts           # Entry point
│   ├── database.ts        # Database accessor
│   ├── redis.ts           # Redis accessor
│   ├── config.ts          # Config loading
│   ├── config-defaults.ts # Default values
│   ├── types.ts           # TypeScript types
│   ├── error-codes.ts     # Error codes
│   └── graphql.ts         # GraphQL schema
├── package.json
└── tsconfig.json
```

---

**See also:** [Deployment](deployment.md), [Services](services.md), [CODING_STANDARDS.md](../CODING_STANDARDS.md)
