# Token Refresh Fix - Analysis & Implementation

## Problem Analysis

The React app was requiring users to login again because:

1. **No Automatic Token Refresh**: When GraphQL requests failed with 401 errors, the app didn't automatically refresh tokens
2. **No Proactive Refresh**: Tokens weren't refreshed before expiration
3. **No Expiration Tracking**: The app didn't track when tokens expire
4. **No Retry Logic**: Failed requests weren't retried after token refresh

## Root Causes

### Backend (`auth-service`)
- ✅ Refresh token mutation works correctly
- ✅ Returns new access token and same refresh token
- ⚠️ **Issue**: Refresh token mutation doesn't return `user` in response (only returns tokens)

### Frontend (`app/src/lib`)
- ❌ `graphql-utils.ts` doesn't handle 401 errors or refresh tokens
- ❌ `auth-context.tsx` doesn't proactively refresh tokens before expiration
- ❌ No token expiration tracking
- ❌ No integration between `graphql-utils.ts` and `auth-context.tsx` for automatic refresh

## Implemented Solutions

### 1. Automatic Token Refresh Interceptor (`app/src/lib/graphql-utils.ts`)

**Added:**
- `setTokenRefreshCallback()` function to register token refresh callback
- Automatic 401 error detection (both HTTP 401 and GraphQL auth errors)
- Automatic retry logic after token refresh
- Error detection for authentication-related GraphQL errors

**How it works:**
1. When a request fails with 401 or auth error, it calls the registered refresh callback
2. If refresh succeeds, it retries the original request with the new token
3. If refresh fails, it throws the original error

### 2. Proactive Token Refresh (`app/src/lib/auth-context.tsx`)

**Added:**
- Token expiration tracking in localStorage (`auth_token_expires_at`)
- `useEffect` hook that monitors token expiration
- Automatic refresh 5 minutes before expiration
- Scheduled refresh using `setTimeout`

**How it works:**
1. When tokens are saved, expiration time is calculated and stored
2. A `useEffect` hook checks expiration time
3. If token expires in < 5 minutes, it refreshes immediately
4. Otherwise, it schedules a refresh 5 minutes before expiration

### 3. Token Refresh Callback (`app/src/lib/auth-context.tsx`)

**Added:**
- `getRefreshedToken()` callback function
- Registers callback with `graphql-utils.ts` on mount
- Handles token refresh and state updates
- Returns new access token or null

**How it works:**
1. Called automatically by `graphql-utils.ts` when 401 error detected
2. Refreshes token using refresh token from state/localStorage
3. Updates state and localStorage with new tokens
4. Returns new access token for retry

### 4. Token Expiration Storage

**Added:**
- Stores `auth_token_expires_at` in localStorage when tokens are saved
- Calculates expiration: `Date.now() + (expiresIn * 1000)`
- Used by proactive refresh mechanism

## Changes Made

### `app/src/lib/graphql-utils.ts`
- ✅ Added `setTokenRefreshCallback()` function
- ✅ Added automatic 401 error detection and retry logic
- ✅ Added GraphQL auth error detection
- ✅ Integrated with auth context for automatic refresh

### `app/src/lib/auth-context.tsx`
- ✅ Added token expiration tracking (`auth_token_expires_at`)
- ✅ Added proactive token refresh mechanism
- ✅ Added `getRefreshedToken()` callback for graphql-utils
- ✅ Registered callback with graphql-utils on mount
- ✅ Updated `saveAuth()` to store expiration time
- ✅ Updated `clearAuth()` to remove expiration time

## Flow Diagram

```
User makes GraphQL request
    ↓
graphql-utils.ts executes request
    ↓
Request fails with 401/auth error?
    ↓ YES
Call getRefreshedToken() callback
    ↓
Refresh token via GraphQL mutation
    ↓
Update state and localStorage
    ↓
Retry original request with new token
    ↓
Return result
```

## Proactive Refresh Flow

```
App loads / Token saved
    ↓
Calculate expiration time
    ↓
Store in localStorage
    ↓
useEffect monitors expiration
    ↓
Token expires in < 5 minutes?
    ↓ YES
Refresh token immediately
    ↓ NO
Schedule refresh 5 min before expiration
```

## Testing Checklist

- [ ] Test automatic refresh on 401 error
- [ ] Test proactive refresh before expiration
- [ ] Test refresh callback registration
- [ ] Test token expiration tracking
- [ ] Test retry after refresh
- [ ] Test multiple concurrent requests with expired token
- [ ] Test refresh failure handling

## Potential Issues & Solutions

### Issue 1: Refresh Token Expired
**Solution**: The refresh callback returns `null`, which causes the request to fail. User will need to login again (expected behavior).

### Issue 2: Multiple Concurrent Requests
**Solution**: The refresh callback can be called multiple times. Consider adding a lock mechanism to prevent multiple simultaneous refreshes.

### Issue 3: Race Condition
**Solution**: The callback reads from state which might be stale. Fixed by reading from localStorage as fallback.

## Next Steps

1. **Add refresh lock** to prevent multiple simultaneous refreshes
2. **Add refresh queue** for requests that fail during refresh
3. **Add retry limit** to prevent infinite retry loops
4. **Monitor refresh failures** and log metrics
5. **Test with real expiration scenarios**

## Files Modified

1. `app/src/lib/graphql-utils.ts` - Added automatic refresh interceptor
2. `app/src/lib/auth-context.tsx` - Added proactive refresh and callback

## Backend Status

✅ Backend refresh token implementation is correct and working. No changes needed.
