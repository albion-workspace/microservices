# Scripts Organization

This directory contains all TypeScript and JavaScript scripts organized by microservice.

## Structure

```
typescript/
├── auth/          # Auth service scripts (user management, authentication, sessions)
├── bonus/         # Bonus service scripts (bonus setup, tests, cleanup)
├── ledger/        # Ledger scripts (ledger integration, account checks)
├── payment/       # Payment service scripts (payment tests, duplicates, indexes)
├── benchmark.ts   # Generic microservice benchmark
├── channels-tests.ts  # Real-time communication channels tests
└── load-test.ts   # Generic load testing
```

## Script Categories

### Auth Service (`auth/`)
- **User Management**: `manage-user.ts` (roles, permissions, status, verification)
- **Testing**: `auth-command-test.ts` (comprehensive test suite)

### Payment Service (`payment/`)
- **Tests**: `payment-test-*.ts`, `payment-setup.ts`, `payment-clean.ts`
- **Duplicate Detection**: `check-duplicates.ts`, `remove-duplicates.ts`, `check-duplicate-externalrefs.ts`
- **Indexes**: `check-indexes.ts`, `create-unique-index.ts`, `ensure-externalref-index.ts`, `fix-externalref-index.ts`
- **Data Checks**: `check-wallets.ts`, `check-recent-deposits.ts`, `check-transaction-count.ts`

### Bonus Service (`bonus/`)
- **Setup**: `bonus-setup.ts`
- **Tests**: `bonus-test-all.ts`
- **Cleanup**: `bonus-clean.ts`

### Ledger (`ledger/`)
- **Integration Tests**: `ledger-integration-tests.ts`, `ledger-payment-tests.ts`
- **Account Checks**: `check-ledger-accounts.ts`, `check-ledger-after-funding.ts`

### General/Common (`typescript/`)
- **Benchmark**: `benchmark.ts` - Generic microservice benchmark
- **Load Testing**: `load-test.ts` - Generic load test
- **Channels**: `channels-tests.ts` - Real-time communication tests (SSE, Socket.IO, Webhooks)

## Usage

Run scripts from the project root:

```bash
# Payment tests
npx tsx scripts/typescript/payment/payment-test-all.ts

# Auth tests
npm run auth:test
# Or
npx tsx scripts/typescript/auth/auth-command-test.ts all

# Ledger tests
npx tsx scripts/typescript/ledger/ledger-integration-tests.ts

# General benchmarks
npx tsx scripts/typescript/benchmark.ts
```

## PowerShell Scripts

PowerShell scripts are in `../bin/` directory:
- `start-service-dev.ps1` - Start services in watch mode
- `clean-build-run.ps1` - Clean, build, and run all services
- `clean-all.ps1` - Clean all service data
- `auth-test.ps1` - Run auth service tests
- `test-all-api.ps1` - Run all API tests
