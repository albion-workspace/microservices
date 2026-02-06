/**
 * KYC Service - Saga-based KYC management
 * 
 * Uses createService from core-service for GraphQL schema generation
 * and saga-based business logic.
 */

import { 
  createService, 
  type, 
  type Repository, 
  type SagaContext, 
  validateInput, 
  logger, 
  GraphQLError,
  buildConnectionTypeSDL,
  timestampFieldsOptionalSDL,
  buildSagaResultTypeSDL,
} from 'core-service';

import { KYC_ERRORS } from '../error-codes.js';
import type { 
  KYCProfile, 
  KYCTier, 
  KYCStatus, 
  KYCVerification,
  KYCDocument,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// KYC Profile Service
// ═══════════════════════════════════════════════════════════════════

interface CreateKYCProfileInput {
  userId: string;
  tenantId: string;
  jurisdictionCode: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationality?: string;
}

type KYCProfileCtx = SagaContext<KYCProfile, CreateKYCProfileInput>;

const createProfileSchema = type({
  userId: 'string',
  tenantId: 'string',
  jurisdictionCode: 'string',
  'firstName?': 'string',
  'lastName?': 'string',
  'dateOfBirth?': 'string',
  'nationality?': 'string',
});

const kycProfileSaga = [
  {
    name: 'createProfile',
    critical: true,
    execute: async ({ input, data, ...ctx }: KYCProfileCtx): Promise<KYCProfileCtx> => {
      const repo = data._repository as Repository<KYCProfile>;
      
      // Check if profile already exists
      const existing = await repo.findOne({ userId: input.userId, tenantId: input.tenantId });
      if (existing) {
        throw new GraphQLError(KYC_ERRORS.ProfileAlreadyExists, { userId: input.userId });
      }
      
      const profile = {
        userId: input.userId,
        tenantId: input.tenantId,
        currentTier: 'none' as const,
        status: 'pending' as const,
        riskLevel: 'low' as const,
        riskScore: 0,
        personalInfo: input.firstName ? {
          firstName: input.firstName,
          lastName: input.lastName || '',
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined as any,
          nationality: input.nationality || '',
          countryOfResidence: input.jurisdictionCode,
        } : undefined,
        addresses: [],
        verifications: [],
        documents: [],
        amlChecks: [],
        pepScreenings: [],
        sanctionScreenings: [],
        riskAssessments: [],
        providerReferences: [],
        jurisdictionCode: input.jurisdictionCode,
        isPEP: false,
        isHighRisk: false,
        requiresEnhancedDueDiligence: false,
        statusHistory: [],
      };
      
      const created = await repo.create(profile as any);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: KYCProfileCtx) => {
      if (entity) {
        const repo = data._repository as Repository<KYCProfile>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const kycProfileService = createService<KYCProfile, CreateKYCProfileInput>({
  name: 'kycProfile',
  entity: {
    name: 'kycProfile',
    collection: 'kyc_profiles',
    graphqlType: `
      type KYCProfile {
        id: ID!
        userId: String!
        tenantId: String!
        currentTier: String!
        status: String!
        riskLevel: String!
        riskScore: Float!
        personalInfo: KYCPersonalInfo
        jurisdictionCode: String!
        isPEP: Boolean!
        isHighRisk: Boolean!
        expiresAt: String
        lastVerifiedAt: String
        ${timestampFieldsOptionalSDL()}
      }

      type KYCPersonalInfo {
        firstName: String
        lastName: String
        middleName: String
        dateOfBirth: String
        nationality: String
        countryOfResidence: String
      }
      
      ${buildConnectionTypeSDL('KYCProfileConnection', 'KYCProfile')}
      ${buildSagaResultTypeSDL('CreateKYCProfileResult', 'kycProfile', 'KYCProfile')}
    `,
    graphqlInput: `input CreateKYCProfileInput { userId: String! tenantId: String! jurisdictionCode: String! firstName: String lastName: String dateOfBirth: String nationality: String }`,
    validateInput: (input) => {
      const result = createProfileSchema(input);
      return validateInput(result) as CreateKYCProfileInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, tenantId: 1 }, options: { unique: true } },
      { fields: { tenantId: 1 } },
      { fields: { status: 1, tenantId: 1 } },
      { fields: { currentTier: 1, tenantId: 1 } },
      { fields: { riskLevel: 1, tenantId: 1 } },
    ],
  },
  saga: kycProfileSaga,
});

// ═══════════════════════════════════════════════════════════════════
// KYC Document Service
// ═══════════════════════════════════════════════════════════════════

interface UploadDocumentInput {
  profileId: string;
  type: string;
  documentNumber?: string;
  issuingCountry?: string;
  expiresAt?: string;
}

type KYCDocumentCtx = SagaContext<KYCDocument, UploadDocumentInput>;

const uploadDocumentSchema = type({
  profileId: 'string',
  type: 'string',
  'documentNumber?': 'string',
  'issuingCountry?': 'string',
  'expiresAt?': 'string',
});

const kycDocumentSaga = [
  {
    name: 'uploadDocument',
    critical: true,
    execute: async ({ input, data, ...ctx }: KYCDocumentCtx): Promise<KYCDocumentCtx> => {
      const repo = data._repository as Repository<KYCDocument>;
      
      const document = {
        tenantId: 'default', // Will be overridden by context
        profileId: input.profileId,
        type: input.type as any,
        category: getDocumentCategory(input.type),
        documentNumber: input.documentNumber,
        issuingCountry: input.issuingCountry,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        files: [],
        status: 'pending' as const,
        uploadedAt: new Date(),
        uploadedBy: 'user',
      };
      
      const created = await repo.create(document as any);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: KYCDocumentCtx) => {
      if (entity) {
        const repo = data._repository as Repository<KYCDocument>;
        await repo.delete(entity.id);
      }
    },
  },
];

function getDocumentCategory(type: string): 'identity' | 'address' | 'financial' | 'corporate' | 'biometric' {
  const identityDocs = ['passport', 'national_id', 'drivers_license', 'residence_permit'];
  const addressDocs = ['utility_bill', 'bank_statement', 'government_letter', 'rental_agreement'];
  const biometricDocs = ['selfie', 'liveness_video'];
  
  if (identityDocs.includes(type)) return 'identity';
  if (addressDocs.includes(type)) return 'address';
  if (biometricDocs.includes(type)) return 'biometric';
  return 'financial';
}

export const kycDocumentService = createService<KYCDocument, UploadDocumentInput>({
  name: 'kycDocument',
  entity: {
    name: 'kycDocument',
    collection: 'kyc_documents',
    graphqlType: `
      type KYCDocument {
        id: ID!
        profileId: String!
        type: String!
        category: String!
        documentNumber: String
        issuingCountry: String
        status: String!
        expiresAt: String
        uploadedAt: String!
        verifiedAt: String
        rejectionReason: String
        ${timestampFieldsOptionalSDL()}
      }

      ${buildConnectionTypeSDL('KYCDocumentConnection', 'KYCDocument')}
      ${buildSagaResultTypeSDL('CreateKycDocumentResult', 'kycDocument', 'KYCDocument')}
    `,
    graphqlInput: `input UploadKYCDocumentInput { profileId: String! type: String! documentNumber: String issuingCountry: String expiresAt: String }`,
    validateInput: (input) => {
      const result = uploadDocumentSchema(input);
      return validateInput(result) as UploadDocumentInput | { errors: string[] };
    },
    indexes: [
      { fields: { profileId: 1 } },
      { fields: { profileId: 1, type: 1 } },
      { fields: { status: 1 } },
      { fields: { expiresAt: 1 } },
    ],
  },
  saga: kycDocumentSaga,
});

// ═══════════════════════════════════════════════════════════════════
// KYC Verification Service
// ═══════════════════════════════════════════════════════════════════

interface StartVerificationInput {
  profileId: string;
  targetTier: string;
  redirectUrl?: string;
}

type KYCVerificationCtx = SagaContext<KYCVerification, StartVerificationInput>;

const startVerificationSchema = type({
  profileId: 'string',
  targetTier: 'string',
  'redirectUrl?': 'string',
});

const kycVerificationSaga = [
  {
    name: 'startVerification',
    critical: true,
    execute: async ({ input, data, ...ctx }: KYCVerificationCtx): Promise<KYCVerificationCtx> => {
      const repo = data._repository as Repository<KYCVerification>;
      
      const verification = {
        tenantId: 'default', // Will be overridden by context
        profileId: input.profileId,
        targetTier: input.targetTier as KYCTier,
        fromTier: 'none' as KYCTier,
        status: 'pending' as const,
        requirements: [],
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        initiatedBy: 'user' as const,
      };
      
      const created = await repo.create(verification as any);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: KYCVerificationCtx) => {
      if (entity) {
        const repo = data._repository as Repository<KYCVerification>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const kycVerificationService = createService<KYCVerification, StartVerificationInput>({
  name: 'kycVerification',
  entity: {
    name: 'kycVerification',
    collection: 'kyc_verifications',
    graphqlType: `
      type KYCVerification {
        id: ID!
        profileId: String!
        targetTier: String!
        fromTier: String!
        status: String!
        startedAt: String!
        completedAt: String
        expiresAt: String!
        ${timestampFieldsOptionalSDL()}
      }

      ${buildConnectionTypeSDL('KYCVerificationConnection', 'KYCVerification')}
      ${buildSagaResultTypeSDL('CreateKycVerificationResult', 'kycVerification', 'KYCVerification')}
    `,
    graphqlInput: `input StartKYCVerificationInput { profileId: String! targetTier: String! redirectUrl: String }`,
    validateInput: (input) => {
      const result = startVerificationSchema(input);
      return validateInput(result) as StartVerificationInput | { errors: string[] };
    },
    indexes: [
      { fields: { profileId: 1 } },
      { fields: { profileId: 1, status: 1 } },
      { fields: { expiresAt: 1 } },
      { fields: { status: 1, expiresAt: 1 } },
    ],
  },
  saga: kycVerificationSaga,
});

// ═══════════════════════════════════════════════════════════════════
// Custom Types (SDL definitions for shared types)
// ═══════════════════════════════════════════════════════════════════

export const kycTypeDefs = `
  # KYC Tier enumeration
  enum KYCTier {
    none
    basic
    standard
    enhanced
    full
    professional
  }
  
  # KYC Status enumeration
  enum KYCStatus {
    pending
    in_review
    approved
    rejected
    expired
    suspended
    manual_review
  }
  
  # Risk Level enumeration
  enum RiskLevel {
    low
    medium
    high
    critical
  }
  
  # Transaction limits
  type TransactionLimits {
    currency: String!
    deposit: OperationLimits
    withdrawal: OperationLimits
    maxBalance: Float
  }
  
  type OperationLimits {
    minAmount: Float
    maxAmount: Float!
    dailyLimit: Float!
    monthlyLimit: Float!
  }
  
  # Eligibility check result
  type KYCEligibility {
    currentTier: String!
    currentStatus: String!
    meetsRequirement: Boolean!
    requiredTier: String
    missingRequirements: [String!]
    upgradeUrl: String
    isExpiringSoon: Boolean
    expiresAt: String
  }
  
  # Transaction limit check result
  type TransactionLimitCheck {
    allowed: Boolean!
    reason: String
    limits: OperationLimits
    requiredTier: String
    requiresAdditionalVerification: Boolean
    upgradeUrl: String
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Custom Resolvers (for queries not covered by createService)
// ═══════════════════════════════════════════════════════════════════

export const kycCustomResolvers = {
  Query: {
    // Custom query implementations will be added here
  },
  Mutation: {
    // Custom mutation implementations will be added here  
  },
};
