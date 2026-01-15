# Scripts Directory

This directory contains all utility scripts for the microservices platform.

## Structure

```
scripts/
├── bin/                          # Executable commands (user-facing scripts)
│   ├── Database Scripts
│   │   └── promote-to-admin.js   # Promote user to admin via MongoDB (located in scripts/)
│   │
│   ├── Service Management
│   │   ├── start-all.ps1         # Start all services (with build)
│   │   ├── start-all-services.ps1 # Start all services (dev mode)
│   │   ├── start-auth-no-redis.ps1 # Start auth service without Redis
│   │   ├── clean-all.ps1         # Clean all build artifacts
│   │   ├── clean-build-run.ps1   # Clean + Install + Build + Run all
│   │   └── setup-dev.ps1         # Development environment setup
│   │
│   └── Testing Scripts
│       ├── auth-test.ps1         # Comprehensive Auth Service tests (consolidated)
│       ├── test-all-api.ps1      # Comprehensive GraphQL API tests
│       ├── test-payment-transactions.ps1 # Payment transaction flow tests
│       └── test-payment-transactions.sh
│
├── Test Utilities (TypeScript)
│   ├── payment-gateway-tests.ts
│   ├── payment-gateway-demo.ts
│   ├── bonus-service-tests.ts
│   ├── channels-tests.ts          # Real-time channels (WebSocket, SSE, Socket.IO, Webhooks)
│   ├── benchmark.ts
│   └── load-test.ts
│
├── promote-to-admin.js            # Database utility (requires node_modules)
│
└── GraphQL Test Files
    ├── payment-quick-test.graphql
    └── payment-transaction-testing.graphql
```

## Service Ports

- **Auth Service**: `3003`
- **Payment Service**: `3004`
- **Bonus Service**: `3005`
- **Notification Service**: `3006`
- **React App**: `5173`

## Quick Start

### Start All Services
```powershell
.\scripts\bin\start-all.ps1
```

### Clean, Install, Build & Run
```powershell
.\scripts\bin\clean-build-run.ps1
```

### Run API Tests
```powershell
.\scripts\bin\test-all-api.ps1
```

### Run Auth Service Tests
```powershell
.\scripts\bin\auth-test.ps1
```

### Setup Development User
```powershell
.\scripts\bin\setup-dev.ps1
```

### Clean All Artifacts
```powershell
.\scripts\bin\clean-all.ps1
```

### Promote User to Admin
```powershell
cd scripts/bin
node promote-to-admin.js admin@demo.com
# Or from project root:
npm run promote-to-admin -- admin@demo.com
```

## Notes

- All scripts use relative paths from the `scripts` folder
- PowerShell scripts use `$PSScriptRoot` for script directory
- TypeScript scripts use `../` to reference parent directories
- Database scripts require `mongodb` package (installed in scripts/package.json)
