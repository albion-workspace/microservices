# Services Reference

> Detailed documentation for each microservice.

## Auth Service (Port 9001)

Authentication and authorization microservice with JWT-based sessionless authentication, OTP verification, 2FA support, and role-based access control.

### Features

- **User Registration & Login** - Email/phone/username with password
- **JWT Token Management** - Access tokens (short-lived) and refresh tokens (long-lived)
- **Session Management** - Device-based sessions with token rotation
- **OTP Verification** - Email/SMS/WhatsApp OTP for verification and password reset
- **Two-Factor Authentication** - TOTP-based 2FA with backup codes
- **Password Management** - Reset, change, and validation
- **Role-Based Access Control** - Graph-based roles with context support
- **OAuth Integration** - Social authentication (Google, Facebook, etc.)
- **Multi-tenant Support** - Tenant isolation for all operations

### Session Management

The auth service implements a **unified session management system** combining refresh tokens and session data in a single MongoDB collection.

**Key Components:**
- **Session Collection**: Stores both refresh token hashes and session metadata
- **Device-Based Sessions**: One session per device (identified by `deviceId`)
- **Token Rotation**: Refresh tokens are rotated on each use for security
- **Session Reuse**: Existing valid sessions are reused when logging in from the same device

**Session Lifecycle:**
1. **Login**: Creates new session or reuses existing for same device
2. **Token Refresh**: Rotates refresh token, updates `lastUsedAt`
3. **Logout**: Invalidates specific session by refresh token
4. **Logout All**: Invalidates all sessions for a user
5. **Expiration**: Sessions expire based on configurable TTL

### Token Refresh Flow

```
Request fails with 401 or auth error
    ↓
graphql-utils calls tokenRefreshCallback
    ↓
auth-context refreshes via GraphQL mutation
    ↓
New tokens saved to localStorage + state
    ↓
Original request retried with new token
```

### Role System

**Graph-Based Roles** with context support:
- **Context-based roles**: User can be manager in one branch, employee in another
- **Hierarchical roles**: Roles inherit from parent roles
- **URN permissions**: `resource:action:target` format

**Default Roles:**
| Role | Description |
|------|-------------|
| `super-admin` | Full system access across all tenants |
| `system` | System-level for automated processes |
| `admin` | Business administrator |
| `user` | Standard user |
| `branch-manager` | Banking: branch manager |
| `payment-gateway` | Payment gateway system user |
| `player` | Betting platform player |

### GraphQL API Examples

**Login:**
```graphql
mutation {
  login(input: {
    tenantId: "default-tenant"
    identifier: "user@example.com"
    password: "SecurePass123!"
  }) {
    success
    tokens { accessToken refreshToken expiresIn }
  }
}
```

**Enable 2FA:**
```graphql
mutation {
  enable2FA(input: { password: "SecurePass123!" }) {
    success
    secret
    qrCode
    backupCodes
  }
}
```

---

## Payment Service (Port 9002)

Financial operations microservice handling wallets, transfers, and transactions.

### Architecture

**Critical Design:**
```
Wallets = Source of Truth (balances)
Transactions = Ledger (audit trail)
Transfers = Operations (creates 2 transactions)
```

### Features

- **Wallet Management** - Multi-currency, multi-balance (real, bonus, locked)
- **Atomic Transfers** - `createTransferWithTransactions()` ensures consistency
- **Transaction Ledger** - Complete audit trail
- **Event Integration** - Listens to bonus events, updates wallets
- **Duplicate Protection** - Unique index on `metadata.externalRef`

### Balance Types

| Balance | Purpose |
|---------|---------|
| `balance` | Real money balance |
| `bonusBalance` | Promotional/bonus funds |
| `lockedBalance` | Funds locked for pending operations |

### GraphQL API Examples

**Get Wallet:**
```graphql
query {
  myWallet(currency: "EUR") {
    id
    balance
    bonusBalance
    lockedBalance
    currency
  }
}
```

**Create Transfer:**
```graphql
mutation {
  createTransfer(input: {
    toUserId: "receiver-id"
    amount: 10000
    currency: "EUR"
  }) {
    success
    transfer { id status }
  }
}
```

---

## Bonus Service (Port 9003)

Promotion and rewards microservice.

### Features

- **Handler Registry** - Extensible bonus types (first_deposit, reload, referral)
- **Validator Chain** - Composable eligibility checks
- **Turnover Tracking** - Category-based contribution rates
- **Event-Driven** - Integrates with payment service via events

### Bonus Types

| Type | Trigger |
|------|---------|
| `first_deposit` | User's first deposit |
| `reload` | Subsequent deposits |
| `referral` | User referred by another |
| `promotion` | Marketing campaigns |

### Event Flow

```
User deposits → bonus.awarded event → payment-service credits wallet
User plays → bonus.activity event → turnover updated
Turnover met → bonus.converted event → balance converted to real
```

---

## Notification Service (Port 9004)

Multi-channel notification microservice.

### Channels

| Channel | Provider | Features |
|---------|----------|----------|
| Email | SMTP/SendGrid | Templates, attachments |
| SMS | Twilio | OTP, alerts |
| Push | FCM/APNS | Mobile notifications |
| SSE | Built-in | Server-sent events |
| WebSocket | Socket.IO | Bidirectional real-time |
| Webhook | HTTP | External integrations |

### Real-Time Pattern

The notification service provides a **unified interface** for SSE and Socket.IO:

```typescript
// Works for both SSE and Socket.IO
notificationService.broadcastToUser('socket', userId, 'notification', {
  subject: 'New message',
  body: 'You have a new message',
});

// Broadcast to tenant
notificationService.broadcastToTenant('sse', tenantId, 'announcement', {
  title: 'System Update',
});
```

**When to Use:**

| Use Case | Channel |
|----------|---------|
| Simple event streaming | SSE |
| Bidirectional communication | Socket.IO |
| Real-time chat | Socket.IO |
| Server notifications | SSE |

---

## KYC Service (Port 9005)

Know Your Customer / Identity verification microservice.

### Features

- **Multi-Tier Verification**: none → basic → standard → enhanced → full → professional
- **Provider-Agnostic**: Supports Onfido, Sumsub, Jumio, mock
- **Jurisdiction-Aware**: Different rules per country/region
- **Risk-Based**: Dynamic risk scoring

### KYC Tiers

| Tier | Requirements | Limits (EUR) |
|------|--------------|--------------|
| `none` | - | No transactions |
| `basic` | Email/phone verified | €1K deposit |
| `standard` | Government ID + selfie | €5K deposit |
| `enhanced` | ID + address proof | €25K deposit |
| `full` | ID + address + source of funds | €100K deposit |
| `professional` | Corporate KYC (KYB) | €1M+ limits |

### Risk Scoring

| Factor | Weight | High Risk Indicators |
|--------|--------|---------------------|
| Geography | 25% | High-risk/sanctioned countries |
| Customer Type | 20% | PEP, complex structures |
| Activity | 25% | Unusual patterns |
| Product | 15% | Higher tier = more risk |
| Compliance | 15% | AML/sanction matches |

### GraphQL API Examples

**Check Transaction Limit:**
```graphql
query {
  checkTransactionLimit(type: "withdrawal", amount: 5000, currency: "EUR") {
    allowed
    reason
    requiredTier
  }
}
```

**Start Verification:**
```graphql
mutation {
  startKYCVerification(input: {
    targetTier: standard
    redirectUrl: "https://app.example.com/callback"
  }) {
    id
    providerSession { sessionUrl }
  }
}
```

---

## Database Collections

| Service | Collections |
|---------|-------------|
| Auth | `users`, `sessions`, `pending_operations` |
| Payment | `wallets`, `transactions`, `transfers` |
| Bonus | `bonus_templates`, `user_bonuses`, `bonus_activities` |
| Notification | `notifications`, `webhook_subscriptions` |
| KYC | `kyc_profiles`, `kyc_documents`, `kyc_verifications` |

---

**See also:** [Architecture](architecture.md), [Development](development.md)
