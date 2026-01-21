# Auth Service Scripts

Unified scripts for testing and managing the auth service.

## Scripts

### `auth-command-test.ts` - Comprehensive Auth Test Suite
Unified test suite for all authentication functionality

```bash
# Run all auth tests
npm run auth:test
npx tsx scripts/typescript/auth/auth-command-test.ts all

# Run specific test suites
npx tsx scripts/typescript/auth/auth-command-test.ts registration  # Test registration flow
npx tsx scripts/typescript/auth/auth-command-test.ts login         # Test login flow
npx tsx scripts/typescript/auth/auth-command-test.ts password-reset # Test password reset
npx tsx scripts/typescript/auth/auth-command-test.ts otp           # Test OTP verification
npx tsx scripts/typescript/auth/auth-command-test.ts token         # Test token refresh
npx tsx scripts/typescript/auth/auth-command-test.ts 2fa           # Test 2FA flow

# Get pending OTPs from database (useful when SMTP/SMS providers are not configured)
npx tsx scripts/typescript/auth/auth-command-test.ts otps          # Get all pending OTPs
npx tsx scripts/typescript/auth/auth-command-test.ts otps --recipient user@example.com  # Filter by recipient
npx tsx scripts/typescript/auth/auth-command-test.ts otps --purpose registration  # Filter by purpose

# Setup test environment
npx tsx scripts/typescript/auth/auth-command-test.ts setup
```

**Test Coverage:**
- ✅ Registration (auto-verify and with verification)
- ✅ Login (multiple user types)
- ✅ Password reset flow
- ✅ OTP verification
- ✅ Token refresh
- ✅ 2FA setup
- ✅ OTP retrieval (for testing without SMTP/SMS providers)

### `manage-user.ts` - User Management (Generic)
Generic user management utility for roles, permissions, status, and verification

```bash
# Show user details
npx tsx scripts/typescript/auth/manage-user.ts system@demo.com show

# Promote to system with all permissions
npx tsx scripts/typescript/auth/manage-user.ts system@demo.com --all

# Set specific roles
npx tsx scripts/typescript/auth/manage-user.ts user@test.com --roles admin,system

# Update user status
npx tsx scripts/typescript/auth/manage-user.ts user@test.com status --status active

# Set specific permissions
npx tsx scripts/typescript/auth/manage-user.ts gateway@test.com --allow-negative --accept-fee

# Mark email as verified
npx tsx scripts/typescript/auth/manage-user.ts user@test.com --email-verified

# Update roles only
npx tsx scripts/typescript/auth/manage-user.ts user@test.com roles --roles provider

# Update permissions only
npx tsx scripts/typescript/auth/manage-user.ts user@test.com permissions --permissions allowNegative,acceptFee
```

**Commands:**
- `promote` (default) - Promote user with roles/permissions
- `status` - Update user status (pending, active, suspended, locked)
- `roles` - Update user roles
- `permissions` - Update user permissions
- `show` - Show user details

## Package.json Scripts

```json
"auth:test": "npx tsx typescript/auth/auth-command-test.ts all"
"auth:test:registration": "npx tsx typescript/auth/auth-command-test.ts registration"
"auth:test:login": "npx tsx typescript/auth/auth-command-test.ts login"
"auth:test:password-reset": "npx tsx typescript/auth/auth-command-test.ts password-reset"
"auth:test:otp": "npx tsx typescript/auth/auth-command-test.ts otp"
"auth:test:token": "npx tsx typescript/auth/auth-command-test.ts token"
"auth:test:2fa": "npx tsx typescript/auth/auth-command-test.ts 2fa"
"auth:manage": "npx tsx typescript/auth/manage-user.ts"
"promote-to-admin": "npx tsx typescript/auth/manage-user.ts"
```

## Migration Notes

The following scripts have been consolidated or removed:

### Removed Scripts
- `check-auth.ts` - Removed (not relevant for testing)
- `debug-auth.ts` - Removed (not relevant for testing)
- `check-2fa.js` - Removed (functionality integrated into test suite)
- `test-auth.ts` - Replaced by `auth-command-test.ts`
- `test-registration.ts` - Integrated into `auth-command-test.ts`
- `promote-user.ts` - Replaced by `manage-user.ts` (enhanced)

### Updated References
- `promote-to-admin` npm script now uses `manage-user.ts`
- All user management operations use `manage-user.ts`

## Benefits

✅ **Focused Testing**: Single comprehensive test suite for all auth functionality  
✅ **Generic User Management**: One tool for all user operations (roles, permissions, status)  
✅ **Reduced Duplication**: Shared utilities and consistent patterns  
✅ **Better Organization**: Clear separation between testing and management  
✅ **Easier Maintenance**: Update once, affects all operations
