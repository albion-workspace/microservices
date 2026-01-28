# Microservices Payment System - Complete Documentation

**Last Updated**: 2026-01-21  
**Status**: ✅ Production Ready

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Project Structure](#project-structure)
3. [Architecture](#architecture)
4. [Microservices](#microservices)
5. [Dependencies](#dependencies)
6. [Databases](#databases)
7. [Quick Start](#quick-start)
8. [Testing](#testing)
9. [Recovery System](#recovery-system)
10. [Pending Operations & Approval Workflows](#-pending-operations--approval-workflows)
11. [GraphQL API](#graphql-api)
12. [Performance](#performance)
13. [Access Control](#access-control)
14. [Implementation Status](#implementation-status)

---

## 🏗️ Project Overview

Microservices-based payment system with simplified schema (3 collections: wallets, transactions, transfers), generic recovery system, and comprehensive testing.

### Key Features
- **Simplified Schema**: 50% reduction in writes (6 → 3 documents), 75% reduction in storage
- **Generic Recovery System**: Automatic recovery of stuck operations
- **Session-Aware Patterns**: MongoDB transaction support throughout
- **Type-Safe**: Full TypeScript coverage
- **Access Control**: URN-based RBAC/ACL authorization engine

---

## 📁 Project Structure

### Root Level Organization

```
tst/
├── access-engine/          # Standalone RBAC/ACL authorization engine
├── app/                    # React frontend application
├── auth-service/           # Authentication & Authorization service
├── bonus-service/          # Bonus & Reward service
├── bonus-shared/          # Shared bonus types and utilities
├── core-service/          # Core shared library (used by all microservices)
├── notification-service/  # Notification service (email, SMS, etc.)
├── payment-service/       # Payment processing service
└── scripts/               # Testing and utility scripts
```

### Core Components

**`access-engine/`** - Standalone Authorization Engine
- URN-based permissions (`resource:action:target`)
- Role-based access control (RBAC)
- Attribute-based access control (ABAC)
- Multi-tenancy support
- Permission inheritance
- Used by: `core-service`, `auth-service`

**`core-service/`** - Shared Core Library
- **Dependency**: All microservices depend on `core-service`
- Provides: Transfer helpers, transaction helpers, recovery system, saga engine, API gateway, access control integration, database utilities, Redis utilities, validation, error handling
- Exports: `core-service`, `core-service/saga`, `core-service/gateway`, `core-service/infra`, `core-service/access`

**`app/`** - React Frontend
- Vite-based React application
- GraphQL client for microservices
- UI components and pages

---

## 🔗 Dependencies

### Dependency Graph

```
┌─────────────────┐
│  access-engine  │ (standalone)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  core-service   │ (depends on access-engine)
└────────┬────────┘
         │
         ├──────────────┬──────────────┬──────────────┬──────────────┐
         ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│payment-service│ │bonus-service│ │auth-service  │ │notification │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
         │              │              │              │
         └──────────────┴──────────────┴──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ bonus-shared │
                    └──────────────┘
```

### Dependency Details

**All Microservices Depend On:**
- `core-service` - Shared utilities, helpers, saga engine, gateway, recovery system

**Additional Dependencies:**
- `payment-service` → `notification-service`
- `bonus-service` → `bonus-shared`, `notification-service`
- `auth-service` → `access-engine`, `notification-service`
- `notification-service` → `core-service`
- `core-service` → `access-engine`

---

## 🗄️ Databases

### MongoDB
- **Purpose**: Primary data storage
- **Collections**: `wallets`, `transactions`, `transfers`, `users`, `bonuses`, etc.
- **Usage**: All microservices use MongoDB for persistent data
- **Databases**: Each service has its own database (`payment_service`, `bonus_service`, `auth_service`, `notification_service`)

### Redis
- **Purpose**: Caching and state tracking
- **Usage**:
  - Cache invalidation (wallet balances, user data)
  - Recovery system state tracking (operation states with TTL)
  - Session management
- **Required**: For recovery system (graceful degradation without Redis)

---

## 🏛️ Architecture

### Architecture Principles

1. **Wallets = Single Source of Truth**: Wallet balances are the authoritative source
2. **Transactions = The Ledger**: Each transaction is a ledger entry (credit or debit)
3. **Transfers = User-to-User Operations**: Transfers create 2 transactions (double-entry)
4. **Atomic Operations**: MongoDB transactions ensure data consistency
5. **Generic Patterns**: Reusable helpers for common operations

### Data Model

**3 Collections**:
1. **wallets** - Single source of truth for balances (`balance`, `bonusBalance`, `lockedBalance`)
2. **transactions** - Ledger entries (credit/debit records with polymorphic references)
3. **transfers** - User-to-user operations (creates 2 transactions atomically)

---

## 🔧 Microservices

### 1. Payment Service (`payment-service`)
- **Port**: 3004
- **Database**: `payment_service`
- **Dependencies**: `core-service`, `notification-service`
- **Responsibilities**: 
  - Wallet management (CRUD operations)
  - Deposit/withdrawal processing
  - Transfer operations
  - Transaction history queries
  - Balance queries
- **Key Components**: `wallet.ts`, `transaction.ts`, `transfer.ts`, `transfer-approval.ts`
- **Recovery**: Transfer recovery handler registered on startup

### 2. Bonus Service (`bonus-service`)
- **Port**: 3005
- **Database**: `bonus_service`
- **Dependencies**: `core-service`, `bonus-shared`, `notification-service`
- **Responsibilities**: 
  - Bonus template management
  - User bonus operations (award, convert, forfeit)
  - Turnover tracking
  - Bonus eligibility checks
- **Key Components**: `bonus.ts`, uses `createTransferWithTransactions` for bonus operations
- **Recovery**: Transfer recovery handler registered on startup

### 3. Auth Service (`auth-service`)
- **Port**: 3003
- **Database**: `auth_service`
- **Dependencies**: `core-service`, `access-engine`, `notification-service`
- **Responsibilities**: 
  - User authentication and authorization
  - Role and permission management
  - Session management
  - OTP and 2FA
  - Social login (Facebook, Google, Instagram, LinkedIn)
- **Key Features**: Graph-based role system, context-based roles, flexible user metadata

### 4. Notification Service (`notification-service`)
- **Port**: 3006
- **Database**: `notification_service`
- **Dependencies**: `core-service`
- **Responsibilities**: 
  - Email notifications
  - SMS notifications
  - WhatsApp notifications
  - Push notifications
  - SSE (Server-Sent Events)
  - Socket notifications

### 5. Access Engine (`access-engine`)
- **Type**: Standalone library (not a service)
- **Dependencies**: None
- **Purpose**: RBAC/ACL authorization engine
- **Features**:
  - URN-based permissions (`resource:action:target`)
  - Role-based access control (RBAC)
  - Attribute-based access control (ABAC)
  - Multi-tenancy support
  - Permission inheritance
  - Caching with LRU
  - Audit logging
- **Used By**: `core-service`, `auth-service`

### 6. Core Service (`core-service`)
- **Type**: Shared library (not a service)
- **Dependencies**: `access-engine`
- **Purpose**: Shared utilities and helpers for all microservices
- **Exports**:
  - `core-service` - Main exports (transfer helpers, transaction helpers, recovery system)
  - `core-service/saga` - Saga pattern engine
  - `core-service/gateway` - API Gateway
  - `core-service/infra` - Infrastructure generation (Docker, K8s, etc.)
  - `core-service/access` - Access control integration
- **Key Components**:
  - **Transfer Helper** - `createTransferWithTransactions()` - Atomic transfer creation
  - **Transaction Helper** - `createTransaction()` - Single transaction creation
  - **Recovery System** - Generic recovery for stuck operations (Redis-backed state tracking)
  - **Saga Engine** - Distributed transaction orchestration
  - **API Gateway** - GraphQL gateway for microservices
  - **Database Utilities** - MongoDB connection, session management
  - **Redis Utilities** - Caching, state tracking
  - **Validation Chain** - Reusable validation logic (Chain of Responsibility pattern)
  - **Resolver Builder** - Fluent API for GraphQL resolver construction (Builder pattern)
  - **Error Handling** - Standardized error utilities

#### Validation Chain (Chain of Responsibility Pattern)

Reusable validation logic for GraphQL resolvers. Eliminates repetitive validation code.

**Usage Example**:
```typescript
import { createValidationChain } from 'core-service';

async function updateUserRoles(args: Record<string, unknown>, ctx: ResolverContext) {
  const validationChain = createValidationChain()
    .requireAuth()
    .extractInput()
    .requirePermission('user', 'update', '*')
    .requireFields(['userId', 'tenantId', 'roles'], 'input')
    .validateTypes({ roles: 'array' }, 'input')
    .build();
  
  const result = validationChain.handle({ args, ctx });
  if (!result.valid) {
    throw new Error(result.error);
  }
  
  // Input is guaranteed to be valid and extracted
  const input = (args as any).input;
  const { userId, tenantId, roles } = input;
  // ... rest of logic
}
```

**Available Validators**:
- `requireAuth()` - Ensures user is authenticated
- `extractInput()` - Extracts `input` wrapper for mutations
- `requirePermission(resource, action, target)` - Checks URN-based permissions
- `requireFields(fields[], source)` - Validates required fields exist
- `validateTypes(validations, source)` - Validates field types (array, string, number, object)

#### Resolver Builder (Builder Pattern)

Fluent API for constructing GraphQL resolver objects. Simplifies resolver merging in gateways.

**Usage Example**:
```typescript
import { createResolverBuilder } from 'core-service';

const resolverBuilder = createResolverBuilder()
  .addQuery('health', async () => ({ status: 'ok' }))
  .addMutation('createUser', async (args, ctx) => { return user; })
  .addService(authService)
  .addService(bonusService);

const resolvers = resolverBuilder.build();
```

**Available Methods**:
- `addQuery(name, resolver)` - Add a query resolver
- `addMutation(name, resolver)` - Add a mutation resolver
- `addSubscription(name, resolver)` - Add a subscription resolver
- `addService(service)` - Merge resolvers from a service module
- `build()` - Build the final resolver object

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (port 27017)
- Redis (port 6379)

### Start Services

```powershell
.\scripts\bin\start-service-dev.ps1
```

### Environment Variables
- `PORT` - Service port
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - JWT secret for authentication
- `REDIS_URL` - Redis connection string (for caching and recovery)

---

## 🧪 Testing

### Important Notes

1. **Run npm commands from `scripts/` directory**
   All npm test commands must be run from the `scripts/` directory:
   ```bash
   cd scripts
   npm run payment:test
   ```

2. **Test Execution Order**
   Tests must run in this specific order because payment tests drop databases:
   - **Payment tests first** - Sets up users, wallets, and drops databases
   - **Bonus tests second** - Uses users created by payment tests

### Available Test Commands

#### Payment Service Tests

```bash
cd scripts

# Run all payment tests (complete suite)
npm run payment:test

# Run specific payment tests
npm run payment:test:recovery      # Transfer recovery tests
npm run payment:test:gateway       # Gateway comprehensive tests
npm run payment:test:funding       # User-to-user funding
npm run payment:test:flow         # Complete payment flow
npm run payment:test:duplicate     # Duplicate protection
npm run payment:test:balance      # Balance summary
```

#### Bonus Service Tests

```bash
cd scripts

# Run all bonus tests (complete suite)
npm run bonus:test

# Run specific bonus tests
npm run bonus:test:transfer-recovery  # Transfer recovery for bonus operations
npm run bonus:test:onboarding         # Onboarding bonuses
npm run bonus:test:recurring          # Recurring bonuses
npm run bonus:test:referral           # Referral bonuses
```

### Complete Test Flow

**Important:** Always run payment tests first, then bonus tests. They must run sequentially, not in parallel.

```bash
cd scripts

# Step 1: Run payment tests (drops DBs, creates users)
npm run payment:test

# Step 2: Run bonus tests (uses existing users)
npm run bonus:test
```

### Prerequisites for Testing

1. **Services Running:**
   - Payment Service (port 3004)
   - Bonus Service (port 3005)
   - Auth Service (port 3003)
   - MongoDB (port 27017)
   - Redis (port 6379)

2. **Start Services:**
   ```bash
   # From project root
   .\scripts\bin\start-service-dev.ps1 payment-service
   .\scripts\bin\start-service-dev.ps1 bonus-service
   .\scripts\bin\start-service-dev.ps1 auth-service
   ```

### Test Coverage

- ✅ Deposit flow
- ✅ Withdrawal flow
- ✅ Transfer flow
- ✅ Bonus operations
- ✅ Balance queries
- ✅ Transaction history
- ✅ Recovery system
- ✅ Duplicate protection

### Troubleshooting

**Error: "Could not read package.json"**
- Solution: Make sure you're running npm commands from the `scripts/` directory, not the root.

**Error: "Service not ready"**
- Solution: Make sure all services are running before running tests.

**Error: "Redis not available"**
- Solution: Make sure Redis is running. Recovery tests require Redis.

**Tests fail because users don't exist**
- Solution: Always run payment tests first, as they create users. Bonus tests depend on users created by payment tests.

---

## 🔧 Recovery System

Generic recovery system for handling stuck operations:

### Features
- **Generic & Extensible** - Works with transfers, future orders, etc.
- **Redis-Backed** - State tracking with TTL
- **Automatic** - Background job runs every 5 minutes
- **Session-Aware** - Uses MongoDB transactions for atomic recovery

### Components

**Generic Recovery System** (`core-service/src/common/recovery.ts`):
- `RecoverableOperation` - Interface for operations that can be recovered
- `RecoveryHandler<TOperation>` - Handler interface for operation-specific recovery logic
- `OperationStateTracker` - Redis-backed state tracking for operations
- `RecoveryJob` - Periodic background job that finds and recovers stuck operations
- `recoverOperation()` - Generic entry point for recovery
- `recoverStuckOperations()` - Batch recovery function

**Transfer Recovery Handler** (`core-service/src/common/transfer-recovery.ts`):
- `createTransferRecoveryHandler()` - Creates recovery handler for Transfer operations
- Handles stuck transfers (pending/approved with inconsistencies)
- Creates reverse transfers to undo operations
- Maintains audit trail

### Setup
- Automatically registered in Payment and Bonus services on startup
- Recovery job starts automatically with graceful shutdown support

### Configuration
- **Recovery Job Interval**: 5 minutes (default)
- **Max Age**: 60 seconds (default)
- **State Tracking TTL**: 60 seconds (in-progress), 300 seconds (completed/failed)

---

## ⏳ Pending Operations & Approval Workflows

A generic framework for handling approval/rejection workflows and temporary data storage before committing to the database. Supports both JWT-based (stateless) and Redis-based (stateful) operations.

### Overview

The pending operations pattern provides:
- **No Incomplete Records**: Operations only created after approval/verification
- **Audit Trail**: All pending requests stored with metadata
- **Automatic Expiration**: Pending requests expire after configurable TTL (default 24h)
- **Queryable**: Redis-based operations can be listed and filtered
- **Reversible**: Can reject before operation is executed
- **Performance**: Redis-based, fast queries
- **Stateless Option**: JWT-based operations for email/SMS links

### Architecture

The pending operation store supports two backends:

#### 1. JWT-based (stateless)
- Data stored directly in the JWT token
- No server-side storage required
- Auto-expires based on token expiration
- **Use when**: Data doesn't need to be queried/listed, stateless operations (email links, SMS tokens)
- **Examples**: User registration, password reset, OTP verification

#### 2. Redis-based (stateful)
- Data stored in Redis with TTL
- Key pattern: `pending:{operationType}:{token}` or `pending:{operationType}:approval:{token}`
- Can be queried, updated, and listed
- Supports multi-step operations
- **Use when**: Data needs to be queried/updated, multi-step forms, operations that need server-side tracking
- **Examples**: Bonus approvals, payment approvals, campaign creation

### Backend Selection Guidelines

**Use JWT Backend (`backend: 'jwt'`) when:**
- ✅ Operation is stateless (token sent via email/SMS link)
- ✅ Data doesn't need to be queried or listed
- ✅ Single-use operations (verify once and delete)
- ✅ No need for updates during the operation lifecycle

**Use Redis Backend (`backend: 'redis'`) when:**
- ✅ Operation needs to be queried/listed via GraphQL
- ✅ Multi-step operations that need updates
- ✅ Operations that need server-side tracking
- ✅ Data needs to be shared across service instances

### Current Implementation Status

**JWT-Based Operations** (Cannot be listed via GraphQL):
- **User Registration** (`registration`) - 24 hours expiration
- **Password Reset** (`password_reset`) - 30 minutes expiration
- **OTP Verification** (`otp_verification`) - Configurable expiration

**Redis-Based Operations** (Can be listed via GraphQL):
- **Bonus Approvals** (`bonus:approval`) - 24 hours expiration
- **Payment Approvals** (future) - Can use same pattern
- **Withdrawal Approvals** (future) - Can use same pattern

### Generic Pending Operation Approval Service

The `pending-operation-approval.ts` module (`bonus-service/src/services/pending-operation-approval.ts`) provides a reusable service that handles:
- Creating pending operations
- Approving pending operations (with custom handlers)
- Rejecting pending operations
- Listing pending operations
- Getting pending operations by token
- Getting raw operation data (for debugging/admin)

#### Usage Example

```typescript
import { createPendingOperationApprovalService } from './pending-operation-approval.js';

interface MyOperationData {
  userId: string;
  amount: number;
  currency: string;
  requestedAt: number;
}

const approvalService = createPendingOperationApprovalService<MyOperationData>({
  operationType: 'payment',
  redisKeyPrefix: 'pending:payment:',
  defaultExpiration: '24h',
});

// Register approval handler
approvalService.registerApprovalHandler(async (data, context) => {
  // Your custom approval logic here
  const result = await processPayment({
    userId: data.userId,
    amount: data.amount,
    currency: data.currency,
  });
  
  return { 
    success: result.success, 
    resultId: result.paymentId 
  };
});

// Create pending operation
const token = await approvalService.createPendingOperation(data, {
  operationType: 'high_value_payment',
  description: 'Large payment request',
});

// Approve operation
const result = await approvalService.approvePendingOperation(token, {
  approvedBy: 'admin@example.com',
  reason: 'Verified user identity',
});

// Reject operation
await approvalService.rejectPendingOperation(token, {
  rejectedBy: 'admin@example.com',
  reason: 'Insufficient verification',
});
```

### Bonus Approval Workflow

The bonus service uses the generic approval service for high-value bonuses that require admin approval.

#### Architecture

**Components**:
1. **Pending Bonus Store** (`bonus-service/src/services/bonus-approval.ts`)
   - Redis-based pending operation store
   - Stores bonus requests that require approval
   - 24-hour expiration
   - Key pattern: `pending:bonus:approval:{token}`

2. **Approval Check** (`bonus-service/src/services/bonus-engine/base-handler.ts`)
   - Checks `template.requiresApproval` and `template.approvalThreshold`
   - Creates pending operation if approval required
   - Bypasses check when approving from pending operation

3. **GraphQL API**
   - `pendingBonuses` query - List all pending approvals
   - `pendingBonus(token)` query - Get specific pending bonus
   - `approveBonus(token, reason)` mutation - Approve and award bonus
   - `rejectBonus(token, reason)` mutation - Reject pending bonus

#### Bonus Types That Require Approval

1. **High-Value Tournament Prizes** (`tournament`)
   - Threshold: $10,000+
   - Example: Tournament Grand Prize ($100,000)

2. **VIP Exclusive Bonuses** (`vip`)
   - Threshold: $5,000+
   - Example: VIP Exclusive Welcome ($10,000)

3. **Custom Admin Bonuses** (`custom`)
   - Always requires approval (no threshold)
   - Example: Custom Admin Bonus ($5,000)

4. **Large Referral Commissions** (`commission`)
   - Threshold: $2,500+
   - Example: High-Value Referral Commission (10% up to $5,000)

5. **Leaderboard Rewards** (`leaderboard`)
   - Threshold: $25,000+
   - Example: Leaderboard Top Prize ($50,000)

6. **Special Event Bonuses** (`special_event`)
   - Threshold: $10,000+
   - Example: Special Event Mega Bonus ($15,000)

7. **High-Value Promo Codes** (`promo_code`)
   - Threshold: $5,000+
   - Example: Promo Code High Value ($7,500)

#### Template Configuration

```typescript
{
  name: 'Tournament Grand Prize',
  code: 'TOURNAMENT_GRAND',
  type: 'tournament',
  requiresApproval: true,
  approvalThreshold: 10000,  // Requires approval if value >= $10,000
  value: 100000,
  // ... other fields
}
```

#### Approval Flow

```
User claims bonus
    ↓
Bonus engine checks eligibility
    ↓
Calculates bonus value
    ↓
Checks requiresApproval && value >= approvalThreshold?
    ↓ YES
Creates pending operation in Redis
    ↓
Returns error: "BONUS_REQUIRES_APPROVAL" + pendingToken
    ↓
Admin reviews via pendingBonuses query
    ↓
Admin approves/rejects via approveBonus/rejectBonus mutation
    ↓
If approved: Bonus awarded (bypasses approval check)
    ↓
Pending operation deleted
```

#### GraphQL Usage

**List Pending Bonuses**:
```graphql
query {
  pendingBonuses {
    token
    templateCode
    calculatedValue
    currency
    userId
    requestedAt
    expiresAt
  }
}
```

**Get Specific Pending Bonus**:
```graphql
query {
  pendingBonus(token: "abc123...") {
    token
    templateCode
    calculatedValue
    userId
    requestedAt
  }
}
```

**Approve Bonus**:
```graphql
mutation {
  approveBonus(token: "abc123...", reason: "Verified eligibility") {
    success
    bonusId
    error
  }
}
```

**Reject Bonus**:
```graphql
mutation {
  rejectBonus(token: "abc123...", reason: "User does not meet requirements") {
    success
    error
  }
}
```

#### Generic Pending Operations Query (Auth Service)

The auth service provides generic pending operations queries that work across all services:

**List Pending Operations**:
```graphql
query {
  pendingOperations(operationType: "bonus", first: 100) {
    nodes {
      token
      operationType
      recipient
      channel
      purpose
      createdAt
      expiresAt
      expiresIn
    }
    totalCount
  }
}
```

**Get Specific Pending Operation** (works for both JWT and Redis-based):
```graphql
query {
  pendingOperation(token: "abc123...", operationType: "bonus") {
    token
    operationType
    recipient
    expiresIn
  }
}
```

**Get Raw Pending Operation Data** (admin-only, for debugging):
```graphql
query {
  pendingOperationRawData(token: "abc123...", operationType: "bonus")
}
```

### Service Implementation Pattern

All services should follow this pattern:

```typescript
import { createPendingOperationStore } from 'core-service';

export class MyService {
  private operationStore: ReturnType<typeof createPendingOperationStore>;
  
  constructor(private config: MyConfig) {
    // ALWAYS specify backend explicitly
    this.operationStore = createPendingOperationStore({
      backend: 'redis', // or 'jwt'
      redisKeyPrefix: 'pending:', // Required for Redis
      defaultExpiration: 86400, // Seconds for Redis, or '24h' for JWT
    });
  }
  
  async createOperation(data: MyData): Promise<string> {
    const token = await this.operationStore.create(
      'my_operation', // Operation type
      data, // Operation data
      {
        operationType: 'my_operation', // Must match first parameter
        expiresIn: 86400, // Override default if needed
        metadata: { /* optional metadata */ },
      }
    );
    return token;
  }
  
  async verifyOperation(token: string): Promise<MyData | null> {
    const result = await this.operationStore.verify(token, 'my_operation');
    if (!result) {
      return null; // Invalid or expired
    }
    return result.data;
  }
}
```

### Common Mistakes to Avoid

1. ❌ **Not specifying backend**: Using `backend: 'auto'` can cause inconsistent behavior
   ```typescript
   // BAD
   createPendingOperationStore({ jwtSecret })
   
   // GOOD
   createPendingOperationStore({ backend: 'redis', redisKeyPrefix: 'pending:', defaultExpiration: 86400 })
   ```

2. ❌ **Mixing expiration formats**: Using wrong format for backend
   ```typescript
   // BAD - Using time format for Redis
   createPendingOperationStore({ backend: 'redis', defaultExpiration: '24h' })
   
   // GOOD - Use seconds for Redis
   createPendingOperationStore({ backend: 'redis', defaultExpiration: 86400 })
   ```

3. ❌ **Inconsistent operation types**: Using different names for same operation
   ```typescript
   // BAD - Inconsistent naming
   store.create('registration', ...)
   store.verify(token, 'user_registration') // Mismatch!
   
   // GOOD - Consistent naming
   store.create('registration', ...)
   store.verify(token, 'registration')
   ```

### Integration with Other Services

To use the pending operations pattern in other services (e.g., `payment-service`, `withdrawal-service`):

1. Use `createPendingOperationApprovalService` from `bonus-service/src/services/pending-operation-approval.ts` as a template
2. Create a service-specific wrapper (like `bonus-approval.ts`)
3. Register your custom approval handler
4. Expose GraphQL queries/mutations as needed
5. **Always specify backend explicitly** (`backend: 'redis'` for queryable operations)

### GraphQL Integration

The auth service provides generic pending operations queries that work across all services:

**List Pending Operations** (Redis-based only):
```graphql
query {
  pendingOperations(operationType: "bonus", first: 100) {
    nodes {
      token
      operationType
      recipient
      channel
      purpose
      createdAt
      expiresAt
      expiresIn
    }
    totalCount
  }
}
```

**Get Specific Pending Operation** (works for both JWT and Redis-based):
```graphql
query {
  pendingOperation(token: "abc123...", operationType: "bonus") {
    token
    operationType
    recipient
    expiresIn
  }
}
```

**Get Raw Pending Operation Data** (admin-only, for debugging):
```graphql
query {
  pendingOperationRawData(token: "abc123...", operationType: "bonus")
}
```

**Get All Operation Types**:
```graphql
query {
  pendingOperationTypes
}
```

### React UI Component

A comprehensive UI component (`app/src/pages/PendingOperations.tsx`) displays pending operations with:
- **Real-time Updates**: Auto-refreshes every 30 seconds
- **Filtering**: By operation type and recipient
- **Statistics**: Shows total, active, and expired operations
- **Status Indicators**: Visual indicators for operation status
- **Expiration Display**: Shows time remaining until expiration
- **Raw Data Viewing**: Admin can view complete raw data for debugging

Accessible at `/pending-operations` route (requires authentication, system users see all operations).

### Testing

Run the bonus approval test scenarios:

```bash
cd scripts/typescript/bonus
npx tsx bonus-command-test.ts approval
```

This will:
- Create approval-required templates
- Test high-value bonus claims (require approval)
- List pending bonus approvals
- Test approve/reject workflows
- Leave at least one pending bonus for manual testing

### Security Best Practices

1. **Never expose sensitive data**:
   - OTP codes (even hashed)
   - Password hashes
   - Full user data

2. **Access control**:
   - Users can only see their own operations
   - Admins can see all (with proper permissions)
   - Raw data queries are admin-only

3. **Data sanitization**:
   - Sensitive fields are automatically removed before returning
   - `pendingOperationRawData` is admin-only for debugging

### Benefits

1. **Reusable**: One service for all approval workflows
2. **Type-safe**: Full TypeScript support with generics
3. **Flexible**: Custom approval handlers for each operation type
4. **Consistent**: Same API across all services
5. **Maintainable**: Centralized approval logic
6. **Dynamic**: Redis key patterns support wildcards for dynamic operation types

---

## 📡 GraphQL API

### Example Queries

**Get User Wallets**:
```graphql
query {
  userWallets(input: { userId: "user-123", currency: "EUR" }) {
    totals { realBalance, bonusBalance, totalBalance }
    wallets { id, balance, bonusBalance }
  }
}
```

**Get Transactions**:
```graphql
query {
  transactions(first: 10, filter: { userId: "user-123" }) {
    nodes { id, amount, charge, balance, createdAt }
    totalCount
  }
}
```

**Bulk Balance Query**:
```graphql
query {
  bulkWalletBalances(
    userIds: ["user-1", "user-2", "user-3"]
    currency: "EUR"
  ) {
    balances {
      userId
      balance
      availableBalance
    }
  }
}
```

### Example Mutations

**Create Deposit**:
```graphql
mutation {
  deposit(input: {
    userId: "user-123"
    amount: 100.00
    currency: "EUR"
    method: "card"
  }) {
    success
    transfer { id, status }
  }
}
```

**Create Transfer**:
```graphql
mutation {
  createTransfer(input: {
    fromUserId: "user-1"
    toUserId: "user-2"
    amount: 50.00
    currency: "EUR"
  }) {
    success
    transfer { id, status }
  }
}
```

---

## ⚡ Performance

### Write Performance
- **50% reduction** in writes (6 → 3 documents per transaction)
- **75% reduction** in document size (~300 bytes vs ~1.2 KB)
- Atomic operations (MongoDB transactions)

### Query Performance
- Proper indexes on frequently queried fields
- Efficient bulk queries (`bulkWalletBalances`)
- Cache invalidation after updates

### Storage
- **75% reduction** in storage per transaction
- Simplified data model

---

## 🎯 Key Design Decisions

### 1. Ultra-Minimal Transaction Structure
- Only 6 core fields: `userId`, `amount`, `balance`, `objectId`, `objectModel`, `charge`
- Everything else in flexible `meta` object
- Based on proven Mongoose pattern (polymorphic references)

### 2. Polymorphic References
- `objectId` + `objectModel` pattern replaces separate refId/refType
- Single index covers all entity types
- More flexible and extensible

### 3. Immutable Transactions
- Only `createdAt` timestamp (no `updatedAt`)
- Transactions are append-only (audit trail)
- Balance is snapshot at transaction time

### 4. No Separate Ledger Collections
- Transactions ARE the ledger
- Each transaction = one ledger entry (credit OR debit)
- Transfers = double-entry (2 transactions)

### 5. Session-Aware Patterns
- Helpers accept optional MongoDB session parameter
- Can be used standalone or with external session
- Enables multi-operation transactions

### 6. Generic Recovery System
- Works with any operation type (transfers, future orders, etc.)
- Redis-backed state tracking
- Automatic background recovery job
- Maintains audit trail via reverse operations

---

## 📊 Data Flow Examples

### Deposit Flow

1. **Create Transfer** (`transfers` collection)
   - `fromUserId`: 'payment-gateway-user'
   - `toUserId`: 'end-user'
   - `amount`: 10000 (€100.00)
   - `status`: 'approved'

2. **Create Debit Transaction** (`transactions` collection)
   - `userId`: 'payment-gateway-user'
   - `amount`: 10000
   - `charge`: 'debit'
   - `objectModel`: 'transfer'
   - `objectId`: transfer.id

3. **Create Credit Transaction** (`transactions` collection)
   - `userId`: 'end-user'
   - `amount`: 9710 (after fee)
   - `charge`: 'credit'
   - `objectModel`: 'transfer'
   - `objectId`: transfer.id

4. **Update Wallets** (`wallets` collection)
   - Debit from gateway wallet
   - Credit to user wallet
   - Update lifetime stats

**Result**: 3 documents created (1 transfer + 2 transactions), 2 wallets updated

### Bonus Award Flow

1. **Create Transfer** (bonus balance)
   - `fromUserId`: 'bonus-pool'
   - `toUserId`: 'end-user'
   - `amount`: 5000 (€50.00 bonus)
   - Uses `createTransferWithTransactions()` with `toBalanceType: 'bonus'`

2. **Creates 2 Transactions** (same as deposit)
3. **Updates Wallets** (bonusBalance field)

---

## 🔐 Access Control

### Access Engine (`access-engine`)

Standalone RBAC/ACL authorization engine with URN-based permissions.

**Features**:
- URN-based permissions (`resource:action:target`)
- Role-based access control (RBAC)
- Attribute-based access control (ABAC)
- Multi-tenancy support
- Permission inheritance
- Caching with LRU
- Audit logging

**Usage**:
```typescript
import { AccessEngine, hasRole, isAuthenticated } from 'access-engine';

const engine = new AccessEngine();
engine.addRole({
  name: 'admin',
  permissions: ['*:*:*'],
});

const user = { userId: '123', roles: ['admin'] };
const result = await engine.check(user, 'wallet:read:own');
console.log(result.allowed); // true
```

**Integration**:
- Used by `core-service` for access control integration
- Used by `auth-service` for role and permission management
- Provides GraphQL resolvers for access control

---

## 📝 Implementation Status

### Migration Status: 100% Complete ✅

**Completed**:
- ✅ Type definitions updated (ultra-minimal schema)
- ✅ Core refactoring complete (`createTransferWithTransactions` helper)
- ✅ GraphQL schemas updated
- ✅ Service cleanup done
- ✅ Code deduplication complete
- ✅ Test updates complete
- ✅ Bug fixes complete (tenantId alignment, wallet updates, cache invalidation)
- ✅ Recovery system implemented (generic, transfer recovery)
- ✅ All tests passing (payment + bonus)

### Code Quality: Excellent ✅

**Strengths**:
- ✅ Excellent code organization
- ✅ Good error handling
- ✅ Type safety throughout
- ✅ Session-aware patterns
- ✅ Shared helpers reduce duplication

**Improvements Made**:
- ✅ Extracted `getBalanceField()` helper (removed 3 duplications)
- ✅ Generic recovery system (extensible for future operations)

---

## 🐛 Bug Fixes (2026-01-20)

### 1. TenantId Alignment Issue ✅ FIXED
- **Problem**: Inconsistent tenantId defaults across services
- **Solution**: Aligned all payment service defaults to use `'default-tenant'`
- **Files Changed**: `payment-service/src/services/transfer.ts`, `transaction.ts`, `wallet.ts`

### 2. Wallet Balance Update Issue ✅ FIXED
- **Problem**: Wallet updates could update wrong wallet when multiple wallets exist
- **Solution**: Updated to use wallet `id` instead of `{ userId, currency, tenantId }` query
- **Files Changed**: `core-service/src/common/transfer-helper.ts`

### 3. Cache Invalidation ✅ FIXED
- **Problem**: GraphQL queries returned stale wallet balance data
- **Solution**: Added cache invalidation after wallet updates
- **Files Changed**: `core-service/src/common/transfer-helper.ts`

---

## 📚 Scripts Documentation

### Scripts Structure

```
scripts/
├── bin/                    # PowerShell scripts (.ps1)
│   ├── start-service-dev.ps1
│   ├── clean-all.ps1
│   ├── clean-build-run.ps1
│   └── test-all-api.ps1
└── typescript/             # TypeScript/JavaScript scripts
    ├── auth/               # Auth service scripts
    ├── bonus/              # Bonus service scripts
    ├── payment/             # Payment service scripts
    ├── config/             # Configuration (users, MongoDB)
    └── benchmark.ts        # Performance benchmarks
```

### Key Scripts

**Payment Scripts** (`scripts/typescript/payment/`):
- `payment-command-test.ts` - Unified test suite
- `payment-command-db-check.ts` - Database checks and maintenance

**Bonus Scripts** (`scripts/typescript/bonus/`):
- `bonus-command-test.ts` - Unified test suite
- `bonus-command-db-check.ts` - Database checks

**Auth Scripts** (`scripts/typescript/auth/`):
- `check-auth.ts` - Unified check operations
- `test-auth.ts` - Unified test operations
- `debug-auth.ts` - Unified debug operations

**Configuration** (`scripts/typescript/config/`):
- `users.ts` - Centralized user configuration for all tests
- `mongodb.ts` - MongoDB connection utilities

See [`scripts/README.md`](./scripts/README.md) for detailed script documentation.

---

## ✅ Status

- ✅ Migration Complete (6 → 3 collections)
- ✅ Recovery System Implemented and Tested
- ✅ All Tests Passing
- ✅ Production Ready

---

**Last Updated**: 2026-01-21
