# Scripts Directory

This directory contains all utility scripts for the microservices platform, organized by type and service.

## Structure

```
scripts/
├── bin/                    # PowerShell scripts (.ps1)
│   ├── auth-test.ps1
│   ├── clean-all.ps1
│   ├── clean-build-run.ps1
│   ├── start-service-dev.ps1
│   └── test-all-api.ps1
│
└── typescript/             # TypeScript/JavaScript scripts
    ├── auth/               # Auth service scripts
    ├── bonus/              # Bonus service scripts
    ├── ledger/             # Ledger scripts (general/common)
    ├── payment/            # Payment service scripts
    ├── benchmark.ts        # Generic microservice benchmark
    ├── channels-tests.ts   # Real-time communication tests
    ├── load-test.ts        # Generic load testing
    └── README.md           # Detailed documentation
```

See `typescript/README.md` for detailed script organization and usage.

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
node promote-to-system.js system@demo.com
# Or from project root:
npm run promote-to-system -- system@demo.com
```

## Notes

- All scripts use relative paths from the `scripts` folder
- PowerShell scripts use `$PSScriptRoot` for script directory
- TypeScript scripts use `../` to reference parent directories
- Database scripts require `mongodb` package (installed in scripts/package.json)
