# KYC Service

**Version**: 1.0.0  
**Status**: Development Ready  
**Last Updated**: 2026-01-30

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
│   ├── index.ts                 # Service entry point
│   ├── database.ts              # Database accessor
│   ├── graphql.ts               # GraphQL schema & resolvers
│   ├── error-codes.ts           # Error codes
│   ├── event-dispatcher.ts      # Event handling
│   ├── config-defaults.ts       # Configuration defaults
│   │
│   ├── config/
│   │   └── default-jurisdictions.ts    # Pre-configured jurisdictions
│   │
│   ├── types/
│   │   ├── kyc-types.ts         # Core KYC types
│   │   ├── jurisdiction-config.ts
│   │   └── provider-types.ts
│   │
│   ├── services/
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
│       ├── kyc-repository.ts
│       ├── document-repository.ts
│       └── verification-repository.ts
│
├── package.json
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

## Client-Side Package (kyc-shared)

For frontend eligibility checking:

```typescript
import { KYCEligibility } from 'kyc-shared';

const eligibility = new KYCEligibility({
  currentTier: 'basic',
  status: 'approved',
  expiresAt: new Date('2027-01-01'),
});

// Check tier requirement
const tierCheck = eligibility.check({
  type: 'tier',
  requiredTier: 'standard',
});

if (!tierCheck.eligible) {
  console.log('Upgrade needed:', tierCheck.upgradeUrl);
}

// Check transaction
const txCheck = eligibility.check({
  type: 'transaction',
  transactionType: 'withdrawal',
  amount: 5000,
  currency: 'EUR',
});

if (!txCheck.eligible) {
  console.log('Limit exceeded:', txCheck.reason);
  console.log('Required tier:', txCheck.requiredTier);
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

**Last Updated**: 2026-01-30
