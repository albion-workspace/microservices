# Authentication Service Improvements

## Issues Fixed

### 1. ✅ Password Hashing (CRITICAL SECURITY FIX)
**Problem**: Passwords were stored in plain text. Passport.js does NOT automatically hash passwords.

**Solution**:
- Added `bcrypt` package for password hashing
- Created `hashPassword()` and `verifyPassword()` utilities in `utils.ts`
- Updated all password storage points:
  - Registration: `registration.ts` - hash password before storing
  - Password reset: `password.ts` - hash new password before storing
  - Password change: `password.ts` - hash new password and verify current password using bcrypt
  - Login: `passport-strategies.ts` - verify password using bcrypt instead of plain text comparison

**Files Changed**:
- `auth-service/package.json` - added bcrypt dependency
- `auth-service/src/utils.ts` - added password hashing functions
- `auth-service/src/providers/passport-strategies.ts` - fixed password verification
- `auth-service/src/services/registration.ts` - hash password on registration
- `auth-service/src/services/password.ts` - hash passwords on reset/change

---

### 2. 🔄 JWT-Based Registration Flow (Resource Optimization)
**Problem**: Unverified users are saved to DB immediately, consuming resources and allowing spam registrations.

**Proposed Solution**:
- Store unverified registration data in a JWT token (expires in 24 hours)
- Only save to DB after email/phone verification
- If JWT expires, user can re-register
- Reduces DB load and prevents spam registrations

**Implementation Plan**:
1. ✅ Create `createRegistrationToken()` function that stores registration data in JWT
2. ✅ Modify `register()` to return JWT token instead of saving to DB (if verification required)
3. ✅ Create `verifyRegistration()` endpoint that:
   - Validates OTP code
   - Decodes JWT to get registration data
   - Creates user in DB only after successful verification
4. ✅ JWT expires automatically (24 hours) - no cleanup job needed

**Files Changed**:
- `auth-service/src/utils.ts` - added `createRegistrationToken()` and `verifyRegistrationToken()`
- `auth-service/src/services/registration.ts` - modified `register()` and added `verifyRegistration()`
- `auth-service/src/types.ts` - added `VerifyRegistrationInput` and `registrationToken` to `AuthResponse`
- `auth-service/src/graphql.ts` - added `verifyRegistration` mutation and updated `AuthResponse` type
- `auth-service/package.json` - added `jsonwebtoken` dependency

**Benefits**:
- No DB records for unverified users
- Automatic expiration (24 hours)
- Can re-register if token expires
- Reduces spam registrations

---

### 3. ✅ User Status & Role Management (Security Enhancement)
**Problem**: Users created after registration verification could immediately perform operations without proper activation.

**Solution**:
- Users created after registration verification start with `status: 'pending'`
- Default role `'user'` is automatically assigned
- Users cannot perform operations until status is `'active'`
- On first successful login, pending users are automatically activated (`status: 'pending'` → `'active'`)

**Files Changed**:
- `auth-service/src/services/registration.ts` - Set status to 'pending' after verification
- `auth-service/src/services/authentication.ts` - Auto-activate pending users on first login
- `auth-service/src/providers/passport-strategies.ts` - Allow 'pending' users to login (they'll be activated)

**Benefits**:
- Users cannot perform operations until they log in at least once
- Ensures proper account activation flow
- Default role assignment ensures proper permissions

---

### 4. 🔄 Session Management Improvements
**Problem**: Repetitive logins, ID mismatches in React app.

**Current Architecture**: Sessionless (JWT tokens in localStorage)

**Best Practices for Sessionless Auth**:
1. ✅ **Use JWT tokens** (already implemented)
2. ✅ **Store tokens securely** (localStorage is acceptable for web apps)
3. ✅ **Implement token refresh** (already implemented)
4. ⚠️ **Fix ID consistency** - ensure user.id always matches MongoDB _id.toString()
5. ⚠️ **Prevent repetitive logins** - improve token refresh logic

**Fixes Needed**:
- Ensure consistent user ID format across all auth flows
- Improve token refresh logic to prevent unnecessary re-authentication
- Add better error handling for expired tokens
- Fix ID mismatches in React app (ensure user.id matches _id.toString())

---

## Implementation Status

- [x] Password hashing with bcrypt
- [x] JWT-based registration flow
- [x] User status & role management (pending → active on first login)
- [ ] Session management improvements
- [ ] React app ID consistency fixes

---

## Next Steps

1. **Install bcrypt**: Run `npm install` in `auth-service` directory
2. **Test password hashing**: Verify passwords are hashed on registration/reset
3. **Implement JWT registration**: Create registration token flow
4. **Fix React app**: Ensure consistent user IDs
5. **Test end-to-end**: Verify all auth flows work correctly

---

## Migration Notes

**For Existing Users**:
- Existing plain text passwords will need to be migrated
- On next login, verify password and re-hash it
- Or force password reset for all users

**For New Registrations**:
- Passwords will be automatically hashed
- Unverified registrations will use JWT tokens (after implementation)
