# Implementation Plan: Simplified Schema Migration

## Goal
Reduce from **6 collections** to **3 collections** (wallets, transactions, transfers) with ultra-minimal data structure based on Mongoose pattern.

## 📊 Migration Status

**Overall Progress**: ~85% Complete (Phases 7-8 not needed - databases will be dropped)

**See `MIGRATION_STATUS.md` for detailed status tracking.**

### ✅ Completed (Phases 1-5 + Code Quality)
- Type definitions updated
- Core refactoring complete (`createTransferWithTransactions` helper)
- GraphQL schemas updated
- Service cleanup done
- Code deduplication complete
- **Session-aware pattern**: Both `createTransaction` and `createTransferWithTransactions` accept optional session
- **Shared transaction helper**: `createTransactionDocument()` used by both helpers
- **Removed duplicate code**: Transaction-state code consolidated, transaction creation shared

### ⏳ In Progress (Phase 6)
- Test updates (30% complete)
- User provided partial changes for some tests

### ⏳ Pending (Phases 7-9)
- ~~Data migration scripts~~ (Not needed - databases will be dropped)
- ~~Historical data migration~~ (Not needed - databases will be dropped)
- ~~Collection cleanup~~ (Not needed - databases will be dropped)
- Index optimization (verify indexes are created correctly)

---

## Phase 1: Update Type Definitions

### 1.1 Create Transaction Interface (Ultra-Minimal)

**File**: `payment-service/src/types.ts`

```typescript
// Ultra-minimal transaction schema (based on Mongoose pattern)
export interface Transaction {
  id: string;                      // Transaction ID
  tenantId: string;
  
  // User reference (required)
  userId: string;                  // Reference to auth.users._id (ObjectId)
  
  // Amounts (MINIMAL)
  amount: number;                  // Transaction amount (cents) - ALWAYS POSITIVE
  balance: number;                 // Wallet balance AFTER this transaction (cents)
  
  // Polymorphic reference (replaces refId/refType pattern)
  objectId?: string;               // Reference to bonus, bet, game, transfer, etc. (ObjectId)
  objectModel?: string;            // Model type: 'bonus', 'bet', 'game', 'transfer', 'deposit', 'withdrawal', etc.
  
  // Transaction type
  charge: 'credit' | 'debit';      // Credit (money in) or Debit (money out)
  
  // Metadata (flexible - GENERIC only, no payment-specific fields)
  meta?: {
    // Fee details
    feeAmount?: number;             // Fee amount (cents)
    netAmount?: number;             // Net amount after fee (calculate: amount - feeAmount)
    
    // Currency (if different from wallet currency)
    currency?: string;              // Currency code
    exchangeRate?: number;          // Exchange rate used
    
    // Wallet context
    walletId?: string;              // Wallet ID (for fast lookups)
    balanceType?: 'real' | 'bonus' | 'locked';  // Which balance affected
    
    // External reference (for idempotency)
    externalRef?: string;           // External reference (for idempotency)
    
    // Any other generic data
    description?: string;
    [key: string]: unknown;
  };
  
  // NOTE: 
  // - Payment-specific details (cardLast4, cardBrand, bankName, etc.) are stored in Transfer.meta, not Transaction.meta
  // - Transfer reference: Use objectId + objectModel (if objectModel === 'transfer', then objectId is the transfer ID)
  
  // Timestamps (immutable - only createdAt)
  createdAt: Date;                 // Auto-managed by repository
  // NO updatedAt - transactions are immutable
}
```

### 1.2 Create Transfer Interface

**File**: `payment-service/src/types.ts`

```typescript
// Transfer schema (based on Mongoose pattern)
export interface Transfer {
  id: string;                      // Transfer ID
  tenantId: string;
  
  // User references (required)
  fromUserId: string;              // Source user (ObjectId reference)
  toUserId: string;                // Destination user (ObjectId reference)
  
  // Amount
  amount: number;                  // Transfer amount (cents) - ALWAYS POSITIVE
  
  // Status
  status: 'pending' | 'active' | 'approved' | 'canceled' | 'used' | 'expired';
  
  // Transaction type
  charge: 'credit' | 'debit';     // Usually 'credit' for transfers
  
  // Metadata (flexible)
  meta?: {
    // Payment details
    method?: string;                // Payment method
    externalRef?: string;           // External reference (for idempotency)
    externalTransactionId?: string;
    
    // Fee details
    feeAmount?: number;             // Fee amount (cents)
    netAmount?: number;             // Net amount after fee
    
    // Currency
    currency?: string;              // Currency code
    exchangeRate?: number;          // Exchange rate used
    
    // Transaction references (created by this transfer)
    fromTransactionId?: string;      // Debit transaction ID
    toTransactionId?: string;       // Credit transaction ID
    
    // Any other data
    description?: string;
    [key: string]: unknown;
  };
  
  // Timestamps
  createdAt: Date;                 // Auto-managed
  updatedAt?: Date;                 // Updated on status changes
}
```

### 1.2 Update Wallet Interface

**File**: `payment-service/src/types.ts`

```typescript
export interface Wallet {
  // ... existing fields ...
  
  // Ensure these are present (source of truth):
  balance: number;                 // Real balance (cents)
  bonusBalance: number;            // Bonus balance (cents)
  lockedBalance: number;           // Locked balance (cents)
  
  // Lifetime stats (for reporting)
  lifetimeDeposits: number;
  lifetimeWithdrawals: number;
  lifetimeFees: number;
  
  // Optional: Reference to ledger if needed for compliance
  metadata?: {
    ledgerAccountId?: string;      // Optional reference
    [key: string]: unknown;
  };
}
```

---

## Phase 2: Update Transaction Creation Logic

### 2.1 Update Deposit Saga (Create Transfer + Transactions)

**File**: `payment-service/src/services/transaction.ts`

```typescript
// In depositSaga, createTransferAndTransactions step:

{
  name: 'createTransferAndTransactions',
  execute: async ({ input, data, entity }: DepositCtx) => {
    const netAmount = input.amount - data.feeAmount; // Calculate net amount
    
    // Step 1: Create transfer document
    const transfer: Transfer = {
      id: `transfer-${entity.id}`,
      tenantId: input.tenantId,
      fromUserId: input.fromUserId || 'payment-gateway-user',
      toUserId: input.userId,
      amount: input.amount,
      status: 'approved',
      charge: 'credit',
      meta: {
        externalRef: data.externalRef,
        feeAmount: data.feeAmount,
        netAmount: netAmount,
        method: input.method || 'card',
        currency: input.currency,
        walletId: wallet.id,
        balanceType: 'real',
        description: `Deposit of ${input.amount / 100} ${input.currency}`,
      },
      createdAt: new Date(),
    };
    
    await transferRepo.create(transfer);
    
    // Step 2: Create debit transaction (fromUser)
    const debitTx: Transaction = {
      id: `tx-debit-${entity.id}`,
      tenantId: input.tenantId,
      userId: transfer.fromUserId,
      amount: input.amount,  // Gross amount
      balance: fromWallet.balance - input.amount,  // Balance after debit
      objectId: transfer.id,
      objectModel: 'transfer',
      charge: 'debit',
      meta: {
        transferId: transfer.id,
        feeAmount: data.feeAmount,
        currency: input.currency,
        externalRef: data.externalRef,
      },
      createdAt: new Date(),
    };
    
    await transactionRepo.create(debitTx);
    
    // Step 3: Create credit transaction (toUser)
    const creditTx: Transaction = {
      id: `tx-credit-${entity.id}`,
      tenantId: input.tenantId,
      userId: transfer.toUserId,
      amount: netAmount,  // Net amount (after fee)
      balance: wallet.balance + netAmount,  // Balance after credit
      objectId: transfer.id,
      objectModel: 'transfer',
      charge: 'credit',
      meta: {
        transferId: transfer.id,
        feeAmount: data.feeAmount,
        netAmount: netAmount,
        currency: input.currency,
        walletId: wallet.id,
        balanceType: 'real',
        externalRef: data.externalRef,
        method: input.method || 'card',
      },
      createdAt: new Date(),
    };
    
    await transactionRepo.create(creditTx);
    
    // Step 4: Update transfer with transaction IDs
    await transferRepo.update(transfer.id, {
      'meta.fromTransactionId': debitTx.id,
      'meta.toTransactionId': creditTx.id,
      updatedAt: new Date(),
    });
    
    // Step 5: Update wallets (atomic)
    await walletsCollection.updateOne(
      { id: fromWallet.id },
      { $inc: { balance: -input.amount } }
    );
    await walletsCollection.updateOne(
      { id: wallet.id },
      {
        $inc: {
          balance: netAmount,
          lifetimeDeposits: input.amount,
          lifetimeFees: data.feeAmount,
        },
        $set: { lastActivityAt: new Date() },
      }
    );
    
    return {
      ...ctx,
      input,
      data: { ...data, transfer, debitTx, creditTx },
      entity: creditTx, // Return credit transaction as primary
    };
  }
}
```

### 2.2 Remove Old Collection Writes

**File**: `payment-service/src/services/transaction.ts`

```typescript
// REMOVE these steps from depositSaga:
// - createWalletTransaction step (wallet_transactions collection)
// - createLedgerEntries step (ledger_entries collection)
// - createLedgerTransaction step (ledger_transactions collection)

// NEW: Only create:
// - 1 Transfer document
// - 2 Transaction documents (debit + credit)
// - 2 Wallet updates (fromUser + toUser)
```

### 2.3 Remove Ledger Service Dependencies

**File**: `payment-service/src/services/ledger-service.ts`

```typescript
// REMOVE or simplify ledger service functions:
// - recordDepositLedgerEntry (no longer creates separate entries)
// - createLedgerTransaction (transactions ARE the ledger)
// - syncWalletBalanceFromLedger (no sync needed)

// NEW: Transactions are the ledger
// Each transaction represents one ledger entry (credit or debit)
// Transfers create 2 transactions (double-entry bookkeeping)
```

---

## Phase 3: Update GraphQL Schema & Resolvers

### 3.1 Update Transaction GraphQL Type

**File**: `payment-service/src/services/transaction.ts`

```typescript
graphqlType: `
  type Transaction {
    id: ID!
    tenantId: String!
    userId: String!
    amount: Float!
    balance: Float!              # Balance after transaction
    objectId: String
    objectModel: String          # 'transfer', 'bonus', 'bet', 'game', etc.
    charge: String!              # 'credit' | 'debit'
    meta: JSON                   # Flexible metadata
    createdAt: String!
    
    # Calculated fields (resolvers)
    netAmount: Float             # amount - meta.feeAmount
    balanceBefore: Float         # balance - amount (credit) or balance + amount (debit)
  }
  
  type Transfer {
    id: ID!
    tenantId: String!
    fromUserId: String!
    toUserId: String!
    amount: Float!
    status: String!              # 'pending', 'active', 'approved', etc.
    charge: String!              # 'credit' | 'debit'
    meta: JSON
    createdAt: String!
    updatedAt: String
    
    # Relations
    fromTransaction: Transaction
    toTransaction: Transaction
  }
  
  # Helper: Calculate netAmount
  extend type Transaction {
    netAmount: Float             # Calculated: amount - (meta.feeAmount || 0)
    balanceBefore: Float         # Calculated based on charge type
  }
`
```

### 3.2 Update Resolvers

**File**: `payment-service/src/services/transaction.ts`

```typescript
resolvers: {
  Transaction: {
    // Calculate netAmount from meta
    netAmount: (parent: Transaction) => {
      const feeAmount = parent.meta?.feeAmount || 0;
      return parent.amount - feeAmount;
    },
    
    // Calculate balanceBefore
    balanceBefore: (parent: Transaction) => {
      if (parent.charge === 'credit') {
        return parent.balance - parent.amount;
      } else {
        return parent.balance + parent.amount;
      }
    },
  },
  
  Transfer: {
    // Get related transactions
    fromTransaction: async (parent: Transfer, _, ctx) => {
      if (!parent.meta?.fromTransactionId) return null;
      return transactionRepo.findById(parent.meta.fromTransactionId);
    },
    toTransaction: async (parent: Transfer, _, ctx) => {
      if (!parent.meta?.toTransactionId) return null;
      return transactionRepo.findById(parent.meta.toTransactionId);
    },
  },
  
  Query: {
    transactions: async (args, ctx) => {
      // Query transactions collection only
      return transactionRepo.find(args.filter || {});
    },
    
    transfers: async (args, ctx) => {
      // Query transfers collection
      return transferRepo.find(args.filter || {});
    },
    
    // Helper: Get transactions by wallet
    walletTransactions: async (args, ctx) => {
      return transactionRepo.find({
        'meta.walletId': args.walletId,
        ...args.filter,
      });
    },
  },
}
```

---

## Phase 4: Remove Sync Logic

### 4.1 Remove syncWalletBalanceFromLedger

**File**: `payment-service/src/services/ledger-service.ts`

```typescript
// REMOVE this function entirely
// Wallets are now source of truth
// No sync needed

// OLD:
// export async function syncWalletBalanceFromLedger(...) { ... }

// NEW: Direct wallet update (already atomic in saga)
```

### 4.2 Update Wallet Balance Updates

**File**: `payment-service/src/services/transaction.ts`

```typescript
// In depositSaga, creditWallet step:

// Update wallet balance directly (no sync needed)
await walletsCollection.updateOne(
  { id: wallet.id },
  {
    $inc: {
      balance: netAmount, // Direct update (atomic)
      lifetimeDeposits: input.amount,
      lifetimeFees: feeAmount,
    },
    $set: {
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    },
  }
);

// No need to call syncWalletBalanceFromLedger
// Wallet balance is source of truth
```

---

## Phase 5: Migration Script

### 5.1 Migrate Historical Data

**File**: `scripts/typescript/payment/migrate-to-simplified-schema.ts`

```typescript
/**
 * Migration: Consolidate collections into simplified schema
 * 
 * Steps:
 * 1. Add ledger.entries to existing transactions
 * 2. Add walletId and balanceType to transactions
 * 3. Merge wallet_transactions into transactions
 * 4. Validate data integrity
 */

import { MongoClient } from 'mongodb';

async function migrateTransactions() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('payment_service');
  
  const transactions = db.collection('transactions');
  const walletTransactions = db.collection('wallet_transactions');
  const ledgerTransactions = db.collection('ledger_transactions');
  const ledgerEntries = db.collection('ledger_entries');
  
  // Step 1: Add ledger entries to transactions
  console.log('Step 1: Adding ledger entries to transactions...');
  
  const allTransactions = await transactions.find({}).toArray();
  
  for (const tx of allTransactions) {
    const ledgerTx = await ledgerTransactions.findOne({
      externalRef: tx.metadata?.externalRef,
    });
    
    if (ledgerTx) {
      // Find ledger entries for this transaction
      const entries = await ledgerEntries.find({
        transactionId: ledgerTx._id,
      }).toArray();
      
      // Convert to simplified format (remove balanceBefore/balanceAfter)
      const simplifiedEntries = entries.map(entry => ({
        accountId: entry.accountId,
        type: entry.type,
        amount: entry.amount,
        // Remove: balanceBefore, balanceAfter
      }));
      
      // Update transaction with embedded ledger entries
      await transactions.updateOne(
        { id: tx.id },
        {
          $set: {
            ledger: {
              fromAccountId: ledgerTx.fromAccountId,
              toAccountId: ledgerTx.toAccountId,
              entries: simplifiedEntries,
            },
          },
        }
      );
    }
  }
  
  // Step 2: Merge wallet_transactions into transactions
  console.log('Step 2: Merging wallet_transactions into transactions...');
  
  const allWalletTxs = await walletTransactions.find({}).toArray();
  
  for (const walletTx of allWalletTxs) {
    // Find corresponding transaction
    const tx = await transactions.findOne({
      userId: walletTx.userId,
      type: walletTx.type,
      amount: walletTx.amount,
      createdAt: {
        $gte: new Date(walletTx.createdAt.getTime() - 1000),
        $lte: new Date(walletTx.createdAt.getTime() + 1000),
      },
    });
    
    if (tx) {
      // Merge wallet transaction data
      await transactions.updateOne(
        { id: tx.id },
        {
          $set: {
            walletId: walletTx.walletId,
            balanceType: walletTx.balanceType,
            refId: walletTx.refId,
            refType: walletTx.refType,
          },
        }
      );
    } else {
      // Orphaned wallet transaction - create new transaction
      await transactions.insertOne({
        id: walletTx.id,
        userId: walletTx.userId,
        tenantId: walletTx.tenantId,
        type: walletTx.type,
        status: 'completed',
        amount: walletTx.amount,
        currency: walletTx.currency,
        feeAmount: 0, // Unknown
        walletId: walletTx.walletId,
        balanceType: walletTx.balanceType,
        refId: walletTx.refId,
        refType: walletTx.refType,
        createdAt: walletTx.createdAt,
      });
    }
  }
  
  // Step 3: Remove calculated fields
  console.log('Step 3: Removing calculated fields...');
  
  await transactions.updateMany(
    {},
    {
      $unset: {
        netAmount: '', // Remove (calculate: amount - feeAmount)
        // Note: balanceBefore/balanceAfter not in transactions collection
      },
    }
  );
  
  console.log('Migration completed!');
  
  await client.close();
}
```

---

## Phase 6: Update Indexes

### 6.1 New Indexes for Transactions

```typescript
// Add to transaction service indexes:

indexes: [
  // Existing
  { fields: { userId: 1, createdAt: -1 } },
  { fields: { externalRef: 1 }, options: { unique: true } },
  
  // NEW: Wallet context queries
  { fields: { walletId: 1, createdAt: -1 } },
  { fields: { walletId: 1, balanceType: 1, createdAt: -1 } },
  
  // NEW: Generic references
  { fields: { refType: 1, refId: 1 } },
  
  // NEW: Ledger queries
  { fields: { 'ledger.entries.accountId': 1, createdAt: -1 } },
  
  // Status queries
  { fields: { status: 1, createdAt: -1 } },
  { fields: { userId: 1, type: 1, createdAt: -1 } },
]
```

### 6.2 Remove Old Indexes

```typescript
// After migration, drop indexes on:
// - wallet_transactions collection (will be removed)
// - ledger_entries collection (will be removed)
// - ledger_transactions collection (if removing)
```

---

## Phase 7: Testing Strategy

### 7.1 Unit Tests

```typescript
// Test transfer and transaction creation
test('deposit creates transfer and 2 transactions', async () => {
  const result = await createDeposit({ ... });
  
  // Verify transfer created
  expect(result.transfer).toBeDefined();
  expect(result.transfer.status).toBe('approved');
  expect(result.transfer.fromUserId).toBeDefined();
  expect(result.transfer.toUserId).toBeDefined();
  
  // Verify 2 transactions created (debit + credit)
  expect(result.debitTx).toBeDefined();
  expect(result.creditTx).toBeDefined();
  expect(result.debitTx.charge).toBe('debit');
  expect(result.creditTx.charge).toBe('credit');
  expect(result.debitTx.objectModel).toBe('transfer');
  expect(result.creditTx.objectModel).toBe('transfer');
  
  // Verify transaction references in transfer
  expect(result.transfer.meta.fromTransactionId).toBe(result.debitTx.id);
  expect(result.transfer.meta.toTransactionId).toBe(result.creditTx.id);
});

// Test netAmount calculation
test('netAmount is calculated correctly from meta', async () => {
  const tx = await getTransaction(txId);
  const feeAmount = tx.meta?.feeAmount || 0;
  expect(tx.netAmount).toBe(tx.amount - feeAmount);
});

// Test balance calculation
test('balanceBefore can be calculated', async () => {
  const tx = await getTransaction(txId);
  
  // For credit: balanceBefore = balance - amount
  // For debit: balanceBefore = balance + amount
  let balanceBefore: number;
  if (tx.charge === 'credit') {
    balanceBefore = tx.balance - tx.amount;
  } else {
    balanceBefore = tx.balance + tx.amount;
  }
  
  expect(balanceBefore).toBeGreaterThanOrEqual(0);
});
```

### 7.2 Integration Tests

```typescript
// Test full deposit flow
test('deposit flow creates transfer + 2 transactions + 2 wallet updates', async () => {
  // Create deposit
  const deposit = await createDeposit({ ... });
  
  // Verify 3 documents created (1 transfer + 2 transactions)
  const transferCount = await countDocuments('transfers', { id: deposit.transfer.id });
  const transactionCount = await countDocuments('transactions', {
    $or: [
      { id: deposit.debitTx.id },
      { id: deposit.creditTx.id }
    ]
  });
  
  expect(transferCount).toBe(1);
  expect(transactionCount).toBe(2);
  
  // Verify 2 wallets updated
  const walletUpdateCount = await countWalletUpdates([
    deposit.debitTx.userId,
    deposit.creditTx.userId
  ]);
  expect(walletUpdateCount).toBe(2);
  
  // Verify no old collections used
  const walletTxCount = await countDocuments('wallet_transactions', { 
    refId: deposit.id 
  });
  expect(walletTxCount).toBe(0);
  
  const ledgerEntriesCount = await countDocuments('ledger_entries', {
    transactionId: deposit.transfer.id
  });
  expect(ledgerEntriesCount).toBe(0); // Transactions are the ledger
});
```

---

## Phase 8: Rollout Plan

### ✅ Week 1: Preparation (COMPLETE)
- [x] Update type definitions
- [x] Refactor core services
- [x] Update GraphQL schemas
- [x] Code deduplication

### ⏳ Week 2: Test Updates (IN PROGRESS)
- [ ] Update all test scripts
- [ ] Verify payment flows
- [ ] Verify bonus flows
- [ ] Run full test suite

### ❌ Week 3-4: Migration (NOT NEEDED)
- ~~Create migration script~~ (Not needed - databases will be dropped)
- ~~Migrate historical data~~ (Not needed - databases will be dropped)
- ~~Remove old collections~~ (Will be dropped with databases)

### ⏳ Week 3: Database Drop & Fresh Start (PENDING)
- [ ] Drop existing databases
- [ ] Start fresh with new schema
- [ ] Verify new structure works correctly
- [ ] Run full test suite

### ⏳ Week 4: Index Optimization & Verification (PENDING)
- [ ] Verify all indexes are created correctly
- [ ] Monitor query performance
- [ ] Update documentation
- [ ] Final verification

---

## Expected Results

### Performance Improvements
- ✅ **50% reduction** in writes (6 → 3 documents)
- ✅ **75% reduction** in document size (~300 bytes vs ~1.2 KB)
- ✅ **75% reduction** in storage per transaction
- ✅ **Simpler queries** (ultra-minimal structure)
- ✅ **Easier reconciliation** (sum transactions = wallet balance)

### Code Simplification
- ✅ Remove `syncWalletBalanceFromLedger` function
- ✅ Remove `wallet_transactions` service
- ✅ Remove `ledger_entries` collection logic
- ✅ Remove `ledger_transactions` collection logic
- ✅ Simplify transaction creation saga (transfer + 2 transactions)
- ✅ Single source of truth (wallets)
- ✅ Polymorphic references (objectId + objectModel pattern)

### Code Quality Improvements
- ✅ **Session-aware pattern**: Both `createTransaction()` and `createTransferWithTransactions()` accept optional `session` parameter
  - Can be used standalone (manages session internally)
  - Can be used with external session (for multi-operation transactions)
  - Generic and reusable across all services (payment, bonus, egg, etc.)
- ✅ **Shared transaction helper**: `createTransactionDocument()` extracted to avoid duplication
  - Used by both `createTransaction()` and `createTransferWithTransactions()`
  - Creates transaction documents without wallet updates (wallet updates handled separately)
- ✅ **Removed duplicate code**:
  - Transaction-state code consolidated (imports from `transaction-state.ts`)
  - Transaction creation logic shared between helpers
  - Wallet helpers re-exported for consistency
- ✅ **Session management helpers**: `startSession()`, `endSession()` exported for generic use

---

## Risk Mitigation

### Data Loss Prevention
- ✅ Dual write period (old + new)
- ✅ Validation scripts
- ✅ Backup before migration
- ✅ Rollback plan

### Performance Monitoring
- ✅ Monitor write performance
- ✅ Monitor query performance
- ✅ Monitor storage growth
- ✅ Alert on anomalies

### Compliance
- ✅ Transactions are the ledger (audit trail preserved)
- ✅ Each transaction = one ledger entry (credit or debit)
- ✅ Transfers create double-entry (2 transactions)
- ✅ Can still query ledger data from transactions
- ✅ Immutable transactions (append-only)
