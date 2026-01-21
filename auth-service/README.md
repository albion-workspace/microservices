# Auth Service

Authentication and authorization microservice with JWT-based sessionless authentication, OTP verification, 2FA support, and role-based access control.

## Features

- ✅ **User Registration & Login** - Email/phone/username with password
- ✅ **JWT Token Management** - Access tokens (short-lived) and refresh tokens (long-lived)
- ✅ **Session Management** - Device-based sessions with token rotation
- ✅ **OTP Verification** - Email/SMS/WhatsApp OTP for verification and password reset
- ✅ **Two-Factor Authentication** - TOTP-based 2FA with backup codes
- ✅ **Password Management** - Reset, change, and validation
- ✅ **Role-Based Access Control** - Graph-based roles with context support
- ✅ **OAuth Integration** - Social authentication (Google, Facebook, etc.)
- ✅ **Multi-tenant Support** - Tenant isolation for all operations

## Session Management

### Overview

The auth service implements a **unified session management system** that combines refresh tokens and session data in a single MongoDB collection. Sessions are device-based and support token rotation for enhanced security.

### Architecture

**Key Components:**
- **Session Collection**: Stores both refresh token hashes and session metadata
- **Device-Based Sessions**: One session per device (identified by `deviceId`)
- **Token Rotation**: Refresh tokens are rotated on each use for security
- **Session Reuse**: Existing valid sessions are reused when logging in from the same device

### Session Lifecycle

1. **Login**: Creates a new session or reuses existing session for the same device
2. **Token Refresh**: Rotates refresh token and updates `lastUsedAt` timestamp
3. **Logout**: Invalidates a specific session by refresh token
4. **Logout All**: Invalidates all sessions for a user
5. **Expiration**: Sessions expire based on `sessionExpiresAt` and `refreshTokenExpiresAt`

### Session Structure

```typescript
interface Session {
  id?: string;                    // MongoDB _id as string
  userId: string;                 // User ID
  tenantId: string;                // Tenant ID
  tokenHash: string;              // Hashed refresh token (for lookups)
  refreshTokenExpiresAt: Date;     // Refresh token expiration (e.g., 7 days)
  deviceId: string;                // Unique device identifier
  deviceInfo?: DeviceInfo;         // Device metadata (OS, browser, etc.)
  createdAt: Date;                 // Session creation time
  lastAccessedAt: Date;            // Last access time (updated on each access)
  lastUsedAt?: Date;               // Last refresh token use time
  sessionExpiresAt: Date;          // Session expiration (e.g., 30 days)
  isValid: boolean;                // Session validity flag
  revokedAt?: Date;                // Revocation timestamp
  revokedReason?: string;          // Revocation reason ('logout', 'logout_all', 'expired', etc.)
}
```

### Session Utilities

All session operations are handled by utility functions in `src/utils/session-utils.ts`:

- `findExistingSession()` - Find valid session for device
- `createSession()` - Create new session with refresh token
- `updateSessionForReuse()` - Reuse existing session with token rotation
- `invalidateSessionByToken()` - Invalidate session by refresh token hash
- `invalidateAllUserSessions()` - Invalidate all sessions for a user
- `updateSessionLastUsed()` - Update last used timestamp

### GraphQL API

**Query:**
```graphql
query {
  mySessions {
    sessionId
    deviceInfo
    createdAt
    lastAccessedAt
    isValid
  }
}
```

**Mutations:**
```graphql
# Logout from current device
mutation {
  logout(refreshToken: "refresh_token_value") {
    success
    message
  }
}

# Logout from all devices
mutation {
  logoutAll {
    success
    count
  }
}

# Refresh access token
mutation {
  refreshToken(input: {
    refreshToken: "refresh_token_value"
    tenantId: "default-tenant"
  }) {
    success
    tokens {
      accessToken
      refreshToken
      expiresIn
      refreshExpiresIn
    }
  }
}
```

### Configuration

Session behavior is controlled by `AuthConfig`:

```typescript
{
  jwtExpiresIn: '1h',              // Access token expiration
  jwtRefreshExpiresIn: '7d',       // Refresh token expiration
  sessionMaxAge: 30,               // Session max age in days
}
```

### Security Features

1. **Token Hashing**: Refresh tokens are hashed before storage (SHA-256)
2. **Token Rotation**: Refresh tokens are rotated on each use
3. **Plain Token Removal**: Plain tokens are removed from DB after creation
4. **Device Tracking**: Sessions are tied to specific devices
5. **Expiration Handling**: Automatic expiration and cleanup
6. **Revocation Support**: Sessions can be revoked with reason tracking

### Implementation Details

**Session Creation Flow:**
1. User logs in → Check for existing valid session for device
2. If exists → Reuse session, rotate refresh token
3. If not → Create new session with new refresh token
4. Generate JWT access token (short-lived)
5. Return both tokens to client

**Token Refresh Flow:**
1. Client sends refresh token → Hash and lookup session
2. Validate session (expired, revoked, etc.)
3. Update `lastUsedAt` timestamp
4. Rotate refresh token (generate new, update hash)
5. Generate new JWT access token
6. Return new token pair

**Logout Flow:**
1. Client sends refresh token → Hash and lookup session
2. Set `isValid = false`, set `revokedAt`, set `revokedReason`
3. Session is now invalid for future refresh attempts

### Database Schema

**Collection: `sessions`**

Indexes:
- `{ userId: 1, tenantId: 1, deviceId: 1 }` - Unique device session lookup
- `{ tokenHash: 1 }` - Fast refresh token lookup
- `{ userId: 1, tenantId: 1, isValid: 1 }` - Active sessions query
- `{ sessionExpiresAt: 1 }` - Expiration cleanup queries

### Best Practices

1. **Always use `extractDocumentId()`** helper for session ID extraction
2. **Never store plain refresh tokens** in database (only hashes)
3. **Rotate refresh tokens** on each use for security
4. **Track device information** for security monitoring
5. **Implement session cleanup** job for expired sessions
6. **Use `normalizeDocument()`** for consistent document handling

## Security Features

### Password Security

- **Password Hashing**: All passwords are hashed using `bcrypt` before storage
- **Password Verification**: Passwords are verified using `bcrypt.compare()` during login
- **Password Reset**: Secure password reset flow with OTP verification
- **Password Change**: Users can change passwords with current password verification

### User Status Management

- **Registration Flow**: New users start with `status: 'pending'` after registration verification
- **Auto-Activation**: Users are automatically activated (`status: 'pending'` → `'active'`) on first successful login
- **Default Role**: All users receive the default `'user'` role on registration
- **Status Enforcement**: Pending users cannot perform operations until activated

### JWT-Based Registration

- **Registration Tokens**: Unverified registrations use JWT tokens (expires in 24 hours)
- **Database Optimization**: Users are only saved to DB after email/phone verification
- **Spam Prevention**: Reduces unverified user records and spam registrations
- **Automatic Expiration**: JWT tokens expire automatically, allowing re-registration

## Role-Based Access Control

The auth service implements a **graph-based role and permission system** with context support:

### Key Features

- **Context-Based Roles**: Users can have different roles in different contexts (e.g., manager in branch-001, employee in branch-002)
- **Hierarchical Roles**: Roles can inherit from other roles (e.g., `branch-manager` inherits from `user`)
- **Permission System**: Uses URN format (`resource:action:target`) for granular permissions
- **System Role**: The `system` role has full access (`*:*:*`), other roles use specific permissions

### Default Roles

**System Roles:**
- `super-admin`: Full system access across all tenants
- `system`: System-level user for automated processes (full access)
- `admin`: Business administrator with specific permissions
- `user`: Standard user with basic permissions

**Domain-Specific Roles:**
- Banking: `branch-manager`, `teller`, `customer-service`
- Crypto Wallet: `crypto-admin`, `crypto-trader`
- Foreign Exchange: `forex-broker`, `forex-trader`, `forex-analyst`
- Betting Platform: `betting-admin`, `agent`, `player`
- Payment Gateway: `payment-gateway`, `payment-provider`

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed role system documentation.

## API Documentation

### Authentication

#### Register
```graphql
mutation {
  register(input: {
    tenantId: "default-tenant"
    email: "user@example.com"
    password: "SecurePass123!"
    autoVerify: false
    sendOTP: true
  }) {
    success
    message
    user { id email }
    tokens { accessToken refreshToken }
    registrationToken  # If sendOTP=true
  }
}
```

#### Login
```graphql
mutation {
  login(input: {
    tenantId: "default-tenant"
    identifier: "user@example.com"
    password: "SecurePass123!"
    twoFactorCode: "123456"  # If 2FA enabled
  }) {
    success
    message
    user { id email roles }
    tokens { accessToken refreshToken expiresIn refreshExpiresIn }
  }
}
```

### OTP Verification

#### Send OTP
```graphql
mutation {
  sendOTP(input: {
    tenantId: "default-tenant"
    recipient: "user@example.com"
    channel: "email"
    purpose: "email_verification"
  }) {
    success
    message
    otpToken  # JWT token for verification
    otpSentTo
    channel
  }
}
```

#### Verify OTP
```graphql
mutation {
  verifyOTP(input: {
    tenantId: "default-tenant"
    otpToken: "jwt_token_from_sendOTP"
    code: "000000"  # Test OTP (use actual OTP in production)
  }) {
    success
    message
  }
}
```

### Two-Factor Authentication

#### Enable 2FA
```graphql
mutation {
  enable2FA(input: {
    password: "SecurePass123!"
  }) {
    success
    secret
    qrCode
    backupCodes
  }
}
```

#### Verify 2FA Setup
```graphql
mutation {
  verify2FA(input: {
    token: "123456"  # TOTP code from authenticator app
  }) {
    success
    message
  }
}
```

## Development

### Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev
```

### Testing

```bash
# Run auth service tests
npm run auth:test

# Run specific test suites
npm run auth:test:registration
npm run auth:test:login
npm run auth:test:otp
npm run auth:test:2fa
```

### Configuration

Configuration is loaded from environment variables with defaults in `src/config.ts`:

- `JWT_SECRET` - Secret for signing access tokens
- `JWT_REFRESH_SECRET` - Secret for signing refresh tokens
- `JWT_EXPIRES_IN` - Access token expiration (default: `1h`)
- `JWT_REFRESH_EXPIRES_IN` - Refresh token expiration (default: `7d`)
- `SESSION_MAX_AGE` - Session max age in days (default: `30`)

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture and role system documentation
- [Auth Service Scripts](../scripts/typescript/auth/README.md) - Testing and management scripts
