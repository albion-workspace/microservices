# Bonus Pool Refactoring - Use System User's BonusBalance

## ✅ Changes Completed

### Problem
Previously, the system used a separate `bonus-pool@system.com` user to hold bonus pool funds in their `real` balance. This required:
- Maintaining a separate user account
- Transferring from system (real) → bonus-pool (real) → user (bonus)
- More complex setup and management

### Solution
**Use system@demo.com user's `bonusBalance` as the bonus pool**

**Benefits**:
- ✅ Simpler architecture - no separate user needed
- ✅ Direct transfers: system (bonus) → user (bonus)
- ✅ System user already exists and has full permissions
- ✅ Cleaner balance tracking (bonus pool = system.bonusBalance)

### Files Updated

#### 1. `bonus-service/src/services/bonus.ts`
- ✅ Replaced `getBonusPoolUserId()` → `getSystemUserId()`
- ✅ Updated `checkBonusPoolBalance()` to check `system.bonusBalance` instead of `bonus-pool.balance`
- ✅ Updated `recordBonusAwardTransfer()` to use `system (bonus) → user (bonus)`
- ✅ Updated `recordBonusForfeitTransfer()` to use `user (bonus) → system (bonus)`
- ✅ Updated `getBonusPoolBalance()` to read from `system.bonusBalance`

#### 2. `payment-service/src/index.ts`
- ✅ Replaced `getBonusPoolUserId()` → `getSystemUserId()`
- ✅ Updated bonus award handler: `system (bonus) → user (bonus)`
- ✅ Updated bonus forfeit handler: `user (bonus) → system (bonus)`
- ✅ Updated bonus expired handler: `user (bonus) → system (bonus)`

#### 3. `scripts/typescript/bonus/bonus-command-test.ts`
- ✅ Removed bonus-pool user registration
- ✅ Updated funding logic to transfer `system (real) → system (bonus)`
- ✅ Updated recovery test to use system user
- ✅ Updated `ensureBonusPoolBalance()` helper

### Architecture Change

**Before**:
```
Bonus Pool Flow:
system (real) → bonus-pool (real) → user (bonus)
```

**After**:
```
Bonus Pool Flow:
system (real) → system (bonus) [bonus pool] → user (bonus)
```

### Funding the Bonus Pool

**Before**:
```typescript
// Create deposit to bonus-pool user
createDeposit({
  userId: bonusPoolUserId,
  fromUserId: systemUserId,
  // ... credits bonus-pool real balance
})
```

**After**:
```typescript
// Transfer from system (real) to system (bonus)
createTransferWithTransactions({
  fromUserId: systemUserId,
  toUserId: systemUserId,  // Same user, different balance types
  fromBalanceType: 'real',
  toBalanceType: 'bonus',
  // ... credits system bonusBalance (bonus pool)
})
```

### Testing

All services build successfully:
- ✅ bonus-service builds
- ✅ payment-service builds
- ✅ Tests updated to use new architecture

### Migration Notes

- **No database migration needed** - wallets already support `bonusBalance` field
- **Backward compatible** - old bonus-pool user can remain (unused)
- **Test scripts updated** - bonus tests now fund system user's bonusBalance

---

**Last Updated**: 2026-01-21
