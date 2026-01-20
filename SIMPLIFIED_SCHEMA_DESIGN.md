# Simplified Schema Design - Optimized for Performance & Simplicity

## Architecture Decision: **Wallets + Transactions + Transfers**

### Core Principle
- **Wallets** = Single source of truth for balances
- **Transactions** = Individual credit/debit records (one per user per transaction)
- **Transfers** = User-to-user transfer records (creates 2 transactions)
- **No separate ledger collections** = Transactions are the ledger
- **Use auth users** = No separate account collection needed

### Key Insight
- **Transaction** = Single entry (credit OR debit) for ONE user
- **Transfer** = Creates 2 transactions (debit for fromUser, credit for toUser)
- **Polymorphic references** = `objectId` + `objectModel` pattern (bonus, bet, game, transfer, etc.)

---

## Collection 1: **wallets**

### Purpose
- Single source of truth for user balances
- Replaces `ledger_accounts` collection
- Can reference auth users (no separate account collection)

### Schema
```typescript
interface Wallet {
  id: string;                    // Wallet ID
  userId: string;                // Reference to auth.users._id
  tenantId: string;
  currency: string;               // EUR, USD, etc.
  category?: string;              // Optional: 'main', 'sports', 'casino', etc.
  
  // Balances (source of truth)
  balance: number;               // Real balance (cents)
  bonusBalance: number;          // Bonus balance (cents)
  lockedBalance: number;         // Locked balance (cents)
  
  // Lifetime statistics (for reporting)
  lifetimeDeposits: number;      // Total deposits (cents)
  lifetimeWithdrawals: number;  // Total withdrawals (cents)
  lifetimeFees: number;          // Total fees paid (cents)
  
  // Status
  status: 'active' | 'frozen' | 'closed';
  isVerified: boolean;
  verificationLevel: 'none' | 'basic' | 'full';
  
  // Limits (from auth user permissions)
  allowNegative?: boolean;       // From user role/permissions
  creditLimit?: number;          // Max negative allowed
  
  // Activity tracking
  lastActivityAt: Date;
  lastWithdrawalReset: Date;
  lastMonthlyReset: Date;
  dailyWithdrawalUsed: number;
  monthlyWithdrawalUsed: number;
  
  // Metadata
  metadata?: {
    // Optional: Reference to ledger if needed for compliance
    ledgerAccountId?: string;
    [key: string]: unknown;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### Indexes
```javascript
// Core queries
{ userId: 1, currency: 1, category: 1 } // unique compound
{ userId: 1, currency: 1 }
{ tenantId: 1, userId: 1 }

// Status queries
{ status: 1, lastActivityAt: -1 }
```

### Benefits
- ✅ Single source of truth (no sync needed)
- ✅ Can reference auth.users (no duplicate account collection)
- ✅ All balance types in one place
- ✅ Lifetime stats for reporting

---

## Collection 2: **transactions**

### Purpose
- Single transaction record (credit or debit) per user
- Replaces: `transactions`, `wallet_transactions`, `ledger_transactions`, `ledger_entries`
- Ultra-minimal data storage (only essential fields)

### Schema (Simplified - Based on Your Mongoose Pattern)
```typescript
interface Transaction {
  id: string;                    // Transaction ID
  tenantId: string;
  
  // User reference (required)
  userId: string;                // Reference to auth.users._id (ObjectId)
  
  // Amounts (MINIMAL)
  amount: number;                 // Transaction amount (cents) - ALWAYS POSITIVE
  balance: number;               // Wallet balance AFTER this transaction (cents)
  // balanceBefore = balance - amount (for credit) or balance + amount (for debit)
  
  // Polymorphic reference (replaces refId/refType pattern)
  objectId?: string;              // Reference to bonus, bet, game, transfer, etc. (ObjectId)
  objectModel?: string;           // Model type: 'bonus', 'bet', 'game', 'transfer', 'deposit', 'withdrawal', etc.
  
  // Transaction type
  charge: 'credit' | 'debit';    // Credit (money in) or Debit (money out)
  
  // Metadata (flexible - store everything else here)
  meta?: {
    // Payment details (if payment transaction)
    method?: string;              // 'card', 'bank', 'crypto', etc.
    externalRef?: string;          // External reference (for idempotency)
    externalTransactionId?: string;
    
    // Transfer details (if transfer-related)
    transferId?: string;           // Reference to transfer document
    
    // Fee details
    feeAmount?: number;           // Fee amount (cents)
    netAmount?: number;           // Net amount after fee (calculate: amount - feeAmount)
    
    // Currency (if different from wallet currency)
    currency?: string;             // Currency code
    exchangeRate?: number;         // Exchange rate used
    
    // Wallet context
    walletId?: string;             // Wallet ID (for fast lookups)
    balanceType?: 'real' | 'bonus' | 'locked';  // Which balance affected
    
    // Any other data
    description?: string;
    [key: string]: unknown;
  };
  
  // Timestamps (immutable - only createdAt)
  createdAt: Date;                // Auto-managed by repository
  // NO updatedAt - transactions are immutable
}
```

### Key Simplifications

#### 1. **Ultra-Minimal Structure**
- Only 6 core fields: `userId`, `amount`, `balance`, `objectId`, `objectModel`, `charge`
- Everything else in `meta` (flexible, but GENERIC only)
- **Payment-specific details stored in Transfer.meta, not Transaction.meta**
- No separate fields for fees, payment details, etc.

#### 2. **Polymorphic Reference Pattern**
- `objectId` + `objectModel` replaces separate refId/refType
- Can reference ANY entity: bonus, bet, game, transfer, etc.
- Single index covers all references

#### 3. **Single Transaction Per User**
- Each transaction is ONE credit or debit for ONE user
- Transfers create 2 transactions (one per user)
- No embedded ledger entries (not needed)

#### 4. **Balance Tracking**
- `balance` = wallet balance AFTER transaction
- Can calculate `balanceBefore`:
  - Credit: `balanceBefore = balance - amount`
  - Debit: `balanceBefore = balance + amount`

#### 5. **Separation of Concerns**
- **Transaction** = Generic ledger entry (credit/debit only)
- **Transfer** = Generic transfer record (works with any payment method: card, bank, crypto, mobile money, etc.)
- Payment-specific details (cardLast4, cardBrand, bankName, walletAddress, phoneNumber, etc.) belong in Transfer.meta
- Transfer reference in Transaction: Use `objectId` + `objectModel` (if `objectModel === 'transfer'`, then `objectId` is the transfer ID)

---

## Collection 3: **transfers**

### Purpose
- User-to-user transfers (deposits, withdrawals, transfers)
- Creates 2 transactions (one credit, one debit)
- Tracks transfer status and metadata

### Schema (Based on Your Mongoose Pattern)
```typescript
interface Transfer {
  id: string;                    // Transfer ID
  tenantId: string;
  
  // User references (required)
  fromUserId: string;            // Source user (ObjectId reference)
  toUserId: string;              // Destination user (ObjectId reference)
  
  // Amount
  amount: number;                 // Transfer amount (cents) - ALWAYS POSITIVE
  
  // Status
  status: 'pending' | 'active' | 'approved' | 'canceled' | 'used' | 'expired';
  
  // Transaction type
  charge: 'credit' | 'debit';    // Usually 'credit' for transfers
  
  // Metadata (flexible - generic for any payment method)
  meta?: {
    // External reference (for idempotency)
    externalRef?: string;          // External reference (for idempotency)
    externalTransactionId?: string;
    
    // Payment method (determines which fields below are used)
    method?: string;              // Payment method: 'card', 'bank', 'crypto', 'mobile_money', etc.
    
    // Payment details (flexible - depends on payment method)
    // For cards:
    cardLast4?: string;           // Last 4 digits of card
    cardBrand?: string;            // Card brand: 'visa', 'mastercard', etc.
    
    // For bank transfers:
    bankName?: string;             // Bank name
    accountNumber?: string;       // Bank account number
    bankAccount?: string;         // Alias for accountNumber
    
    // For crypto:
    walletAddress?: string;       // Crypto wallet address
    blockchain?: string;          // Blockchain: 'bitcoin', 'ethereum', etc.
    
    // For mobile money:
    phoneNumber?: string;         // Mobile money phone number
    provider?: string;             // Mobile money provider: 'mpesa', 'mtn', etc.
    
    // Fee details
    feeAmount?: number;           // Fee amount (cents)
    netAmount?: number;           // Net amount after fee
    
    // Currency
    currency?: string;             // Currency code
    exchangeRate?: number;         // Exchange rate used
    
    // Transaction references (created by this transfer)
    fromTransactionId?: string;   // Debit transaction ID
    toTransactionId?: string;     // Credit transaction ID
    
    // Wallet context
    fromWalletId?: string;
    toWalletId?: string;
    balanceType?: 'real' | 'bonus' | 'locked';
    
    // Any other data
    description?: string;
    [key: string]: unknown;  // Flexible for any payment method-specific fields
  };
  
  // Timestamps
  createdAt: Date;                // Auto-managed
  updatedAt?: Date;                // Updated on status changes
}
```

### Transfer Flow

```typescript
// Create transfer
const transfer = {
  fromUserId: 'user-123',
  toUserId: 'user-456',
  amount: 10000,
  status: 'pending',
  charge: 'credit',
  meta: {
    externalRef: 'ext-789',
    feeAmount: 290,
    currency: 'EUR',
  }
};

// Creates 2 transactions:
// 1. Debit transaction for fromUserId
const debitTx = {
  userId: 'user-123',
  amount: 10000,
  balance: 40000,  // After debit
  objectId: transfer.id,
  objectModel: 'transfer',
  charge: 'debit',
  meta: { transferId: transfer.id, ... }
};

// 2. Credit transaction for toUserId
const creditTx = {
  userId: 'user-456',
  amount: 9710,  // amount - feeAmount
  balance: 50000,  // After credit
  objectId: transfer.id,
  objectModel: 'transfer',
  charge: 'credit',
  meta: { transferId: transfer.id, feeAmount: 290, ... }
};
```
```

### Key Optimizations

#### 1. **Removed Calculated Fields**
- ❌ `netAmount` → Calculate: `amount - feeAmount`
- ❌ `balanceBefore` → Calculate: 
  - For credit: `wallet.balance - amount`
  - For debit: `wallet.balance + amount`
- ❌ `balanceAfter` → Use current `wallet.balance`

#### 2. **Minimal Ledger Entries**
- Only store: `accountId`, `type`, `amount`
- No balance snapshots (can calculate from wallet)
- Account IDs use format: `user:userId:subtype` (e.g., `user:123:main`)

#### 3. **Embedded Data**
- Ledger entries embedded (no separate collection)
- Payment details embedded (no separate collection)
- All transaction data in one place

### Indexes
```javascript
// Core queries
{ userId: 1, createdAt: -1 }                    // User transaction history
{ userId: 1, charge: 1, createdAt: -1 }         // Filter by credit/debit
{ userId: 1, 'meta.balanceType': 1, createdAt: -1 } // Filter by balance type

// Polymorphic reference lookups (single index covers all!)
{ objectModel: 1, objectId: 1 }                 // Generic references (bonus, bet, game, transfer, etc.)

// External reference (for idempotency)
{ 'meta.externalRef': 1 }                        // unique - idempotency

// Wallet queries
{ 'meta.walletId': 1, createdAt: -1 }            // Wallet history

// TTL index (optional - auto-archive old transactions)
// { createdAt: 1 }, { expireAfterSeconds: 63072000 } // 2 years
```

### Transfer Indexes
```javascript
// Core queries
{ fromUserId: 1, createdAt: -1 }                // Outgoing transfers
{ toUserId: 1, createdAt: -1 }                  // Incoming transfers
{ status: 1, createdAt: -1 }                    // Status queries

// External reference (for idempotency)
{ 'meta.externalRef': 1 }                        // unique - idempotency

// Transaction references
{ 'meta.fromTransactionId': 1 }                  // Find transfer by transaction
{ 'meta.toTransactionId': 1 }
```

### Benefits
- ✅ **Ultra-minimal structure** (only 6 core fields)
- ✅ **Polymorphic references** (single pattern for all entity types)
- ✅ **Flexible metadata** (store anything in meta)
- ✅ **Immutable transactions** (only createdAt, no updatedAt)
- ✅ **Fast queries** (proper indexes)
- ✅ **Easy reconciliation** (sum transactions = wallet balance)

---

## Data Flow: Single Deposit (Optimized)

### Before (6 collections, 6 documents)
1. `transactions` → 1 doc
2. `ledger_transactions` → 1 doc
3. `ledger_entries` → 2 docs (debit + credit)
4. `ledger_accounts` → 2 updates
5. `wallet_transactions` → 1 doc
6. `wallets` → 1 update

### After (3 collections, 3 documents)
1. **`transfers`** → 1 doc (transfer record)
2. **`transactions`** → 2 docs (debit for fromUser, credit for toUser)
3. **`wallets`** → 2 updates (fromUser balance, toUser balance)

**Result: 50% reduction in writes (6 → 3 documents)!**

### Example: Deposit Flow

```typescript
// 1. Create transfer
const transfer = {
  fromUserId: 'payment-gateway-user',
  toUserId: 'end-user',
  amount: 10000,
  status: 'approved',
  charge: 'credit',
  meta: {
    externalRef: 'deposit-123',
    feeAmount: 290,
    netAmount: 9710,
    method: 'card',
    currency: 'EUR',
  }
};

// 2. Create debit transaction (fromUser)
const debitTx = {
  userId: 'payment-gateway-user',
  amount: 10000,
  balance: 90000,  // After debit
  objectId: transfer.id,
  objectModel: 'transfer',
  charge: 'debit',
  meta: {
    transferId: transfer.id,
    feeAmount: 290,
    currency: 'EUR',
  }
};

// 3. Create credit transaction (toUser)
const creditTx = {
  userId: 'end-user',
  amount: 9710,  // netAmount
  balance: 50000,  // After credit
  objectId: transfer.id,
  objectModel: 'transfer',
  charge: 'credit',
  meta: {
    transferId: transfer.id,
    feeAmount: 290,
    netAmount: 9710,
    currency: 'EUR',
    walletId: 'wallet-456',
    balanceType: 'real',
  }
};

// 4. Update wallets (atomic)
await wallets.updateOne(
  { userId: 'payment-gateway-user' },
  { $inc: { balance: -10000 } }
);
await wallets.updateOne(
  { userId: 'end-user' },
  { $inc: { balance: 9710, lifetimeDeposits: 10000, lifetimeFees: 290 } }
);
```

---

## Balance Calculation Examples

### Credit Transaction
```typescript
// Transaction stored
{
  userId: 'user-123',
  amount: 9710,         // Net amount (€97.10)
  balance: 50000,      // Wallet balance AFTER transaction (€500.00)
  charge: 'credit',
  objectModel: 'transfer',
  meta: {
    feeAmount: 290,     // Fee (€2.90)
    // Gross amount = 9710 + 290 = 10000 (€100.00)
  }
}

// Can calculate balanceBefore
balanceBefore = balance - amount
balanceBefore = 50000 - 9710 = 40290  // €402.90
```

### Debit Transaction
```typescript
// Transaction stored
{
  userId: 'user-123',
  amount: 4900,         // Net amount (€49.00)
  balance: 45000,      // Wallet balance AFTER transaction (€450.00)
  charge: 'debit',
  objectModel: 'transfer',
  meta: {
    feeAmount: 100,     // Fee (€1.00)
    // Gross amount = 4900 + 100 = 5000 (€50.00)
  }
}

// Can calculate balanceBefore
balanceBefore = balance + amount
balanceBefore = 45000 + 4900 = 49900  // €499.00
```

---

## Reconciliation Strategy

### Single Source Reconciliation
```typescript
// Reconcile wallet balance from transactions
async function reconcileWallet(userId: string, currency: string) {
  const wallet = await wallets.findOne({ userId, currency });
  
  // Sum all transactions for this user
  const transactions = await transactions.find({
    userId,
    'meta.currency': currency,  // Or filter by walletId if stored
  }).toArray();
  
  // Calculate expected balance
  // Start from 0 and apply each transaction
  let expectedBalance = 0;
  for (const tx of transactions) {
    if (tx.charge === 'credit') {
      expectedBalance += tx.amount;  // Amount is already net (after fee)
    } else if (tx.charge === 'debit') {
      expectedBalance -= tx.amount;  // Amount is already net (after fee)
    }
  }
  
  // Compare with wallet balance
  if (wallet.balance !== expectedBalance) {
    // Mismatch detected - log for investigation
    logger.warn('Balance mismatch detected', {
      userId,
      currency,
      walletBalance: wallet.balance,
      calculatedBalance: expectedBalance,
      difference: wallet.balance - expectedBalance,
      transactionCount: transactions.length,
    });
  }
  
  return {
    walletBalance: wallet.balance,
    calculatedBalance: expectedBalance,
    matches: wallet.balance === expectedBalance,
    transactionCount: transactions.length,
  };
}
```

**Benefits:**
- ✅ Single collection to query (`transactions`)
- ✅ Simple calculation (sum credits, subtract debits)
- ✅ Fast (indexed by userId)
- ✅ Easy to debug (can list all transactions)

---

## Migration Plan

### Phase 1: Add New Fields (Backward Compatible)
1. Add `ledger.entries` array to existing `transactions`
2. Add `walletId` and `balanceType` to `transactions`
3. Keep old collections working

### Phase 2: Dual Write
1. Write to both old and new structure
2. Validate data matches
3. Monitor performance

### Phase 3: Migrate Historical Data
```typescript
// Migrate ledger_entries → transactions.ledger.entries
// Migrate wallet_transactions → merge into transactions
// Migrate ledger_accounts → use wallets (or remove if not needed)
```

### Phase 4: Switch Reads
1. Update GraphQL resolvers to use new structure
2. Update frontend queries
3. Remove old collection writes

### Phase 5: Cleanup
1. Remove old collections
2. Remove sync logic (`syncWalletBalanceFromLedger`)
3. Remove duplicate indexes

---

## Performance Estimates

### Document Size Comparison

#### Current Transaction Document
```json
{
  "id": "tx-123",
  "userId": "user-456",
  "type": "deposit",
  "status": "completed",
  "method": "card",
  "amount": 10000,
  "currency": "EUR",
  "feeAmount": 290,
  "feeCurrency": "EUR",
  "netAmount": 9710,           // ❌ Redundant
  "fromUserId": "gateway",
  "toUserId": "user-456",
  "externalRef": "ext-789",
  "metadata": { ... },
  "statusHistory": [ ... ],
  // ... many other fields
}
```
**Size: ~1.2 KB**

#### Optimized Transaction Document
```json
{
  "id": "tx-123",
  "userId": "user-456",
  "amount": 9710,              // Net amount (already calculated)
  "balance": 50000,             // Balance after transaction
  "objectId": "transfer-789",
  "objectModel": "transfer",
  "charge": "credit",
  "meta": {
    "feeAmount": 290,
    "netAmount": 9710,
    "currency": "EUR",
    "walletId": "wallet-456",
    "balanceType": "real",
    "externalRef": "ext-789"
  },
  // Transfer reference: objectId = "transfer-789", objectModel = "transfer"
  "createdAt": "2026-01-20T10:00:00Z"
}
```
**Size: ~300 bytes (75% reduction!)**

#### Transfer Document (Payment Details)
```json
{
  "id": "transfer-789",
  "fromUserId": "user-123",
  "toUserId": "user-456",
  "amount": 10000,
  "status": "approved",
  "charge": "credit",
  "meta": {
    "externalRef": "ext-789",
    "feeAmount": 290,
    "netAmount": 9710,
    "currency": "EUR",
    "method": "card",
    "cardLast4": "4242",
    "cardBrand": "visa",
    "description": "Deposit from user-123"
  },
  "createdAt": "2026-01-20T10:00:00Z",
  "updatedAt": "2026-01-20T10:00:01Z"
}
```
**Note:**
- Payment-specific details (cardLast4, cardBrand, etc.) are in Transfer.meta, not Transaction.meta
- Transfer reference in Transaction: Use `objectId` + `objectModel` (no need for separate `transferId` field)
- Transfer is generic and works with any payment method (card, bank, crypto, mobile money, etc.)

### Write Performance

#### Current (6 collections)
- 6 documents per deposit
- ~7.2 KB total writes
- 6 index updates

#### Optimized (3 collections)
- 3 documents per deposit (1 transfer + 2 transactions)
- ~1.5 KB total writes
- 3 index updates

**Improvement: 79% reduction in writes, 50% reduction in index updates**

---

## Implementation Checklist

### Schema Changes
- [ ] Update `Transaction` interface (ultra-minimal: userId, amount, balance, objectId, objectModel, charge, meta)
- [ ] Create `Transfer` interface (fromUserId, toUserId, amount, status, charge, meta)
- [ ] Remove calculated fields (netAmount, balanceBefore, balanceAfter)
- [ ] Update `Wallet` interface (ensure it's source of truth)

### Write Path Changes
- [ ] Create `Transfer` document for user-to-user operations
- [ ] Create 2 `Transaction` documents (debit + credit) per transfer
- [ ] Update wallet balances atomically
- [ ] Remove `wallet_transactions` creation
- [ ] Remove `ledger_entries` creation
- [ ] Remove `ledger_transactions` creation
- [ ] Use polymorphic reference pattern (objectId + objectModel)

### Read Path Changes
- [ ] Update GraphQL resolvers to use new structure
- [ ] Update balance calculation (remove balanceBefore/After)
- [ ] Update transaction history queries
- [ ] Update reconciliation queries

### Migration
- [ ] Create migration script for historical data
- [ ] Test migration on sample data
- [ ] Run migration in production
- [ ] Validate data integrity

### Cleanup
- [ ] Remove `wallet_transactions` collection
- [ ] Remove `ledger_entries` collection
- [ ] Remove `ledger_transactions` collection (or keep for compliance)
- [ ] Remove `ledger_accounts` collection (or keep if needed)
- [ ] Remove `syncWalletBalanceFromLedger` function

---

## Key Design Decisions

### 1. **Ultra-Minimal Transaction Structure**
- Only 6 core fields: `userId`, `amount`, `balance`, `objectId`, `objectModel`, `charge`
- Everything else in flexible `meta` object
- Based on proven Mongoose pattern (polymorphic references)

### 2. **Separate Transfer Collection**
- Transfers represent user-to-user operations
- Creates 2 transactions (double-entry bookkeeping)
- Tracks transfer status separately from transactions

### 3. **Polymorphic References**
- `objectId` + `objectModel` pattern replaces separate refId/refType
- Single index covers all entity types (bonus, bet, game, transfer, etc.)
- More flexible and extensible

### 4. **Immutable Transactions**
- Only `createdAt` timestamp (no `updatedAt`)
- Transactions are append-only (audit trail)
- Balance is snapshot at transaction time

### 5. **No Separate Ledger Collections**
- Transactions ARE the ledger
- Each transaction = one ledger entry (credit OR debit)
- Transfers = double-entry (2 transactions)

## Questions to Resolve

1. **Keep `ledger_accounts` for compliance?**
   - Option A: Remove entirely (use wallets only)
   - Option B: Keep as read-only reference (no writes)

2. **Keep `ledger_transactions` for audit?**
   - Option A: Remove (transactions are the ledger)
   - Option B: Keep as read-only archive

3. **TTL/Partitioning:**
   - Enable TTL index on transactions?
   - Partition by year/month?
   - Archive strategy?

---

## Next Steps

1. **Review and approve schema design**
2. **Create TypeScript interfaces**
3. **Update transaction creation logic**
4. **Update GraphQL schema**
5. **Create migration scripts**
6. **Test with sample data**
7. **Gradual rollout**
