/**
 * KYC Service GraphQL Schema & Resolvers
 */

import { 
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLInputObjectType,
  GraphQLEnumType,
  GraphQLSchema,
} from 'graphql';
import {
  isAuthenticated,
  hasRole,
  GraphQLError,
  getUserId,
  getTenantId,
  logger,
} from 'core-service';
import type { ResolverContext } from 'core-service';

import { kycEngine } from './services/kyc-engine/engine.js';
import { getTierDisplayName, getTierDescription, getTierLimits } from './services/kyc-engine/tier-config.js';
import { kycRepository } from './repositories/kyc-repository.js';
import { documentRepository } from './repositories/document-repository.js';
import { verificationRepository } from './repositories/verification-repository.js';
import { KYC_ERRORS } from './error-codes.js';
import type { KYCTier, KYCStatus, DocumentType } from './types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════

const KYCTierEnum = new GraphQLEnumType({
  name: 'KYCTier',
  values: {
    none: { value: 'none' },
    basic: { value: 'basic' },
    standard: { value: 'standard' },
    enhanced: { value: 'enhanced' },
    full: { value: 'full' },
    professional: { value: 'professional' },
  },
});

const KYCStatusEnum = new GraphQLEnumType({
  name: 'KYCStatus',
  values: {
    pending: { value: 'pending' },
    in_review: { value: 'in_review' },
    approved: { value: 'approved' },
    rejected: { value: 'rejected' },
    expired: { value: 'expired' },
    suspended: { value: 'suspended' },
    manual_review: { value: 'manual_review' },
  },
});

const RiskLevelEnum = new GraphQLEnumType({
  name: 'RiskLevel',
  values: {
    low: { value: 'low' },
    medium: { value: 'medium' },
    high: { value: 'high' },
    critical: { value: 'critical' },
  },
});

const DocumentTypeEnum = new GraphQLEnumType({
  name: 'DocumentType',
  values: {
    passport: { value: 'passport' },
    national_id: { value: 'national_id' },
    drivers_license: { value: 'drivers_license' },
    utility_bill: { value: 'utility_bill' },
    bank_statement: { value: 'bank_statement' },
    selfie: { value: 'selfie' },
    other: { value: 'other' },
  },
});

const DocumentStatusEnum = new GraphQLEnumType({
  name: 'DocumentStatus',
  values: {
    pending: { value: 'pending' },
    processing: { value: 'processing' },
    verified: { value: 'verified' },
    rejected: { value: 'rejected' },
    expired: { value: 'expired' },
  },
});

const VerificationStatusEnum = new GraphQLEnumType({
  name: 'VerificationStatus',
  values: {
    pending: { value: 'pending' },
    in_progress: { value: 'in_progress' },
    completed: { value: 'completed' },
    failed: { value: 'failed' },
    expired: { value: 'expired' },
    cancelled: { value: 'cancelled' },
  },
});

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

const PersonalInfoType = new GraphQLObjectType({
  name: 'PersonalInfo',
  fields: {
    firstName: { type: GraphQLString },
    lastName: { type: GraphQLString },
    middleName: { type: GraphQLString },
    dateOfBirth: { type: GraphQLString },
    nationality: { type: GraphQLString },
    countryOfResidence: { type: GraphQLString },
    occupation: { type: GraphQLString },
  },
});

const KYCAddressType = new GraphQLObjectType({
  name: 'KYCAddress',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(GraphQLString) },
    line1: { type: new GraphQLNonNull(GraphQLString) },
    line2: { type: GraphQLString },
    city: { type: new GraphQLNonNull(GraphQLString) },
    state: { type: GraphQLString },
    postalCode: { type: new GraphQLNonNull(GraphQLString) },
    country: { type: new GraphQLNonNull(GraphQLString) },
    isPrimary: { type: new GraphQLNonNull(GraphQLBoolean) },
    isVerified: { type: new GraphQLNonNull(GraphQLBoolean) },
    verifiedAt: { type: GraphQLString },
  },
});

const DocumentFileType = new GraphQLObjectType({
  name: 'DocumentFile',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    filename: { type: new GraphQLNonNull(GraphQLString) },
    mimeType: { type: new GraphQLNonNull(GraphQLString) },
    size: { type: new GraphQLNonNull(GraphQLInt) },
    uploadedAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const KYCDocumentType = new GraphQLObjectType({
  name: 'KYCDocument',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    profileId: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(DocumentTypeEnum) },
    category: { type: new GraphQLNonNull(GraphQLString) },
    documentNumber: { type: GraphQLString },
    issuingCountry: { type: GraphQLString },
    issuedAt: { type: GraphQLString },
    expiresAt: { type: GraphQLString },
    files: { type: new GraphQLList(DocumentFileType) },
    status: { type: new GraphQLNonNull(DocumentStatusEnum) },
    verifiedAt: { type: GraphQLString },
    rejectionReason: { type: GraphQLString },
    uploadedAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const VerificationRequirementType = new GraphQLObjectType({
  name: 'VerificationRequirement',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    status: { type: new GraphQLNonNull(GraphQLString) },
    satisfiedBy: { type: GraphQLString },
    satisfiedAt: { type: GraphQLString },
    optional: { type: new GraphQLNonNull(GraphQLBoolean) },
  },
});

const ProviderSessionType = new GraphQLObjectType({
  name: 'ProviderSession',
  fields: {
    provider: { type: new GraphQLNonNull(GraphQLString) },
    sessionId: { type: new GraphQLNonNull(GraphQLString) },
    sessionUrl: { type: GraphQLString },
    sdkToken: { type: GraphQLString },
    expiresAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const VerificationResultType = new GraphQLObjectType({
  name: 'VerificationResult',
  fields: {
    decision: { type: new GraphQLNonNull(GraphQLString) },
    reasons: { type: new GraphQLList(GraphQLString) },
    newTier: { type: KYCTierEnum },
    canRetry: { type: GraphQLBoolean },
    overriddenBy: { type: GraphQLString },
    overrideReason: { type: GraphQLString },
  },
});

const KYCVerificationType = new GraphQLObjectType({
  name: 'KYCVerification',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    profileId: { type: new GraphQLNonNull(GraphQLString) },
    targetTier: { type: new GraphQLNonNull(KYCTierEnum) },
    fromTier: { type: new GraphQLNonNull(KYCTierEnum) },
    status: { type: new GraphQLNonNull(VerificationStatusEnum) },
    requirements: { type: new GraphQLList(VerificationRequirementType) },
    providerSession: { type: ProviderSessionType },
    result: { type: VerificationResultType },
    startedAt: { type: new GraphQLNonNull(GraphQLString) },
    completedAt: { type: GraphQLString },
    expiresAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const OperationLimitsType = new GraphQLObjectType({
  name: 'OperationLimits',
  fields: {
    minAmount: { type: GraphQLFloat },
    maxAmount: { type: new GraphQLNonNull(GraphQLFloat) },
    dailyLimit: { type: new GraphQLNonNull(GraphQLFloat) },
    weeklyLimit: { type: GraphQLFloat },
    monthlyLimit: { type: new GraphQLNonNull(GraphQLFloat) },
  },
});

const TransactionLimitsType = new GraphQLObjectType({
  name: 'TransactionLimits',
  fields: {
    currency: { type: new GraphQLNonNull(GraphQLString) },
    deposit: { type: OperationLimitsType },
    withdrawal: { type: OperationLimitsType },
    transfer: { type: OperationLimitsType },
    maxBalance: { type: GraphQLFloat },
  },
});

const KYCProfileType = new GraphQLObjectType({
  name: 'KYCProfile',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    tenantId: { type: new GraphQLNonNull(GraphQLString) },
    currentTier: { type: new GraphQLNonNull(KYCTierEnum) },
    currentTierDisplayName: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (profile) => getTierDisplayName(profile.currentTier),
    },
    currentTierDescription: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (profile) => getTierDescription(profile.currentTier),
    },
    status: { type: new GraphQLNonNull(KYCStatusEnum) },
    riskLevel: { type: new GraphQLNonNull(RiskLevelEnum) },
    riskScore: { type: new GraphQLNonNull(GraphQLFloat) },
    personalInfo: { type: PersonalInfoType },
    addresses: { type: new GraphQLList(KYCAddressType) },
    documents: {
      type: new GraphQLList(KYCDocumentType),
      resolve: async (profile) => {
        return documentRepository.findByProfileId(profile.id);
      },
    },
    verifications: {
      type: new GraphQLList(KYCVerificationType),
      resolve: async (profile) => {
        return verificationRepository.findByProfileId(profile.id);
      },
    },
    currentVerification: {
      type: KYCVerificationType,
      resolve: async (profile) => {
        return verificationRepository.findActiveForProfile(profile.id);
      },
    },
    limits: {
      type: TransactionLimitsType,
      resolve: async (profile) => {
        return getTierLimits(profile.currentTier, profile.jurisdictionCode);
      },
    },
    isPEP: { type: new GraphQLNonNull(GraphQLBoolean) },
    isHighRisk: { type: new GraphQLNonNull(GraphQLBoolean) },
    jurisdictionCode: { type: new GraphQLNonNull(GraphQLString) },
    expiresAt: { type: GraphQLString },
    lastVerifiedAt: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const TransactionLimitCheckType = new GraphQLObjectType({
  name: 'TransactionLimitCheck',
  fields: {
    allowed: { type: new GraphQLNonNull(GraphQLBoolean) },
    reason: { type: GraphQLString },
    limits: { type: OperationLimitsType },
    requiredTier: { type: KYCTierEnum },
    requiresAdditionalVerification: { type: GraphQLBoolean },
    upgradeUrl: { type: GraphQLString },
  },
});

const KYCEligibilityType = new GraphQLObjectType({
  name: 'KYCEligibility',
  fields: {
    currentTier: { type: new GraphQLNonNull(KYCTierEnum) },
    currentStatus: { type: new GraphQLNonNull(KYCStatusEnum) },
    meetsRequirement: { type: new GraphQLNonNull(GraphQLBoolean) },
    requiredTier: { type: KYCTierEnum },
    missingRequirements: { type: new GraphQLList(GraphQLString) },
    upgradeUrl: { type: GraphQLString },
    isExpiringSoon: { type: GraphQLBoolean },
    expiresAt: { type: GraphQLString },
  },
});

const TierInfoType = new GraphQLObjectType({
  name: 'TierInfo',
  fields: {
    tier: { type: new GraphQLNonNull(KYCTierEnum) },
    displayName: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
    limits: { type: TransactionLimitsType },
  },
});

// ═══════════════════════════════════════════════════════════════════
// Input Types
// ═══════════════════════════════════════════════════════════════════

const PersonalInfoInput = new GraphQLInputObjectType({
  name: 'PersonalInfoInput',
  fields: {
    firstName: { type: GraphQLString },
    lastName: { type: GraphQLString },
    middleName: { type: GraphQLString },
    dateOfBirth: { type: GraphQLString },
    nationality: { type: GraphQLString },
    countryOfResidence: { type: GraphQLString },
    occupation: { type: GraphQLString },
  },
});

const AddressInput = new GraphQLInputObjectType({
  name: 'KYCAddressInput',
  fields: {
    type: { type: new GraphQLNonNull(GraphQLString) },
    line1: { type: new GraphQLNonNull(GraphQLString) },
    line2: { type: GraphQLString },
    city: { type: new GraphQLNonNull(GraphQLString) },
    state: { type: GraphQLString },
    postalCode: { type: new GraphQLNonNull(GraphQLString) },
    country: { type: new GraphQLNonNull(GraphQLString) },
    isPrimary: { type: GraphQLBoolean },
  },
});

const StartVerificationInput = new GraphQLInputObjectType({
  name: 'StartVerificationInput',
  fields: {
    targetTier: { type: new GraphQLNonNull(KYCTierEnum) },
    redirectUrl: { type: GraphQLString },
    preferredProvider: { type: GraphQLString },
  },
});

const UpdatePersonalInfoInput = new GraphQLInputObjectType({
  name: 'UpdatePersonalInfoInput',
  fields: {
    personalInfo: { type: new GraphQLNonNull(PersonalInfoInput) },
  },
});

const ApproveVerificationInput = new GraphQLInputObjectType({
  name: 'ApproveVerificationInput',
  fields: {
    verificationId: { type: new GraphQLNonNull(GraphQLString) },
    notes: { type: GraphQLString },
    overrideTier: { type: KYCTierEnum },
  },
});

const RejectVerificationInput = new GraphQLInputObjectType({
  name: 'RejectVerificationInput',
  fields: {
    verificationId: { type: new GraphQLNonNull(GraphQLString) },
    reason: { type: new GraphQLNonNull(GraphQLString) },
    canRetry: { type: GraphQLBoolean },
  },
});

// ═══════════════════════════════════════════════════════════════════
// Queries
// ═══════════════════════════════════════════════════════════════════

const queryFields = {
  // User queries
  myKYCProfile: {
    type: KYCProfileType,
    resolve: async (_: unknown, __: unknown, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycRepository.findByUserId(userId, tenantId);
    },
  },
  
  myKYCLimits: {
    type: TransactionLimitsType,
    resolve: async (_: unknown, __: unknown, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      const profile = await kycRepository.findByUserId(userId, tenantId);
      const tier = profile?.currentTier ?? 'none';
      const jurisdiction = profile?.jurisdictionCode ?? 'US';
      return getTierLimits(tier, jurisdiction);
    },
  },
  
  checkKYCEligibility: {
    type: new GraphQLNonNull(KYCEligibilityType),
    args: {
      requiredTier: { type: new GraphQLNonNull(KYCTierEnum) },
    },
    resolve: async (_: unknown, args: { requiredTier: KYCTier }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.checkEligibility(userId, tenantId, args.requiredTier);
    },
  },
  
  checkTransactionLimit: {
    type: new GraphQLNonNull(TransactionLimitCheckType),
    args: {
      type: { type: new GraphQLNonNull(GraphQLString) },
      amount: { type: new GraphQLNonNull(GraphQLFloat) },
      currency: { type: new GraphQLNonNull(GraphQLString) },
    },
    resolve: async (_: unknown, args: { type: string; amount: number; currency: string }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.checkTransactionLimit(
        userId,
        tenantId,
        args.type as 'deposit' | 'withdrawal' | 'transfer',
        args.amount,
        args.currency
      );
    },
  },
  
  tierInfo: {
    type: new GraphQLList(TierInfoType),
    resolve: async () => {
      const tiers: KYCTier[] = ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'];
      return Promise.all(tiers.map(async (tier) => ({
        tier,
        displayName: getTierDisplayName(tier),
        description: getTierDescription(tier),
        limits: await getTierLimits(tier, 'US'),
      })));
    },
  },
  
  // Admin queries
  kycProfile: {
    type: KYCProfileType,
    args: {
      userId: { type: new GraphQLNonNull(GraphQLString) },
    },
    resolve: async (_: unknown, args: { userId: string }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const tenantId = getTenantId(ctx);
      return kycRepository.findByUserId(args.userId, tenantId);
    },
  },
  
  pendingVerifications: {
    type: new GraphQLList(KYCVerificationType),
    args: {
      limit: { type: GraphQLInt },
    },
    resolve: async (_: unknown, args: { limit?: number }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      return verificationRepository.findPendingManualReviews(args.limit ?? 50);
    },
  },
  
  highRiskProfiles: {
    type: new GraphQLList(KYCProfileType),
    args: {
      limit: { type: GraphQLInt },
    },
    resolve: async (_: unknown, args: { limit?: number }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const tenantId = getTenantId(ctx);
      return kycRepository.findHighRiskProfiles(tenantId, args.limit ?? 50);
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════════

const mutationFields = {
  // User mutations
  startKYCVerification: {
    type: new GraphQLNonNull(KYCVerificationType),
    args: {
      input: { type: new GraphQLNonNull(StartVerificationInput) },
    },
    resolve: async (_: unknown, args: { input: any }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.startVerification(args.input, userId, tenantId);
    },
  },
  
  updateKYCPersonalInfo: {
    type: new GraphQLNonNull(KYCProfileType),
    args: {
      input: { type: new GraphQLNonNull(UpdatePersonalInfoInput) },
    },
    resolve: async (_: unknown, args: { input: any }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.updatePersonalInfo(args.input, userId, tenantId);
    },
  },
  
  addKYCAddress: {
    type: new GraphQLNonNull(KYCProfileType),
    args: {
      input: { type: new GraphQLNonNull(AddressInput) },
    },
    resolve: async (_: unknown, args: { input: any }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx)) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.addAddress({ address: args.input }, userId, tenantId);
    },
  },
  
  // Admin mutations
  approveKYCVerification: {
    type: new GraphQLNonNull(KYCVerificationType),
    args: {
      input: { type: new GraphQLNonNull(ApproveVerificationInput) },
    },
    resolve: async (_: unknown, args: { input: any }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      return kycEngine.approveVerification(
        args.input.verificationId,
        userId,
        args.input.notes,
        args.input.overrideTier
      );
    },
  },
  
  rejectKYCVerification: {
    type: new GraphQLNonNull(KYCVerificationType),
    args: {
      input: { type: new GraphQLNonNull(RejectVerificationInput) },
    },
    resolve: async (_: unknown, args: { input: any }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      const userId = getUserId(ctx);
      return kycEngine.rejectVerification(
        args.input.verificationId,
        userId,
        args.input.reason,
        args.input.canRetry ?? true
      );
    },
  },
  
  triggerKYCRiskAssessment: {
    type: new GraphQLNonNull(GraphQLBoolean),
    args: {
      profileId: { type: new GraphQLNonNull(GraphQLString) },
    },
    resolve: async (_: unknown, args: { profileId: string }, ctx: ResolverContext) => {
      if (!isAuthenticated(ctx) || !hasRole(ctx, 'system')) {
        throw new GraphQLError(KYC_ERRORS.OperationNotAllowed);
      }
      await kycEngine.assessRisk(args.profileId);
      return true;
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// Schema Export
// ═══════════════════════════════════════════════════════════════════

export const kycTypes = `
  enum KYCTier {
    none
    basic
    standard
    enhanced
    full
    professional
  }
  
  enum KYCStatus {
    pending
    in_review
    approved
    rejected
    expired
    suspended
    manual_review
  }
  
  enum RiskLevel {
    low
    medium
    high
    critical
  }
`;

export const kycQueryType = new GraphQLObjectType({
  name: 'KYCQuery',
  fields: queryFields,
});

export const kycMutationType = new GraphQLObjectType({
  name: 'KYCMutation',
  fields: mutationFields,
});

export const kycService = {
  name: 'kyc',
  types: kycTypes,
  queries: queryFields,
  mutations: mutationFields,
};
