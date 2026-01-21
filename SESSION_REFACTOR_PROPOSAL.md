# Session & Refresh Token Refactoring Proposal

## Current Issues

### 1. Redundant Collections
Currently, we maintain **two separate collections**:
- `refresh_tokens` - Stores refresh token data
- `sessions` - Stores session data with reference to refresh token

**Problems:**
- Both collections store overlapping data (`userId`, `tenantId`, `deviceInfo`, expiration, validity)
- Sessions only reference refresh tokens via `refreshTokenId` - creating unnecessary joins
- Two database writes on every login
- Two collections to maintain, query, and clean up

### 2. Excessive Refresh Token Creation
**Current behavior:**
- Every login creates a **new** refresh token, even if user already has valid ones
- No limit on number of refresh tokens per user
- No cleanup of expired/invalid tokens (only marked as invalid, never deleted)
- No device-based token reuse

**Impact:**
- Database bloat with thousands of invalid/expired tokens
- Slower queries as collection grows
- Unnecessary storage costs

## Proposed Solution

### 1. Unified Collection: `sessions`

**Merge both collections into a single `sessions` collection** that contains:
- Refresh token data (token, tokenHash)
- Session metadata (deviceInfo, ipAddress, userAgent)
- Lifecycle tracking (createdAt, expiresAt, lastAccessedAt, lastUsedAt)
- Security flags (isValid, revokedAt, revokedReason)

**Benefits:**
- Single source of truth
- One database write per login
- Simpler queries (no joins needed)
- Easier cleanup and maintenance

### 2. Smart Token Reuse

**Reuse existing valid refresh tokens** for the same device:
- On login, check if user has a valid refresh token for the same `deviceId`
- If found and not expired, reuse it (update `lastAccessedAt`)
- Only create new token if:
  - No valid token exists for this device
  - Existing token is expired
  - User explicitly requests new session

**Benefits:**
- Fewer tokens in database
- Better user experience (fewer re-authentications)
- Reduced storage

### 3. Automatic Cleanup

**Add periodic cleanup** for expired/invalid sessions:
- Delete expired sessions (older than expiration date)
- Delete invalid sessions older than 30 days
- Limit active sessions per user (e.g., max 10 devices)

**Benefits:**
- Prevents database bloat
- Maintains performance
- Automatic maintenance

## Implementation Plan

### Phase 1: Unified Collection Structure
1. Create new unified `Session` interface combining both types
2. Update `createSessionAndTokens` to write to single collection
3. Update all queries to use unified collection
4. Add migration script to merge existing data

### Phase 2: Smart Token Reuse
1. Add `findExistingSession` method to check for valid device sessions
2. Update login flow to reuse existing tokens when possible
3. Add `deviceId` matching logic

### Phase 3: Cleanup & Limits
1. Add `cleanupExpiredSessions` method
2. Add periodic cleanup job (daily)
3. Add max sessions per user limit (configurable)
4. Add cleanup of old invalid sessions

### Phase 4: Migration & Testing
1. Create migration script to merge collections
2. Update all GraphQL resolvers
3. Update logout/logoutAll methods
4. Comprehensive testing

## New Session Schema

```typescript
interface Session {
  _id: ObjectId;
  id: string; // MongoDB _id as string
  
  // User & Tenant
  userId: string;
  tenantId: string;
  
  // Refresh Token (embedded, not separate collection)
  token: string; // Plain token (only stored temporarily during creation)
  tokenHash: string; // Hashed token for lookups
  refreshTokenExpiresAt: Date; // Refresh token expiration (e.g., 7 days)
  
  // Device & Session Info
  deviceId: string;
  deviceInfo: DeviceInfo;
  ipAddress?: string;
  userAgent?: string;
  
  // Lifecycle
  createdAt: Date;
  lastAccessedAt: Date; // Updated on each access
  lastUsedAt?: Date; // Updated when refresh token is used
  sessionExpiresAt: Date; // Session expiration (e.g., 30 days)
  
  // Security
  isValid: boolean;
  revokedAt?: Date;
  revokedReason?: string; // 'logout', 'logout_all', 'expired', 'password_reset', etc.
}
```

## Migration Strategy

1. **Backward Compatible Migration:**
   - Keep both collections during transition
   - Write to both collections initially
   - Read from unified collection
   - Migrate existing data in background

2. **Data Migration Script:**
   - For each `refresh_token`: Create session with token data
   - Link existing `sessions` to refresh tokens
   - Merge duplicate data

3. **Cleanup:**
   - After migration verified, remove old collections
   - Update all code references

## Benefits Summary

✅ **Reduced Storage:** ~50% reduction (single collection vs two)
✅ **Better Performance:** Fewer writes, simpler queries, smaller indexes
✅ **Cleaner Code:** Single source of truth, less complexity
✅ **Automatic Maintenance:** Cleanup prevents bloat
✅ **Better UX:** Token reuse means fewer re-authentications
