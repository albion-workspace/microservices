# Auth Service Scripts

Unified scripts for checking, testing, and debugging the auth service.

## Unified Scripts

### `check-auth.ts` - Check Operations
Performs various checks on auth service data (users, sessions, passwords, etc.)

```bash
# Check system user
npx tsx scripts/typescript/auth/check-auth.ts system

# Check system with password verification
npx tsx scripts/typescript/auth/check-auth.ts system --password

# Check for duplicate system users
npx tsx scripts/typescript/auth/check-auth.ts system --duplicates

# Check specific user
npx tsx scripts/typescript/auth/check-auth.ts user system@demo.com

# List all users grouped by role
npx tsx scripts/typescript/auth/check-auth.ts users

# Check sessions
npx tsx scripts/typescript/auth/check-auth.ts sessions

# Check password
npx tsx scripts/typescript/auth/check-auth.ts password system@demo.com System123!@#

# Check user document structure
npx tsx scripts/typescript/auth/check-auth.ts document system@demo.com
```

### `test-auth.ts` - Test Operations
Tests authentication flow, Passport lookup, token decoding, and permissions

```bash
# Test login flow
npx tsx scripts/typescript/auth/test-auth.ts login

# Decode token
npx tsx scripts/typescript/auth/test-auth.ts token

# Test Passport lookup
npx tsx scripts/typescript/auth/test-auth.ts passport system@demo.com

# Test permission check
npx tsx scripts/typescript/auth/test-auth.ts permission

# Trace complete login flow
npx tsx scripts/typescript/auth/test-auth.ts trace
```

### `debug-auth.ts` - Debug Operations
Debugging tools for auth issues (wrong users, duplicates, ID mismatches)

```bash
# Check for wrong user ID
npx tsx scripts/typescript/auth/debug-auth.ts wrong-user

# Find duplicate users
npx tsx scripts/typescript/auth/debug-auth.ts duplicates system@demo.com

# Fix duplicate admins
npx tsx scripts/typescript/auth/debug-auth.ts fix-duplicates

# Find user by email
npx tsx scripts/typescript/auth/debug-auth.ts find-user system@demo.com

# Check for ID mismatches
npx tsx scripts/typescript/auth/debug-auth.ts id-mismatch
```

### `promote-user.ts` - User Management
Promote users and manage roles/permissions

```bash
# Promote to system with all permissions
npx tsx scripts/typescript/auth/promote-user.ts system@demo.com --all

# Set specific roles
npx tsx scripts/typescript/auth/promote-user.ts user@test.com --roles system

# Set specific permissions
npx tsx scripts/typescript/auth/promote-user.ts gateway@test.com --allow-negative --accept-fee
```

## Legacy Scripts (Deprecated)

The following scripts have been consolidated into the unified scripts above:

### Check Scripts → `check-auth.ts`
- `check-admin-user.ts` → `check-auth.ts admin`
- `check-admin-password.ts` → `check-auth.ts admin --password`
- `check-admin-duplicates.ts` → `check-auth.ts admin --duplicates`
- `check-all-admin-users.ts` → `check-auth.ts admin --all`
- `check-user-document.ts` → `check-auth.ts document <email>`
- `check-user-now.ts` → `check-auth.ts user <email>`
- `check-users.ts` → `check-auth.ts users`
- `check-login-user.ts` → `check-auth.ts user system@demo.com`
- `check-password-match.ts` → `check-auth.ts password <email> [password]`
- `check-sessions.ts` → `check-auth.ts sessions [userId]`

### Test Scripts → `test-auth.ts`
- `test-login-trace.ts` → `test-auth.ts trace`
- `test-passport-lookup.ts` → `test-auth.ts passport`
- `test-passport-direct.ts` → `test-auth.ts passport`
- `test-permission-check.ts` → `test-auth.ts permission`
- `decode-token.ts` → `test-auth.ts token`

### Debug Scripts → `debug-auth.ts`
- `check-wrong-user.ts` → `debug-auth.ts wrong-user`
- `check-wrong-user-id.ts` → `debug-auth.ts wrong-user`
- `check-wrong-id-exists.ts` → `debug-auth.ts wrong-user`
- `find-wrong-user.ts` → `debug-auth.ts find-user <email>`
- `fix-duplicate-admin.ts` → `debug-auth.ts fix-duplicates`

### Utility Scripts (Keep)
- `promote-user.ts` - User promotion utility (keep as-is)
- `get-admin-user-id.ts` - Simple utility (can be replaced with `check-auth.ts admin`)
- `check-2fa.js` - 2FA check utility (keep as-is)
- `check-mongodb-transactions.js` - MongoDB transaction check (keep as-is)

## Migration Guide

### Before
```bash
npx tsx scripts/typescript/auth/check-admin-user.ts
npx tsx scripts/typescript/auth/check-admin-password.ts
npx tsx scripts/typescript/auth/test-login-trace.ts
npx tsx scripts/typescript/auth/decode-token.ts
```

### After
```bash
npx tsx scripts/typescript/auth/check-auth.ts admin
npx tsx scripts/typescript/auth/check-auth.ts admin --password
npx tsx scripts/typescript/auth/test-auth.ts trace
npx tsx scripts/typescript/auth/test-auth.ts token
```

## Benefits

✅ **Reduced Duplication**: Single script with shared MongoDB connection logic  
✅ **Consistent Interface**: All scripts follow same argument pattern  
✅ **Better Organization**: Related operations grouped together  
✅ **Easier Maintenance**: Update once, affects all operations  
✅ **Better Documentation**: Single source of truth for each operation type
