# Script Migration Guide

## Path Changes

All script paths have been updated to reflect the new organization structure.

### Before → After

#### Payment Scripts
- `scripts/payment-*.ts` → `scripts/typescript/payment/payment-*.ts`
- `scripts/check-duplicates.ts` → `scripts/typescript/payment/check-duplicates.ts`
- `scripts/check-indexes.ts` → `scripts/typescript/payment/check-indexes.ts`
- `scripts/check-wallets.ts` → `scripts/typescript/payment/check-wallets.ts`

#### Auth Scripts
- `scripts/check-admin-*.ts` → `scripts/typescript/auth/check-admin-*.ts`
- `scripts/check-user-*.ts` → `scripts/typescript/auth/check-user-*.ts`
- `scripts/test-login-*.ts` → `scripts/typescript/auth/test-login-*.ts`
- `scripts/test-passport-*.ts` → `scripts/typescript/auth/test-passport-*.ts`
- `scripts/promote-user.ts` → `scripts/typescript/auth/promote-user.ts`
- `scripts/decode-token.ts` → `scripts/typescript/auth/decode-token.ts`

#### Bonus Scripts
- `scripts/bonus-*.ts` → `scripts/typescript/bonus/bonus-*.ts`

#### Ledger Scripts
- `scripts/ledger-*.ts` → `scripts/typescript/ledger/ledger-*.ts`
- `scripts/check-ledger-*.ts` → `scripts/typescript/ledger/check-ledger-*.ts`

#### General Scripts
- `scripts/benchmark.ts` → `scripts/typescript/benchmark.ts`
- `scripts/load-test.ts` → `scripts/typescript/load-test.ts`
- `scripts/channels-tests.ts` → `scripts/typescript/channels-tests.ts`

#### PowerShell Scripts
- `scripts/start-service-dev.ps1` → `scripts/bin/start-service-dev.ps1`

## Updated Commands

### Payment Tests
```bash
# Before
npx tsx scripts/payment-test-all.ts

# After
npx tsx scripts/typescript/payment/payment-test-all.ts
```

### Auth Checks
```bash
# Before
npx tsx scripts/check-admin-user.ts

# After
npx tsx scripts/typescript/auth/check-admin-user.ts
```

### Bonus Tests
```bash
# Before
npx tsx scripts/bonus-test-all.ts

# After
npx tsx scripts/typescript/bonus/bonus-test-all.ts
```

### Ledger Tests
```bash
# Before
npx tsx scripts/ledger-integration-tests.ts

# After
npx tsx scripts/typescript/ledger/ledger-integration-tests.ts
```

## NPM Scripts

The `scripts/package.json` has been updated with convenient shortcuts:

```bash
npm run payment:test      # Run all payment tests
npm run payment:setup     # Setup payment users
npm run payment:clean     # Clean payment data
npm run bonus:test        # Run all bonus tests
npm run bonus:setup       # Setup bonus users
npm run bonus:clean       # Clean bonus data
npm run benchmark         # Run benchmark
npm run load-test         # Run load test
npm run channels-test     # Run channels test
npm run test-ledger       # Run ledger tests
```

## Internal Script References

All internal script references (e.g., `execSync('npx tsx scripts/...')`) have been updated to use the new paths.

## Benefits

1. **Clear Organization**: Scripts grouped by microservice
2. **Easy Discovery**: Find scripts by service quickly
3. **Scalable**: Easy to add new scripts in the right place
4. **Separation**: PowerShell and TypeScript scripts separated
5. **Maintainability**: Related scripts are together
