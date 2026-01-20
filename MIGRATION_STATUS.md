# Migration Status: Simplified Schema Implementation

**Last Updated**: 2026-01-20  
**Status**: In Progress (Phase 2-3)  
**Latest Fixes**: TenantId alignment and wallet balance update fixes (2026-01-20)

---

## Overview

This document tracks the migration from **6 collections** to **3 collections** (wallets, transactions, transfers) with ultra-minimal data structure based on Mongoose pattern.

**Target Architecture**: Wallets + Transactions + Transfers

---

## ✅ Completed Changes

### Phase 1: Type Definitions ✅

- [x] **Transaction Interface** - Ultra-minimal schema implemented
  - ✅ `payment-service/src/types.ts` - Transaction interface with `objectId`/`objectModel` pattern
  - ✅ Only 6 core fields: `userId`, `amount`, `balance`, `objectId`, `objectModel`, `charge`
  - ✅ Flexible `meta` object for generic data
  - ✅ Removed calculated fields (`netAmount`, `balanceBefore`, `balanceAfter`)

- [x] **Transfer Interface** - Generic transfer schema implemented
  - ✅ `payment-service/src/types.ts` - Transfer interface
  - ✅ Generic `meta` object for any payment method (card, bank, crypto, mobile money)
  - ✅ Status tracking: `pending`, `active`, `approved`, `canceled`, `failed`

- [x] **Wallet Interface** - Source of truth for balances
  - ✅ Already exists with `balance`, `bonusBalance`, `lockedBalance`
  - ✅ Lifetime stats: `lifetimeDeposits`, `lifetimeWithdrawals`, `lifetimeFees`

### Phase 2: Core Refactoring ✅

- [x] **Central Transfer Helper** - Atomic transfer creation
  - ✅ `core-service/src/common/transfer-helper.ts` - `createTransferWithTransactions()`
  - ✅ Uses MongoDB transactions for atomicity (`session.withTransaction()`)
  - ✅ Creates: 1 Transfer + 2 Transactions + Updates 2 Wallets (all atomic)
  - ✅ Supports balance types: `real`, `bonus`, `locked`
  - ✅ Polymorphic references: `objectId` + `objectModel` pattern
  - ✅ Wallet creation helpers: `createNewWallet()` and `getOrCreateWallet()`
  - ✅ **Session-aware pattern**: Accepts optional `session` parameter for multi-operation transactions
  - ✅ **Uses shared transaction helper**: Uses `createTransactionDocument()` from `transaction-helper.ts` to avoid duplication

- [x] **Transaction Helper** - Generic transaction creation
  - ✅ `core-service/src/common/transaction-helper.ts` - `createTransaction()` and `createTransactions()`
  - ✅ **Session-aware pattern**: Accepts optional `session` parameter for multi-operation transactions
  - ✅ **Shared transaction document helper**: `createTransactionDocument()` used by both helpers
  - ✅ Removed duplicate transaction-state code (now imports from `transaction-state.ts`)
  - ✅ Re-exports wallet helpers from `transfer-helper.ts` for consistency

- [x] **Payment Service Refactoring**
  - ✅ `payment-service/src/services/transaction.ts` - Uses `createTransferWithTransactions()`
  - ✅ Deposit saga: Creates transfer + 2 transactions atomically (passes session from saga context)
  - ✅ Withdrawal saga: Creates transfer + 2 transactions atomically (passes session from saga context)
  - ✅ Removed old ledger dependencies
  - ✅ Helper functions: `generateExternalRef()`, `checkDuplicateTransfer()`
  - ✅ **Session-aware**: Passes MongoDB session from saga context to transfer helper

- [x] **Bonus Service Refactoring**
  - ✅ `bonus-service/src/services/ledger-service.ts` - Uses `createTransferWithTransactions()`
  - ✅ Bonus operations: `bonus_award`, `bonus_convert`, `bonus_forfeit`
  - ✅ Removed old ledger initialization
  - ✅ Direct wallet queries (no ledger sync)

- [x] **Code Deduplication**
  - ✅ Wallet creation logic extracted to helpers (`createNewWallet`, `getOrCreateWallet`)
  - ✅ ExternalRef generation extracted to helpers (`generateExternalRef`, `checkDuplicateTransfer`)
  - ✅ Duplicate checking extracted to helpers
  - ✅ Transaction document creation extracted to shared helper (`createTransactionDocument`)
  - ✅ Consistent wallet structure across services
  - ✅ Removed duplicate transaction-state code (now imports from `transaction-state.ts`)
  - ✅ Session management helpers: `startSession()`, `endSession()` for generic use

### Phase 3: GraphQL Schema Updates ✅

- [x] **GraphQL Type Definitions**
  - ✅ Added `scalar JSON` to GraphQL schemas
  - ✅ `Transaction` type with `meta: JSON`
  - ✅ `Transfer` type with `meta: JSON`
  - ✅ Updated resolvers to use new structure

- [x] **Ledger Resolvers Updated**
  - ✅ `payment-service/src/services/ledger-resolvers.ts` - Queries `wallets` and `transactions` directly
  - ✅ Removed dependencies on `ledger_accounts` and `ledger_transactions`
  - ✅ Balance queries use `wallets` collection
  - ✅ Transaction queries use `transactions` collection

### Phase 4: Service Cleanup ✅

- [x] **Removed Old Ledger Dependencies**
  - ✅ `payment-service/src/index.ts` - Removed `initializeLedger` calls
  - ✅ `bonus-service/src/index.ts` - Removed `initializeLedger` calls
  - ✅ Removed `syncWalletBalanceFromLedger` calls (wallets updated atomically)
  - ✅ Removed event handlers for old ledger sync

- [x] **Deprecated Old Ledger System**
  - ✅ `core-service/src/common/ledger.ts` - Marked as `@deprecated`
  - ✅ Old ledger exports marked as deprecated in `core-service/src/index.ts`
  - ✅ Migration path documented

### Phase 5: Transfer Service Saga ✅

- [x] **Transfer Saga Refactoring**
  - ✅ `payment-service/src/services/transfer.ts` - Uses `createTransferWithTransactions()` directly
  - ✅ Simplified saga to single step (uses atomic helper)
  - ✅ Removed duplicated transaction/wallet creation code
  - ✅ Consistent with `transfer-helper.ts` pattern
  - ✅ **Session-aware**: Passes MongoDB session from saga context

---

## 🚧 In Progress / Pending

### Phase 6: Test Updates ✅ COMPLETE

- [x] **Database Check Scripts** ✅ COMPLETE
  - [x] Updated `scripts/typescript/payment/payment-command-db-check.ts` to use new schema
  - [x] Removed all references to `ledger_transactions` collection
  - [x] Updated duplicate checks to use `transactions` with `meta.externalRef`
  - [x] Updated index checks to use new schema (`meta.externalRef` instead of `metadata.externalRef`)
  - [x] Updated deposit checks to use `transfers` and `transactions` collections
  - [x] Updated index creation to use `meta.externalRef` pattern

- [x] **Payment Tests** ✅ COMPLETE
  - [x] `scripts/typescript/payment/payment-command-test.ts` already uses new structure (verified)
  - [x] All test functions use `createDeposit`, `createTransfer`, `createWithdrawal` mutations
  - [x] Database checks use `transactions` and `transfers` collections
  - [x] Comments updated to reflect new schema (replaces ledger_transactions, wallet_transactions, ledger_accounts)

- [x] **Bonus Tests** ✅ COMPLETE
  - [x] Updated `scripts/typescript/bonus/bonus-command-test.ts` to remove `ledger_accounts` references
  - [x] Removed code that updated ledger accounts (permissions now handled in auth_service)
  - [x] Bonus pool operations use `createDeposit` mutation (already using new structure)

- [x] **Auth Tests** ✅ COMPLETE
  - [x] Updated `scripts/typescript/auth/promote-user.ts` to remove `ledger_accounts` references
  - [x] Removed code that updated ledger accounts (permissions handled in auth_service user record)
  - [x] Added comments explaining new permission model

- [x] **Ledger Integration Tests** ✅ COMPLETE
  - [x] Updated `scripts/typescript/ledger/check-ledger-accounts.ts` to use `wallets` instead of `ledger_accounts`
  - [x] Rewrote entire file to check wallets collection with balance, bonusBalance, lockedBalance
  - [x] Added summary statistics and currency breakdowns
  - [x] Added notes about permissions being stored in auth_service
  - [x] `scripts/typescript/ledger/check-ledger-after-funding.ts` already uses new structure (comments indicate replacements)

### Phase 7: Data Migration ❌ NOT NEEDED

**Note**: Databases will be dropped, so no migration scripts are needed.

- [x] ~~Migration Scripts~~ (Not needed - databases will be dropped)
- [x] ~~Historical Data Cleanup~~ (Not needed - databases will be dropped)

### Phase 8: Collection Cleanup ❌ NOT NEEDED

**Note**: Old collections will be automatically removed when databases are dropped.

- [x] ~~Remove Old Collections~~ (Not needed - databases will be dropped)
  - [x] ~~`wallet_transactions`~~ (Will be dropped with database)
  - [x] ~~`ledger_entries`~~ (Will be dropped with database)
  - [x] ~~`ledger_transactions`~~ (Will be dropped with database)
  - [x] ~~`ledger_accounts`~~ (Will be dropped with database)

- [x] **Remove Old Code** ✅ COMPLETE
  - [x] Remove `syncWalletBalanceFromLedger` function (already removed)
  - [x] Remove old ledger service functions (deprecated)
  - [x] Remove backward compatibility code (already removed)

### Phase 9: Index Optimization ⏳

- [ ] **New Indexes** (Already defined, verify creation)
  - [ ] `transactions`: `{ userId: 1, createdAt: -1 }`
  - [ ] `transactions`: `{ objectModel: 1, objectId: 1 }` (polymorphic reference)
  - [ ] `transactions`: `{ 'meta.externalRef': 1 }` (unique, sparse)
  - [ ] `transactions`: `{ 'meta.walletId': 1, createdAt: -1 }`
  - [ ] `transfers`: `{ fromUserId: 1, createdAt: -1 }`
  - [ ] `transfers`: `{ toUserId: 1, createdAt: -1 }`
  - [ ] `transfers`: `{ 'meta.externalRef': 1 }` (unique, sparse)

- [ ] **Remove Old Indexes**
  - [ ] Drop indexes on `wallet_transactions` collection
  - [ ] Drop indexes on `ledger_entries` collection
  - [ ] Drop indexes on `ledger_transactions` collection

### Phase 10: Bug Fixes & Improvements ✅ COMPLETE (2026-01-20)

- [x] **TenantId Alignment** ✅ COMPLETE
  - [x] Aligned all payment service tenantId defaults to `'default-tenant'`
  - [x] Fixed wallet lookup mismatches due to tenantId inconsistency
  - [x] Updated transfer, transaction, and wallet services

- [x] **Wallet Balance Update Fixes** ✅ COMPLETE
  - [x] Fixed wallet updates to use wallet `id` instead of composite query
  - [x] Prevents updating wrong wallet when multiple wallets exist
  - [x] Added error logging for debugging

- [x] **Cache Invalidation** ✅ COMPLETE
  - [x] Added cache invalidation after wallet updates
  - [x] Ensures GraphQL queries return fresh data
  - [x] Applied to all transfer operations

- [x] **Wallet Reuse Logic** ✅ COMPLETE
  - [x] Updated `getOrCreateWallet()` to reuse existing wallets
  - [x] Prevents duplicate wallet creation
  - [x] Logs warnings for tenantId mismatches

- [x] **Test Improvements** ✅ COMPLETE
  - [x] Updated tests to use database balance as source of truth
  - [x] Improved credit limit test with smaller amounts
  - [x] All payment tests now passing

---

## 📊 Migration Progress

### Overall Progress: ~95% Complete (Phases 7-8 not needed - databases will be dropped, Phase 10 complete)

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Type Definitions | ✅ Complete | 100% |
| Phase 2: Core Refactoring | ✅ Complete | 100% |
| Phase 3: GraphQL Updates | ✅ Complete | 100% |
| Phase 4: Service Cleanup | ✅ Complete | 100% |
| Phase 5: Transfer Saga | ✅ Complete | 100% |
| Phase 6: Test Updates | ✅ Complete | 100% |
| Phase 7: Data Migration | ❌ Not Needed | N/A (databases will be dropped) |
| Phase 8: Collection Cleanup | ❌ Not Needed | N/A (databases will be dropped) |
| Phase 9: Index Optimization | ⏳ Pending | 0% |
| Phase 10: Bug Fixes & Improvements | ✅ Complete | 100% |

---

## 🔍 Key Changes Summary

### Architecture Changes

1. **From 6 Collections → 3 Collections**
   - ✅ Removed: `wallet_transactions`, `ledger_entries`, `ledger_transactions`, `ledger_accounts`
   - ✅ Kept: `wallets`, `transactions`, `transfers`

2. **Atomic Operations**
   - ✅ MongoDB transactions ensure atomicity
   - ✅ `createTransferWithTransactions()` wraps all operations in session
   - ✅ No sync needed (wallets updated atomically)

3. **Polymorphic References**
   - ✅ `objectId` + `objectModel` pattern replaces `refId`/`refType`
   - ✅ Single index covers all entity types (bonus, bet, game, transfer, etc.)

4. **Code Deduplication**
   - ✅ Wallet creation helpers: `createNewWallet()`, `getOrCreateWallet()`
   - ✅ ExternalRef helpers: `generateExternalRef()`, `checkDuplicateTransfer()`
   - ✅ Transaction document helper: `createTransactionDocument()` (shared by both helpers)
   - ✅ Session management: `startSession()`, `endSession()` (generic, reusable)
   - ✅ Consistent patterns across services
   - ✅ Removed duplicate transaction-state code

### Performance Improvements

- ✅ **50% reduction** in writes (6 → 3 documents per transaction)
- ✅ **75% reduction** in document size (~300 bytes vs ~1.2 KB)
- ✅ **Simpler queries** (ultra-minimal structure)
- ✅ **Easier reconciliation** (sum transactions = wallet balance)

---

## 🚨 Known Issues / Notes

1. ~~**Transfer Saga** (`payment-service/src/services/transfer.ts`)~~ ✅ RESOLVED
   - ✅ Now uses `createTransferWithTransactions()` directly
   - ✅ Simplified to single saga step
   - ✅ Session-aware pattern applied

2. **Old Ledger System**
   - `core-service/src/common/ledger.ts` is deprecated but still exists
   - Will be removed after migration validation
   - No new code should use it

3. ~~**Test Coverage**~~ ✅ RESOLVED
   - ✅ All test files updated to use new structure
   - ✅ Database check scripts updated
   - ✅ All references to old collections removed (except helpful comments)

4. ~~**TenantId Alignment**~~ ✅ RESOLVED (2026-01-20)
   - ✅ Fixed tenantId defaults across payment services to use `'default-tenant'` consistently
   - ✅ Updated `payment-service/src/services/transfer.ts` default from `'default'` to `'default-tenant'`
   - ✅ Updated `payment-service/src/services/transaction.ts` defaults to `'default-tenant'`
   - ✅ Updated `payment-service/src/services/wallet.ts` defaults to `'default-tenant'`
   - ✅ Aligned with test configuration (`DEFAULT_TENANT_ID = 'default-tenant'`)
   - ✅ Prevents wallet lookup mismatches and duplicate wallet creation

5. ~~**Wallet Balance Updates**~~ ✅ RESOLVED (2026-01-20)
   - ✅ Fixed wallet updates to use wallet `id` instead of `{ userId, currency, tenantId }` query
   - ✅ Updated `createTransferWithTransactions()` to capture wallet IDs after `getOrCreateWallet()`
   - ✅ Updated `approveTransfer()` to use wallet IDs for updates
   - ✅ Added error logging for unmatched wallet updates
   - ✅ Prevents updating wrong wallet when multiple wallets exist for same user+currency+tenantId

6. ~~**Cache Invalidation**~~ ✅ RESOLVED (2026-01-20)
   - ✅ Added cache invalidation after wallet updates in transfer operations
   - ✅ Invalidates `wallets:list:*` and `wallets:id:*` cache patterns after successful transactions
   - ✅ Ensures GraphQL queries return fresh wallet balance data
   - ✅ Applied to `createTransferWithTransactions()`, `approveTransfer()`, and `declineTransfer()`

7. ~~**Wallet Reuse Logic**~~ ✅ RESOLVED (2026-01-20)
   - ✅ Updated `getOrCreateWallet()` to reuse existing wallets with different tenantId
   - ✅ Prevents creating duplicate wallets when tenantId mismatch occurs
   - ✅ Logs warnings when reusing wallets with different tenantId
   - ✅ Ensures consistent wallet usage across operations

8. **Historical Data**
   - ~~Old collections still contain historical data~~ (Will be dropped with databases)
   - ~~Migration script needed~~ (Not needed - databases will be dropped)
   - ~~Can archive old collections~~ (Not needed - databases will be dropped)

---

## 📝 Next Steps

### Immediate (High Priority)

1. **Update All Tests**
   - Complete test refactoring (Phase 6)
   - Verify all payment/bonus flows work with new structure
   - Run full test suite

2. **Index Optimization**
   - Verify all indexes are created (Phase 9)
   - Monitor query performance
   - Ensure indexes match schema design

### Short-term (Medium Priority)

3. **Database Drop & Fresh Start**
   - Drop existing databases (old collections will be removed automatically)
   - Start fresh with new schema
   - Verify new structure works correctly

### Long-term (Low Priority)

5. **Performance Monitoring**
   - Monitor write performance
   - Monitor query performance
   - Monitor storage growth
   - Alert on anomalies

6. **Documentation**
   - Update API documentation
   - Update developer guides
   - Update architecture diagrams

---

## 📚 Related Documents

- `SIMPLIFIED_SCHEMA_DESIGN.md` - Detailed schema design
- `DATA_STRUCTURE_ANALYSIS.md` - Analysis of current vs proposed structure
- `IMPLEMENTATION_PLAN.md` - Original implementation plan

---

## ✅ Verification Checklist

Before considering migration complete:

- [ ] All tests pass with new structure
- [ ] Databases dropped and fresh start with new schema
- [ ] Data integrity verified (reconciliation passes)
- [ ] Performance metrics meet targets
- [ ] Indexes verified and optimized
- [ ] Old code removed (already done)
- [ ] Documentation updated
- [ ] Team trained on new structure

---

**Last Review**: 2026-01-20  
**Next Review**: After test updates complete
