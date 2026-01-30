# KYC Service

**Version**: 1.0.1  
**Status**: Running  
**Port**: 9005  
**Last Updated**: 2026-01-30

> **IMPORTANT**: Before making any changes to this service, always review [CODING_STANDARDS.md](../CODING_STANDARDS.md) to ensure consistency with project patterns, especially:
> - Package & Dependency Conventions (no duplicate tsx/typescript, use core-service)
> - GraphQL handling (use createService pattern, not raw graphql imports)
> - Event-driven communication (use emit/on from core-service)
> - Repository patterns (extend BaseRepository from core-service)

---

## Overview

Generic KYC (Know Your Customer) / Identity Verification Service supporting:

- **Multi-Tier Verification**: none → basic → standard → enhanced → full → professional
- **Provider-Agnostic**: Supports Onfido, Sumsub, Jumio, and custom providers
- **Jurisdiction-Aware**: Different rules per country/region
- **Domain-Flexible**: Finance, betting, crypto, e-commerce
- **Regulatory Compliance**: AML, PEP, Sanctions screening
- **Risk-Based Approach**: Dynamic risk scoring and assessment

---

## Architecture

### Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        KYC Service                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  KYC     │  │ Tier     │  │   Risk   │  │  Limit   │        │
│  │  Engine  │  │ Config   │  │ Calculator│  │  Service │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │                │
│       └─────────────┴─────────────┴─────────────┘                │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────┐          │
│  │              Provider Abstraction                  │          │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  │          │
│  │  │ Onfido │  │ Sumsub │  │ Jumio  │  │  Mock  │  │          │
│  │  └────────┘  └────────┘  └────────┘  └────────┘  │          │
│  └───────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                           │
          Events (Redis Pub/Sub)
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
    ▼                      ▼                      ▼
┌────────────┐      ┌────────────┐      ┌────────────┐
│Auth Service│      │Payment Svc │      │Bonus Svc   │
├────────────┤      ├────────────┤      ├────────────┤
│• User meta │      │• Pre-check │      │• Eligibility│
│• Status    │      │• Limits    │      │• Tier req  │
│• Tier sync │      │• Approval  │      │            │
└────────────┘      └────────────┘      └────────────┘
```

### Project Structure

```
kyc-service/
├── src/
│   ├── index.ts                 # Service entry point (uses createGateway)
│   ├── database.ts              # MongoDB database accessor
│   ├── redis.ts                 # Redis accessor
│   ├── error-codes.ts           # Error codes
│   ├── event-dispatcher.ts      # Event handling (IntegrationEvent pattern)
│   ├── config-defaults.ts       # Configuration defaults
│   │
│   ├── config/
│   │   └── default-jurisdictions.ts    # Pre-configured jurisdictions
│   │
│   ├── types/
│   │   ├── index.ts             # Type exports
│   │   ├── kyc-types.ts         # Core KYC types
│   │   ├── jurisdiction-config.ts
│   │   └── provider-types.ts
│   │
│   ├── services/
│   │   ├── kyc.ts               # GraphQL services (createService pattern)
│   │   └── kyc-engine/
│   │       ├── engine.ts        # Main orchestration
│   │       ├── tier-config.ts   # Tier requirements
│   │       └── risk-calculator.ts
│   │
│   ├── providers/
│   │   ├── provider-factory.ts
│   │   ├── base-provider.ts
│   │   └── mock-provider.ts
│   │
│   └── repositories/
│       ├── index.ts             # Repository exports
│       ├── kyc-repository.ts    # Extends UserScopedRepository
│       ├── document-repository.ts # Extends BaseRepository
│       └── verification-repository.ts # Extends BaseRepository
│
├── package.json                 # Only core-service dependency
└── tsconfig.json
```

---

## KYC Tiers

| Tier | Name | Requirements | Limits (EUR) |
|------|------|--------------|--------------|
| `none` | Unverified | - | No transactions |
| `basic` | Basic | Email/phone verified | €1K deposit, €500 withdrawal |
| `standard` | Standard | Government ID + selfie | €5K deposit, €2.5K withdrawal |
| `enhanced` | Enhanced | ID + address proof | €25K deposit, €15K withdrawal |
| `full` | Full | ID + address + source of funds | €100K deposit, €50K withdrawal |
| `professional` | Professional | Corporate KYC (KYB) | €1M+ limits |

---

## Quick Start

### Running the Service

```bash
# Development (watch mode)
npm run dev

# Production
npm run build && npm start
```

### Endpoints

| Endpoint | URL |
|----------|-----|
| Health | http://localhost:9005/health |
| GraphQL | http://localhost:9005/graphql |
| GraphQL Playground | http://localhost:9005/graphql (browser) |

### Initialize Service

```typescript
import { initializeKYCService, kycService } from 'kyc-service';

// Initialize
await initializeKYCService({
  brand: 'my-brand',
  tenantId: 'default',
});

// Add to gateway
const gateway = await createGateway({
  services: [authService, paymentService, kycService],
});
```

### Check Transaction Limits

```typescript
import { kycEngine } from 'kyc-service';

const check = await kycEngine.checkTransactionLimit(
  userId,
  tenantId,
  'withdrawal',
  5000,
  'EUR'
);

if (!check.allowed) {
  console.log('Upgrade required:', check.requiredTier);
}
```

### Start Verification

```typescript
import { kycEngine } from 'kyc-service';

const verification = await kycEngine.startVerification(
  {
    targetTier: 'standard',
    redirectUrl: 'https://app.example.com/kyc/callback',
  },
  userId,
  tenantId
);

// Redirect user to provider
console.log('Verification URL:', verification.providerSession?.sessionUrl);
```

---

## GraphQL API

### Queries

```graphql
# Get user's KYC profile
query {
  myKYCProfile {
    currentTier
    status
    riskLevel
    limits {
      deposit { maxAmount dailyLimit monthlyLimit }
      withdrawal { maxAmount dailyLimit monthlyLimit }
    }
    expiresAt
  }
}

# Check eligibility for tier
query {
  checkKYCEligibility(requiredTier: enhanced) {
    meetsRequirement
    currentTier
    requiredTier
    upgradeUrl
  }
}

# Check transaction limit
query {
  checkTransactionLimit(type: "withdrawal", amount: 5000, currency: "EUR") {
    allowed
    reason
    requiredTier
    limits { maxAmount dailyLimit }
  }
}
```

### Mutations

```graphql
# Start verification
mutation {
  startKYCVerification(input: {
    targetTier: standard
    redirectUrl: "https://app.example.com/callback"
  }) {
    id
    targetTier
    status
    providerSession {
      sessionUrl
      sdkToken
      expiresAt
    }
  }
}

# Update personal info
mutation {
  updateKYCPersonalInfo(input: {
    personalInfo: {
      firstName: "John"
      lastName: "Doe"
      dateOfBirth: "1990-01-15"
      nationality: "US"
    }
  }) {
    id
    personalInfo { firstName lastName }
  }
}
```

---

## Events

### Emitted Events

| Event | Description |
|-------|-------------|
| `kyc.profile.created` | New KYC profile created |
| `kyc.verification.started` | Verification flow started |
| `kyc.verification.completed` | Verification completed |
| `kyc.tier.upgraded` | User upgraded to new tier |
| `kyc.tier.downgraded` | User downgraded (expiry) |
| `kyc.status.changed` | Status changed |
| `kyc.document.uploaded` | Document uploaded |
| `kyc.document.verified` | Document verified |
| `kyc.risk.elevated` | Risk level increased |
| `kyc.expired` | Verification expired |
| `kyc.aml.match` | AML match found |
| `kyc.limit.exceeded` | Transaction limit exceeded |

### Consumed Events

| Event | Action |
|-------|--------|
| `user.registered` | Create KYC profile |
| `wallet.deposit.initiated` | Check deposit limits |
| `wallet.withdrawal.initiated` | Check withdrawal limits |
| `wallet.transaction.completed` | Trigger risk assessment (high value) |
| `bonus.claim.requested` | Check tier eligibility |

---

## Provider Integration

### Supported Providers

| Provider | Status | Features |
|----------|--------|----------|
| Mock | ✅ Ready | Testing/development |
| Onfido | 🔄 Planned | ID, liveness, AML |
| Sumsub | 🔄 Planned | ID, liveness, AML, video |
| Jumio | 🔄 Planned | ID, liveness |

### Custom Provider

```typescript
import { BaseKYCProvider } from 'kyc-service';

class MyProvider extends BaseKYCProvider {
  readonly name = 'my-provider';
  readonly displayName = 'My Provider';
  readonly version = '1.0.0';
  
  readonly capabilities = {
    supportedDocuments: ['passport', 'national_id'],
    checks: { aml: true, pep: true, sanctions: true },
    // ...
  };
  
  async createApplicant(input) { /* ... */ }
  async uploadDocument(input) { /* ... */ }
  // ... implement other methods
}
```

---

## Jurisdiction Configuration

### Pre-configured Jurisdictions

- **US**: FINCEN/BSA compliance
- **EU**: 6AMLD/GDPR compliance
- **MT** (Malta): MGA gaming license
- **GB** (UK): UKGC gaming license

### Custom Jurisdiction

```typescript
const customJurisdiction: JurisdictionConfig = {
  code: 'XX',
  name: 'Custom Jurisdiction',
  
  tierRequirements: {
    standard: {
      documents: [
        { category: 'identity', types: ['passport'], required: true },
      ],
      checks: [
        { type: 'aml', required: true },
      ],
    },
  },
  
  limits: {
    standard: {
      deposit: { maxAmount: 10000, dailyLimit: 20000, monthlyLimit: 50000 },
      withdrawal: { maxAmount: 5000, dailyLimit: 10000, monthlyLimit: 30000 },
    },
  },
  
  amlRequirements: {
    initialScreeningRequired: true,
    sanctionLists: ['OFAC', 'EU', 'UN'],
    sourceOfFundsThreshold: 10000,
  },
};
```

---

## Risk Scoring

Risk score is calculated based on:

| Factor | Weight | High Risk Indicators |
|--------|--------|---------------------|
| Geography | 25% | High-risk/sanctioned countries |
| Customer Type | 20% | PEP, complex structures |
| Activity | 25% | Unusual patterns, high volume |
| Product | 15% | Higher tier = more risk |
| Compliance | 15% | AML/sanction matches |

### Risk Levels

| Level | Score Range | Actions |
|-------|-------------|---------|
| Low | 0-25 | Normal processing |
| Medium | 26-50 | Enhanced monitoring |
| High | 51-75 | Manual review required |
| Critical | 76-100 | Account suspension |

---

## Client-Side Package (shared-validators)

For frontend eligibility checking, use the `shared-validators` package:

```typescript
import { KYCEligibility } from 'shared-validators';

// Check tier requirement
const tierCheck = KYCEligibility.checkTier('basic', 'standard');

if (!tierCheck.eligible) {
  console.log('Upgrade needed:', tierCheck.requiredTier);
}

// Check transaction limits
const txCheck = KYCEligibility.checkTransactionLimit(
  'basic',         // currentTier
  'withdrawal',    // transactionType
  5000,           // amount
  'EUR'           // currency
);

if (!txCheck.allowed) {
  console.log('Limit exceeded:', txCheck.reason);
  console.log('Required tier:', txCheck.requiredTier);
}

// Validate KYC status
const statusCheck = KYCEligibility.validateStatus('approved', new Date('2027-01-01'));
if (!statusCheck.valid) {
  console.log('Status issue:', statusCheck.reason);
}
```

---

## Security Considerations

1. **Document Storage**: Encrypt at rest, use KMS for keys
2. **Data Retention**: 7 years (regulatory requirement)
3. **GDPR Compliance**: Soft delete with anonymization
4. **PII Protection**: Personal info encrypted in database
5. **Audit Trail**: Complete status history for compliance

---

## Regulatory Compliance

| Regulation | Support |
|------------|---------|
| GDPR | Data minimization, right to erasure |
| 6AMLD (EU) | AML checks, PEP screening |
| UKGC | Self-exclusion, responsible gambling |
| MGA | Enhanced due diligence, source of funds |
| FINCEN | CIP, SAR reporting |
| MiCA | Crypto asset regulations |

---

## Database Collections

| Collection | Purpose |
|------------|---------|
| `kyc_profiles` | Main KYC profile data |
| `kyc_documents` | Uploaded documents |
| `kyc_verifications` | Verification attempts |
| `kyc_aml_checks` | AML screening results |
| `kyc_pep_screenings` | PEP check results |
| `kyc_sanction_screenings` | Sanction check results |
| `kyc_risk_assessments` | Risk assessment history |
| `kyc_source_of_funds` | Source of funds declarations |
| `kyc_business` | Corporate KYC (KYB) |

---

## Roadmap

### Phase 0: Fix TypeScript Errors & Apply Patterns ✅
> **Completed**: Service builds and runs successfully.

- [x] **Fix KYC Engine** (`src/services/kyc-engine/engine.ts`)
  - [x] Change `ClientSession` parameters to `WriteOptions` pattern
  - [x] Add missing required fields when creating entities (tenantId, status, etc.)
  - [x] Fix `ArrayBuffer.length` to use `byteLength`

- [x] **Fix Base Provider** (`src/providers/base-provider.ts`)
  - [x] Update retry config to use correct property names (`maxRetries`, `baseDelay`)
  - [x] Fix return type of `retry` method (extract `.result`)

- [x] **Fix KYC Services** (`src/services/kyc.ts`)
  - [x] Use domain-specific create methods for default values
  - [x] GraphQL type names match `createService` convention (`CreateKycDocumentResult`, etc.)

- [x] **Fix Custom Resolvers** (`src/index.ts`)
  - [x] Adjust resolver signatures to `(args, ctx)` pattern
  - [x] Rename duplicate `kycProfile` to `kycProfileByUserId`

- [x] **Fix Infrastructure**
  - [x] Created Redis accessor (`src/redis.ts`)
  - [x] Fixed MongoDB index options (filter null/undefined values)
  - [x] Proper initialization order (gateway → Redis → event handlers)

### Phase 0.1: Apply BaseRepository Pattern Across Services
> **New Pattern**: All repositories now extend `BaseRepository` from `core-service` for common CRUD operations.

- [x] **Core Service** (done)
  - [x] Created `BaseRepository` class in `core-service/src/databases/mongodb/base-repository.ts`
  - [x] Created `TenantRepository` for tenant-scoped entities
  - [x] Created `UserScopedRepository` for user-owned entities
  - [x] Exported from `core-service` main index
- [x] **KYC Service** (structure done, needs TypeScript fixes above)
  - [x] Refactored `KYCRepository` to extend `UserScopedRepository<KYCProfile>`
  - [x] Refactored `DocumentRepository` to extend `BaseRepository<KYCDocument>`
  - [x] Refactored `VerificationRepository` to extend `BaseRepository<KYCVerification>`
- [ ] **Auth Service** (pending)
  - [ ] Refactor `UserRepository` to extend `TenantRepository<User>`
  - [ ] Move common methods to base class
- [ ] **Payment Service** (pending)
  - [ ] Refactor `WalletRepository` to extend `UserScopedRepository<Wallet>`
  - [ ] Refactor `TransactionRepository` to extend `BaseRepository<Transaction>`
- [ ] **Bonus Service** (pending)
  - [ ] Refactor `BonusTemplateRepository` to extend `TenantRepository`
  - [ ] Refactor `UserBonusRepository` to extend `UserScopedRepository`

### Phase 1: Integration Setup ✅
- [x] Complete Phase 0 TypeScript fixes
- [x] Service runs standalone on port 9005
- [x] GraphQL gateway operational at `/graphql`
- [x] Health endpoint at `/health`
- [ ] Configure environment variables for production

### Phase 2: Database & Configuration
- [ ] Configure MongoDB connection for `kyc_service` database
- [ ] Run index creation on first startup
- [ ] Seed default jurisdiction configurations (US, EU, MT, GB)
- [ ] Configure service defaults in config store
- [ ] Set up document storage (S3/Azure Blob/local)

### Phase 3: Provider Integration
- [ ] Configure mock provider for development/testing
- [ ] Implement Onfido provider (`providers/onfido-provider.ts`)
- [ ] Implement Sumsub provider (`providers/sumsub-provider.ts`)
- [ ] Set up provider API keys in secure config
- [ ] Configure webhook endpoints for provider callbacks
- [ ] Test end-to-end verification flow with mock provider

### Phase 4: Service Integration
- [ ] **Auth Service**
  - [ ] Add KYC profile creation on user registration
  - [ ] Sync `kycTier` and `kycStatus` to user metadata
  - [ ] Add KYC tier to JWT claims (optional)
- [ ] **Payment Service**
  - [ ] Pre-transaction limit checks via KYC service
  - [ ] Block withdrawals for unverified users
  - [ ] Emit high-value transaction events
- [ ] **Bonus Service**
  - [ ] Add KYC tier eligibility to bonus templates
  - [ ] Check eligibility before bonus award

### Phase 5: Event System
- [ ] Register KYC event handlers in event dispatcher
- [ ] Configure webhook manager for external notifications
- [ ] Set up event consumers in dependent services
- [ ] Test event flow: registration → profile creation
- [ ] Test event flow: tier upgrade → metadata sync

### Phase 6: Admin Dashboard
- [ ] Create admin queries for pending verifications
- [ ] Create admin queries for high-risk profiles
- [ ] Implement manual approval/rejection mutations
- [ ] Add verification history view
- [ ] Add document review interface

### Phase 7: Compliance Features
- [ ] Implement periodic AML re-screening job
- [ ] Implement verification expiry notifications
- [ ] Implement auto-downgrade on expiry
- [ ] Add SAR (Suspicious Activity Report) generation
- [ ] Implement audit log export for regulators

### Phase 8: Advanced Features
- [ ] Implement real-time risk scoring with transaction data
- [ ] Add video identification support
- [ ] Implement NFC document reading (mobile)
- [ ] Add travel rule compliance for crypto
- [ ] Implement corporate KYC (KYB) workflow
- [ ] Add beneficial owner verification chain

### Phase 9: Testing & QA
- [ ] Unit tests for KYC engine
- [ ] Unit tests for risk calculator
- [ ] Integration tests with mock provider
- [ ] E2E tests for verification flow
- [ ] Load testing for limit checks
- [ ] Security audit for PII handling

### Phase 10: Production Readiness
- [ ] Enable document encryption at rest
- [ ] Configure KMS for encryption keys
- [ ] Set up monitoring and alerting
- [ ] Configure rate limiting for API endpoints
- [ ] Document operational runbook
- [ ] Create disaster recovery procedures

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.1 | 2026-01-30 | Fixed TypeScript errors, resolver signatures, GraphQL schema types, Redis/MongoDB initialization |
| 1.0.0 | 2026-01-30 | Initial implementation |

---

**Last Updated**: 2026-01-30
