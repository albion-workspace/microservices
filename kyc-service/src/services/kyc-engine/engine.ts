/**
 * KYC Engine
 * 
 * Core orchestration for KYC verification flows
 */

import { 
  logger, 
  generateId,
  GraphQLError,
  emit,
  type WriteOptions,
} from 'core-service';

import { kycRepository } from '../../repositories/kyc-repository.js';
import { documentRepository } from '../../repositories/document-repository.js';
import { verificationRepository } from '../../repositories/verification-repository.js';
import { getProviderOrDefault, getDefaultProvider } from '../../providers/provider-factory.js';
import { KYC_ERRORS } from '../../error-codes.js';

import type {
  KYCProfile,
  KYCTier,
  KYCStatus,
  KYCVerification,
  KYCDocument,
  VerificationRequirement,
  CreateKYCProfileInput,
  StartVerificationInput,
  UploadDocumentInput,
  UpdatePersonalInfoInput,
  AddAddressInput,
  KYCAddress,
  TransactionLimitCheck,
  KYCEligibility,
  DocumentFile,
  DocumentCategory,
} from '../../types/kyc-types.js';
import type { TierRequirements, TransactionLimits } from '../../types/jurisdiction-config.js';

import { buildTierRequirements, getTierLimits } from './tier-config.js';
import { calculateRiskScore } from './risk-calculator.js';

// ═══════════════════════════════════════════════════════════════════
// KYC Engine
// ═══════════════════════════════════════════════════════════════════

export class KYCEngine {
  // ───────────────────────────────────────────────────────────────────
  // Profile Management
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create or get existing KYC profile for user
   */
  async getOrCreateProfile(
    userId: string,
    tenantId: string,
    jurisdictionCode: string,
    options?: WriteOptions
  ): Promise<KYCProfile> {
    // Try to find existing
    let profile = await kycRepository.findByUserId(userId, tenantId, options);
    
    if (!profile) {
      // Create new profile using domain-specific method with defaults
      profile = await kycRepository.createProfile({
        userId,
        tenantId,
        jurisdictionCode,
      }, options);
      
      // Emit event
      await emit('kyc.profile.created', tenantId, userId, {
        profileId: profile.id,
        jurisdictionCode,
      });
    }
    
    return profile;
  }
  
  /**
   * Get profile by ID
   */
  async getProfile(profileId: string, options?: WriteOptions): Promise<KYCProfile | null> {
    return kycRepository.findById(profileId, options);
  }
  
  /**
   * Get profile by user ID
   */
  async getProfileByUserId(
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    return kycRepository.findByUserId(userId, tenantId, options);
  }
  
  /**
   * Update personal information
   */
  async updatePersonalInfo(
    input: UpdatePersonalInfoInput,
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<KYCProfile> {
    const profile = input.profileId
      ? await kycRepository.findById(input.profileId, options)
      : await kycRepository.findByUserId(userId, tenantId, options);
    
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    // Merge personal info
    const updatedPersonalInfo = {
      ...profile.personalInfo,
      ...input.personalInfo,
    };
    
    const updated = await kycRepository.update(profile.id, {
      personalInfo: updatedPersonalInfo as KYCProfile['personalInfo'],
    }, options);
    
    if (!updated) {
      throw new GraphQLError(KYC_ERRORS.InternalError);
    }
    
    logger.info('KYC personal info updated', {
      profileId: profile.id,
      userId: profile.userId,
    });
    
    return updated;
  }
  
  /**
   * Add address to profile
   */
  async addAddress(
    input: AddAddressInput,
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<KYCProfile> {
    const profile = input.profileId
      ? await kycRepository.findById(input.profileId, options)
      : await kycRepository.findByUserId(userId, tenantId, options);
    
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    const address: KYCAddress = {
      id: generateId(),
      ...input.address,
      isVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    const updated = await kycRepository.addAddress(profile.id, address, options);
    
    if (!updated) {
      throw new GraphQLError(KYC_ERRORS.InternalError);
    }
    
    return updated;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Verification Flow
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Start a verification flow
   */
  async startVerification(
    input: StartVerificationInput,
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<KYCVerification> {
    // Get or create profile
    const profile = await this.getOrCreateProfile(userId, tenantId, 'US', options); // Default to US
    
    // Check if there's already an active verification
    const activeVerification = await verificationRepository.findActiveForProfile(profile.id, options);
    if (activeVerification) {
      throw new GraphQLError(KYC_ERRORS.VerificationAlreadyInProgress, {
        verificationId: activeVerification.id,
      });
    }
    
    // Validate tier upgrade
    const { targetTier } = input;
    if (!this.canUpgradeToTier(profile.currentTier, targetTier)) {
      throw new GraphQLError(KYC_ERRORS.TierUpgradeNotAllowed, {
        currentTier: profile.currentTier,
        targetTier,
      });
    }
    
    // Build requirements for target tier
    const requirements = await buildTierRequirements(targetTier, profile.jurisdictionCode);
    
    // Create verification record
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    const verification = await verificationRepository.createVerification({
      profileId: profile.id,
      targetTier,
      fromTier: profile.currentTier,
      requirements,
      expiresAt,
      initiatedBy: 'user',
      initiatedByUserId: userId,
    }, options);
    
    // Create provider session
    const provider = getProviderOrDefault(input.preferredProvider);
    
    // Ensure applicant exists in provider
    let applicantId = profile.providerReferences.find(r => r.provider === provider.name)?.applicantId;
    
    if (!applicantId) {
      const result = await provider.createApplicant({
        externalUserId: userId,
        firstName: profile.personalInfo?.firstName,
        lastName: profile.personalInfo?.lastName,
        email: profile.personalInfo?.email,
        dateOfBirth: profile.personalInfo?.dateOfBirth,
        nationality: profile.personalInfo?.nationality,
      });
      
      applicantId = result.applicantId;
      
      // Save provider reference
      await kycRepository.addProviderReference(profile.id, {
        provider: provider.name,
        externalId: result.applicantId,
        applicantId: result.applicantId,
        createdAt: new Date(),
      }, options);
    }
    
    // Create provider verification session
    const providerSession = await provider.createVerificationSession({
      applicantId,
      level: targetTier,
      redirectUrl: input.redirectUrl,
    });
    
    // Update verification with provider session
    await verificationRepository.setProviderSession(verification.id, {
      provider: provider.name,
      sessionId: providerSession.sessionId,
      applicantId,
      sessionUrl: providerSession.sessionUrl,
      sdkToken: providerSession.sdkToken,
      expiresAt: providerSession.expiresAt,
      webhookReceived: false,
    }, options);
    
    // Emit event
    await emit('kyc.verification.started', tenantId, userId, {
      verificationId: verification.id,
      profileId: profile.id,
      targetTier,
      sessionUrl: providerSession.sessionUrl,
    });
    
    logger.info('KYC verification started', {
      verificationId: verification.id,
      profileId: profile.id,
      targetTier,
      provider: provider.name,
    });
    
    // Return updated verification
    return (await verificationRepository.findById(verification.id, options))!;
  }
  
  /**
   * Process verification completion (from webhook)
   */
  async processVerificationComplete(
    sessionId: string,
    decision: 'approved' | 'rejected' | 'manual_review',
    providerData?: Record<string, unknown>
  ): Promise<KYCVerification> {
    // Find verification by session
    const verification = await verificationRepository.findBySessionId(sessionId);
    if (!verification) {
      throw new GraphQLError(KYC_ERRORS.VerificationNotFound);
    }
    
    const profile = await kycRepository.findById(verification.profileId);
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    // Mark webhook received
    await verificationRepository.markWebhookReceived(verification.id);
    
    // Set result
    const result = {
      decision,
      reasons: providerData?.reasons as string[] ?? [],
      newTier: decision === 'approved' ? verification.targetTier : undefined,
      canRetry: decision === 'rejected',
      providerDecision: providerData?.decision as string,
      providerReasons: providerData?.reasons as string[],
    };
    
    await verificationRepository.setResult(verification.id, result);
    
    // If approved, upgrade tier
    if (decision === 'approved') {
      await kycRepository.updateTier(
        profile.id,
        verification.targetTier,
        'Verification approved'
      );
      
      // Update status
      await kycRepository.updateStatus(
        profile.id,
        'approved',
        'Verification completed',
        'provider'
      );
      
      // Calculate expiry
      const tierExpiry = await this.getTierExpiry(verification.targetTier);
      if (tierExpiry) {
        const expiresAt = new Date(Date.now() + tierExpiry * 24 * 60 * 60 * 1000);
        await kycRepository.setExpiration(profile.id, expiresAt);
      }
      
      // Emit tier upgrade event
      await emit('kyc.tier.upgraded', profile.tenantId, profile.userId, {
        profileId: profile.id,
        previousTier: verification.fromTier,
        newTier: verification.targetTier,
      });
    } else if (decision === 'rejected') {
      await kycRepository.updateStatus(
        profile.id,
        'rejected',
        result.reasons.join(', ') || 'Verification rejected',
        'provider'
      );
      
      // Emit rejection event
      await emit('kyc.verification.rejected', profile.tenantId, profile.userId, {
        profileId: profile.id,
        verificationId: verification.id,
        reasons: result.reasons,
      });
    }
    
    // Emit completion event
    await emit('kyc.verification.completed', profile.tenantId, profile.userId, {
      verificationId: verification.id,
      profileId: profile.id,
      decision,
      newTier: result.newTier,
    });
    
    logger.info('KYC verification completed', {
      verificationId: verification.id,
      profileId: profile.id,
      decision,
      newTier: result.newTier,
    });
    
    return (await verificationRepository.findById(verification.id))!;
  }
  
  /**
   * Admin approve verification
   */
  async approveVerification(
    verificationId: string,
    adminUserId: string,
    notes?: string,
    overrideTier?: KYCTier
  ): Promise<KYCVerification> {
    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new GraphQLError(KYC_ERRORS.VerificationNotFound);
    }
    
    if (verification.status === 'completed') {
      throw new GraphQLError(KYC_ERRORS.OperationNotAllowed, {
        reason: 'Verification already completed',
      });
    }
    
    const profile = await kycRepository.findById(verification.profileId);
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    const newTier = overrideTier ?? verification.targetTier;
    
    // Set result with override
    await verificationRepository.setResult(verificationId, {
      decision: 'approved',
      reasons: ['Manually approved by admin'],
      newTier,
      overriddenBy: adminUserId,
      overrideReason: notes ?? 'Admin approval',
      overriddenAt: new Date(),
      canRetry: false,
    });
    
    // Update tier
    await kycRepository.updateTier(profile.id, newTier, 'Admin approval');
    await kycRepository.updateStatus(profile.id, 'approved', 'Admin approval', 'admin');
    
    // Emit events
    await emit('kyc.tier.upgraded', profile.tenantId, profile.userId, {
      profileId: profile.id,
      previousTier: verification.fromTier,
      newTier,
      approvedBy: adminUserId,
    });
    
    logger.info('KYC verification approved by admin', {
      verificationId,
      profileId: profile.id,
      newTier,
      approvedBy: adminUserId,
    });
    
    return (await verificationRepository.findById(verificationId))!;
  }
  
  /**
   * Admin reject verification
   */
  async rejectVerification(
    verificationId: string,
    adminUserId: string,
    reason: string,
    canRetry: boolean = true
  ): Promise<KYCVerification> {
    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new GraphQLError(KYC_ERRORS.VerificationNotFound);
    }
    
    const profile = await kycRepository.findById(verification.profileId);
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    // Set result
    await verificationRepository.setResult(verificationId, {
      decision: 'rejected',
      reasons: [reason],
      canRetry,
      overriddenBy: adminUserId,
      overrideReason: reason,
      overriddenAt: new Date(),
    });
    
    // Update status
    await kycRepository.updateStatus(profile.id, 'rejected', reason, 'admin');
    
    logger.info('KYC verification rejected by admin', {
      verificationId,
      profileId: profile.id,
      reason,
      rejectedBy: adminUserId,
    });
    
    return (await verificationRepository.findById(verificationId))!;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Document Management
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Upload a document
   */
  async uploadDocument(
    input: UploadDocumentInput,
    userId: string,
    tenantId: string,
    options?: WriteOptions
  ): Promise<KYCDocument> {
    const profile = input.profileId
      ? await kycRepository.findById(input.profileId, options)
      : await kycRepository.findByUserId(userId, tenantId, options);
    
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    // Determine category
    const category = this.getDocumentCategory(input.type);
    
    // Create document files
    const files: DocumentFile[] = input.files.map((file, index) => ({
      id: generateId(),
      filename: `${profile.id}_${input.type}_${index}_${Date.now()}`,
      originalFilename: file.filename,
      mimeType: file.mimeType,
      size: typeof file.data === 'string' ? file.data.length : file.data.byteLength,
      storageRef: `kyc-documents/${profile.tenantId}/${profile.id}/${generateId()}`,
      checksum: '', // TODO: Calculate checksum
      checksumAlgorithm: 'sha256',
      uploadedAt: new Date(),
    }));
    
    // Create document record using domain-specific method
    const document = await documentRepository.createDocument({
      tenantId: profile.tenantId,
      profileId: profile.id,
      type: input.type,
      category,
      files,
      documentNumber: input.documentNumber,
      issuingCountry: input.issuingCountry,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      uploadedBy: userId,
    }, options);
    
    // TODO: Upload files to storage
    // TODO: Upload to provider
    
    // Emit event
    await emit('kyc.document.uploaded', tenantId, userId, {
      documentId: document.id,
      profileId: profile.id,
      type: input.type,
    });
    
    logger.info('KYC document uploaded', {
      documentId: document.id,
      profileId: profile.id,
      type: input.type,
    });
    
    return document;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Limit Checking
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check transaction against KYC limits
   */
  async checkTransactionLimit(
    userId: string,
    tenantId: string,
    type: 'deposit' | 'withdrawal' | 'transfer',
    amount: number,
    currency: string
  ): Promise<TransactionLimitCheck> {
    const profile = await kycRepository.findByUserId(userId, tenantId);
    
    if (!profile) {
      return {
        allowed: false,
        reason: 'KYC profile not found',
        requiredTier: 'basic',
      };
    }
    
    // Check status
    if (profile.status !== 'approved' && profile.currentTier !== 'none') {
      return {
        allowed: false,
        reason: `KYC status is ${profile.status}`,
      };
    }
    
    // Check expiry
    if (profile.expiresAt && profile.expiresAt < new Date()) {
      return {
        allowed: false,
        reason: 'KYC verification has expired',
        requiresAdditionalVerification: true,
      };
    }
    
    // Get limits for current tier
    const limits = await getTierLimits(profile.currentTier, profile.jurisdictionCode);
    const operationLimits = limits[type];
    
    if (!operationLimits) {
      return {
        allowed: false,
        reason: `${type} not allowed for current tier`,
        requiredTier: 'standard',
      };
    }
    
    // Check single amount
    if (amount > operationLimits.maxAmount) {
      // Find required tier for this amount
      const requiredTier = await this.findTierForAmount(amount, type, profile.jurisdictionCode);
      
      return {
        allowed: false,
        reason: `Amount exceeds single transaction limit (${operationLimits.maxAmount})`,
        limits: operationLimits as any,
        requiredTier,
      };
    }
    
    // TODO: Check daily/monthly limits against actual usage
    
    return {
      allowed: true,
      limits: operationLimits as any,
    };
  }
  
  /**
   * Check eligibility for a required tier
   */
  async checkEligibility(
    userId: string,
    tenantId: string,
    requiredTier: KYCTier
  ): Promise<KYCEligibility> {
    const profile = await kycRepository.findByUserId(userId, tenantId);
    
    if (!profile) {
      return {
        currentTier: 'none',
        currentStatus: 'pending',
        meetsRequirement: false,
        requiredTier,
        missingRequirements: ['KYC profile not found'],
        upgradeUrl: '/kyc/start',
      };
    }
    
    const tierOrder: KYCTier[] = ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'];
    const currentIndex = tierOrder.indexOf(profile.currentTier);
    const requiredIndex = tierOrder.indexOf(requiredTier);
    
    const meetsRequirement = currentIndex >= requiredIndex && profile.status === 'approved';
    
    return {
      currentTier: profile.currentTier,
      currentStatus: profile.status,
      meetsRequirement,
      requiredTier: meetsRequirement ? undefined : requiredTier,
      upgradeUrl: meetsRequirement ? undefined : `/kyc/upgrade?tier=${requiredTier}`,
      isExpiringSoon: profile.expiresAt 
        ? profile.expiresAt.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000 
        : false,
      expiresAt: profile.expiresAt,
    };
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Risk Assessment
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Trigger risk assessment for profile
   */
  async assessRisk(profileId: string): Promise<void> {
    const profile = await kycRepository.findById(profileId);
    if (!profile) {
      throw new GraphQLError(KYC_ERRORS.ProfileNotFound);
    }
    
    const assessment = await calculateRiskScore(profile);
    
    // Update profile
    await kycRepository.updateRiskLevel(profile.id, assessment.level, assessment.score);
    
    // Emit event if risk elevated
    if (assessment.level === 'high' || assessment.level === 'critical') {
      await emit('kyc.risk.elevated', profile.tenantId, profile.userId, {
        profileId: profile.id,
        riskLevel: assessment.level,
        riskScore: assessment.score,
      });
    }
    
    logger.info('KYC risk assessment completed', {
      profileId: profile.id,
      riskLevel: assessment.level,
      riskScore: assessment.score,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private canUpgradeToTier(currentTier: KYCTier, targetTier: KYCTier): boolean {
    const tierOrder: KYCTier[] = ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const targetIndex = tierOrder.indexOf(targetTier);
    
    // Can only upgrade to next tier or skip to higher
    return targetIndex > currentIndex;
  }
  
  private getDocumentCategory(type: string): DocumentCategory {
    const identityDocs = ['passport', 'national_id', 'drivers_license', 'residence_permit', 'visa'];
    const addressDocs = ['utility_bill', 'bank_statement', 'tax_document', 'government_letter', 'rental_agreement'];
    const financialDocs = ['proof_of_income', 'employment_letter', 'tax_return', 'investment_statement', 'crypto_wallet_proof'];
    const corporateDocs = ['company_registration', 'articles_of_incorporation', 'shareholder_register', 'board_resolution', 'annual_report', 'beneficial_owner_declaration'];
    const biometricDocs = ['selfie', 'liveness_video'];
    
    if (identityDocs.includes(type)) return 'identity';
    if (addressDocs.includes(type)) return 'address';
    if (financialDocs.includes(type)) return 'financial';
    if (corporateDocs.includes(type)) return 'corporate';
    if (biometricDocs.includes(type)) return 'biometric';
    
    return 'identity'; // Default
  }
  
  private async getTierExpiry(tier: KYCTier): Promise<number | null> {
    // TODO: Get from config
    const expiry: Record<KYCTier, number | null> = {
      none: null,
      basic: null,
      standard: 365 * 2,
      enhanced: 365,
      full: 365,
      professional: 365,
    };
    return expiry[tier];
  }
  
  private async findTierForAmount(
    amount: number,
    type: 'deposit' | 'withdrawal' | 'transfer',
    jurisdictionCode: string
  ): Promise<KYCTier> {
    const tiers: KYCTier[] = ['basic', 'standard', 'enhanced', 'full', 'professional'];
    
    for (const tier of tiers) {
      const limits = await getTierLimits(tier, jurisdictionCode);
      const operationLimits = limits[type];
      
      if (operationLimits && amount <= operationLimits.maxAmount) {
        return tier;
      }
    }
    
    return 'professional'; // Highest tier
  }
}

// Export singleton
export const kycEngine = new KYCEngine();
