# Role-Based System User Architecture

## ✅ Implementation Complete

Both **bonus-service** and **payment-service** now use a **generic role-based approach** to find system users, instead of hardcoding email addresses.

## Architecture

### Core Utility (`core-service/src/common/user-utils.ts`)

**Generic role-based user lookup**:
```typescript
findUserIdByRole({
  role: 'system',
  tenantId?: string,
  throwIfNotFound?: boolean
})
```

**Benefits**:
- ✅ **Flexible**: Supports multiple system users per tenant
- ✅ **Role-based**: Uses RBAC instead of hardcoded emails
- ✅ **Multi-tenant**: Optional tenant filtering
- ✅ **Future-proof**: Easy to add different system actors (e.g., `payment-provider`, `bonus-admin`)

### Bonus Service (`bonus-service/src/services/bonus.ts`)

**Uses role-based lookup**:
```typescript
async function getSystemUserId(tenantId?: string): Promise<string> {
  const { findUserIdByRole } = await import('core-service');
  
  const systemUserId = await findUserIdByRole({
    role: 'system',
    tenantId,
    throwIfNotFound: true,
  });
  
  return systemUserId;
}
```

**All functions pass tenantId**:
- ✅ `checkBonusPoolBalance(amount, currency, tenantId?)`
- ✅ `recordBonusAwardTransfer(..., tenantId, ...)`
- ✅ `recordBonusForfeitTransfer(..., tenantId, ...)`
- ✅ `getBonusPoolBalance(currency, tenantId?)`

### Payment Service (`payment-service/src/index.ts`)

**Uses same role-based lookup**:
```typescript
async function getSystemUserId(tenantId?: string): Promise<string> {
  const { findUserIdByRole } = await import('core-service');
  
  const systemUserId = await findUserIdByRole({
    role: 'system',
    tenantId,
    throwIfNotFound: true,
  });
  
  return systemUserId;
}
```

**All event handlers pass tenantId**:
- ✅ `on('bonus.awarded')` → `getSystemUserId(event.tenantId)`
- ✅ `on('bonus.forfeited')` → `getSystemUserId(event.tenantId)`
- ✅ `on('bonus.expired')` → `getSystemUserId(event.tenantId)`

## Single Source of Truth

**Both services use the same utility from `core-service`**:
- ✅ Same function: `findUserIdByRole`
- ✅ Same role: `'system'`
- ✅ Same tenantId handling
- ✅ Same error handling

## Future Flexibility

**Easy to extend for different actors**:
```typescript
// Find payment provider user
const providerUserId = await findUserIdByRole({
  role: 'payment-provider',
  tenantId: 'tenant-123'
});

// Find bonus admin user
const bonusAdminUserId = await findUserIdByRole({
  role: 'bonus-admin',
  tenantId: 'tenant-123'
});
```

## Multi-Tenant Support

**Tenant-aware system user lookup**:
- If `tenantId` is provided → finds system user for that tenant
- If `tenantId` is omitted → finds first system user (global fallback)
- Supports tenant-specific system users

## Migration Notes

**No breaking changes**:
- Old hardcoded `system@demo.com` approach removed
- All calls now use role-based lookup
- Backward compatible (finds same user if role matches)

---

**Last Updated**: 2026-01-21
