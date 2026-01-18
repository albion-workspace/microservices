# Payment Test Scripts - Naming Convention

All payment-related scripts follow the `payment-{action}.ts` naming convention for easy sequencing.

## Scripts Overview

### Setup & Cleanup
- **`payment-clean.ts`** - Cleanup payment data (use `--full` for complete cleanup)
- **`payment-setup.ts`** - Setup payment users with proper roles/permissions

### Individual Tests
- **`payment-test-funding.ts`** - User-to-user funding test
- **`payment-test-flow.ts`** - Complete payment flow test
- **`payment-test-duplicate.ts`** - Duplicate protection and idempotency tests
- **`payment-test-ledger.ts`** - Ledger diagnostic tool

### Test Runner
- **`payment-test-all.ts`** - Run all tests in sequence

## Usage

### Run Individual Scripts
```bash
# Clean payment data
npx tsx scripts/typescript/payment/payment-clean.ts --full

# Setup users
npx tsx scripts/typescript/payment/payment-setup.ts

# Run individual tests
npx tsx scripts/typescript/payment/payment-test-funding.ts
npx tsx scripts/typescript/payment/payment-test-flow.ts
npx tsx scripts/typescript/payment/payment-test-duplicate.ts
npx tsx scripts/typescript/payment/payment-test-ledger.ts
```

### Run All Tests in Sequence
```bash
npx tsx scripts/typescript/payment/payment-test-all.ts
```

This will:
1. Clean payment data (--full)
2. Wait for services to be ready
3. Setup payment users
4. Run all tests in order

## Test Sequence Order

1. **payment-clean.ts** - Clean all payment data
2. **payment-setup.ts** - Create users with proper roles/permissions
3. **payment-test-funding.ts** - Test user-to-user transfers
4. **payment-test-flow.ts** - Test complete payment flow
5. **payment-test-duplicate.ts** - Test duplicate protection
6. **payment-test-ledger.ts** - Verify ledger transactions

## Naming Convention Benefits

- **Easy to find**: All payment scripts start with `payment-`
- **Easy to sequence**: Alphabetical order matches execution order
- **Clear purpose**: Action name indicates what the script does
- **Consistent**: Same pattern for all payment-related scripts
