# Payment Scripts - Unified Command Structure

## Overview

All payment-related scripts have been consolidated into **2 unified files** for better maintainability and consistency:

1. **`payment-command-test.ts`** - All payment tests and orchestration
2. **`payment-command-db-check.ts`** - All database checks and maintenance

## File Structure

```
scripts/typescript/payment/
├── payment-command-test.ts      # Unified test suite (2,376 lines)
├── payment-command-db-check.ts  # Unified database checks (1,034 lines)
└── README.md                     # This file
```

## Available Commands

### Test Commands (`payment-command-test.ts`)

| Command | Description | npm script |
|---------|-------------|------------|
| `all` | Complete test suite (clean → setup → all tests → balance summary) | `npm run payment:test` or `npm run payment:test:all` |
| `setup` | Setup users and wallets | `npm run payment:setup` |
| `gateway` | Comprehensive gateway tests (wallet ops, deposits, withdrawals, concurrent, edge cases) | `npm run payment:test:gateway` |
| `funding` | User-to-user funding test | `npm run payment:test:funding` |
| `flow` | Complete payment flow test | `npm run payment:test:flow` |
| `duplicate` | Duplicate protection test | `npm run payment:test:duplicate` |
| `ledger` | Ledger diagnostic test | `npm run payment:test:ledger` |
| `balance-summary` | Generate balance summary report | `npm run payment:test:balance` |

**Usage:**
```bash
# Run all tests (complete suite)
npm run payment:test

# Run specific test
npm run payment:test:funding

# Run multiple tests
npx tsx typescript/payment/payment-command-test.ts funding flow duplicate
```

### Database Commands (`payment-command-db-check.ts`)

| Command | Description | npm script |
|---------|-------------|------------|
| `duplicates` | Check for duplicate externalRefs | `npm run payment:db:duplicates` |
| `indexes` | Check database indexes | `npm run payment:db:indexes` |
| `wallets` | Check wallet balances | `npm run payment:db:wallets` |
| `transactions` | Check transaction counts by type/status | `npm run payment:db:transactions` |
| `deposits` | Check recent deposits | `npm run payment:db:deposits` |
| `create-index` | Create unique indexes | `npm run payment:db:create-index` |
| `fix-index` | Fix/recreate indexes | `npm run payment:db:fix-index` |
| `remove-duplicates` | Remove duplicate transactions | `npm run payment:db:remove-duplicates` |
| `clean` | Clean all databases (drops all databases) | `npm run payment:clean` |

**Usage:**
```bash
# Run all checks
npm run payment:db:check

# Run specific check
npm run payment:db:duplicates

# Clean all databases (drops all databases - payment, bonus, auth, notification)
npm run payment:clean

# Or use the direct script
npm run drop-databases

# Run multiple commands
npx tsx typescript/payment/payment-command-db-check.ts duplicates indexes wallets
```

## Benefits of Consolidation

1. **Single Source of Truth**: All related functionality in one place
2. **Code Reuse**: Shared utilities (GraphQL client, authentication, wallet helpers)
3. **Consistency**: Same patterns and error handling across all tests
4. **Maintainability**: Easier to update and enhance
5. **Performance**: Shared database connections and optimized queries
6. **Easier Testing**: Run all tests or specific ones with simple commands

## Migration Summary

### Files Consolidated into `payment-command-test.ts`:
- ✅ `payment-setup.ts` → `setup` command
- ✅ `payment-gateway-tests.ts` → `gateway` command
- ✅ `payment-test-funding.ts` → `funding` command
- ✅ `payment-test-flow.ts` → `flow` command
- ✅ `payment-test-duplicate.ts` → `duplicate` command
- ✅ `payment-test-ledger.ts` → `ledger` command
- ✅ `payment-test-all.ts` → `all` command (orchestration)

### Files Consolidated into `payment-command-db-check.ts`:
- ✅ `check-duplicates.ts` → `duplicates` command
- ✅ `check-duplicate-externalrefs.ts` → `duplicates` command (merged)
- ✅ `check-indexes.ts` → `indexes` command
- ✅ `check-wallets.ts` → `wallets` command
- ✅ `check-transaction-count.ts` → `transactions` command
- ✅ `check-recent-deposits.ts` → `deposits` command
- ✅ `test-duplicate-check.ts` → `duplicates` command (merged)
- ✅ `create-unique-index.ts` → `create-index` command
- ✅ `ensure-externalref-index.ts` → `create-index` command (merged)
- ✅ `fix-externalref-index.ts` → `fix-index` command
- ✅ `remove-duplicates.ts` → `remove-duplicates` command
- ✅ `payment-clean.ts` → `clean` command

## Shared Utilities

Both files use centralized utilities from `scripts/typescript/config/`:
- `users.ts` - User definitions, authentication, token generation
- `mongodb.js` - Database connections and helpers

## Next Steps

Consider consolidating similar patterns for:
- Bonus service scripts (`bonus-test-all.ts`, `bonus-setup.ts`, `bonus-clean.ts`)
- Auth service scripts
- Other service-specific scripts
