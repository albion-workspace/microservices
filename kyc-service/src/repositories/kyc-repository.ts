/**
 * KYC Repository
 * 
 * Data access layer for KYC profiles.
 * Extends BaseRepository from core-service for common CRUD operations.
 */

import { 
  UserScopedRepository,
  logger,
  type PaginationResult,
  type WriteOptions,
  type RepositoryPaginationInput as PaginationInput,
} from 'core-service';

import { db, COLLECTIONS } from '../accessors.js';
import type {
  KYCProfile,
  KYCTier,
  KYCStatus,
  RiskLevel,
  KYCAddress,
  ProviderReference,
  CreateKYCProfileInput,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface KYCProfileFilter {
  tenantId?: string;
  userId?: string;
  status?: KYCStatus | KYCStatus[];
  currentTier?: KYCTier | KYCTier[];
  riskLevel?: RiskLevel | RiskLevel[];
  jurisdictionCode?: string;
  isPEP?: boolean;
  isHighRisk?: boolean;
  expiringBefore?: Date;
  nextReviewBefore?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Class
// ═══════════════════════════════════════════════════════════════════

export class KYCRepository extends UserScopedRepository<KYCProfile> {
  constructor() {
    super(COLLECTIONS.PROFILES, db, {
      timestamps: true,
      defaultSortField: 'createdAt',
      defaultSortDirection: 'desc',
      indexes: [
        // Primary lookups
        { key: { userId: 1, tenantId: 1 }, unique: true },
        { key: { tenantId: 1 } },
        // Status queries
        { key: { status: 1, tenantId: 1 } },
        { key: { currentTier: 1, tenantId: 1 } },
        { key: { riskLevel: 1, tenantId: 1 } },
        // Expiration
        { key: { expiresAt: 1 }, sparse: true },
        { key: { nextReviewAt: 1 }, sparse: true },
        // Provider sync
        { key: { 'providerReferences.provider': 1, 'providerReferences.externalId': 1 } },
        // Flags
        { key: { isPEP: 1, tenantId: 1 }, sparse: true },
        { key: { isHighRisk: 1, tenantId: 1 }, sparse: true },
      ],
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new KYC profile with defaults
   */
  async createProfile(
    input: CreateKYCProfileInput,
    options?: WriteOptions
  ): Promise<KYCProfile> {
    const profileData = {
      userId: input.userId,
      tenantId: input.tenantId,
      
      // Initial state
      currentTier: 'none' as KYCTier,
      status: 'pending' as KYCStatus,
      riskLevel: 'low' as RiskLevel,
      riskScore: 0,
      
      // Personal info
      personalInfo: input.personalInfo as KYCProfile['personalInfo'],
      
      // Empty arrays
      addresses: [],
      verifications: [],
      documents: [],
      amlChecks: [],
      pepScreenings: [],
      sanctionScreenings: [],
      riskAssessments: [],
      providerReferences: [],
      statusHistory: [],
      
      // Jurisdiction
      jurisdictionCode: input.jurisdictionCode,
      
      // Flags
      isPEP: false,
      isHighRisk: false,
      requiresEnhancedDueDiligence: false,
    };
    
    const profile = await this.create(profileData as any, options);
    
    logger.info('KYC profile created', {
      profileId: profile.id,
      userId: profile.userId,
      tenantId: profile.tenantId,
    });
    
    return profile;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Queries
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find profile by provider reference
   */
  async findByProviderReference(
    provider: string,
    externalId: string,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    return this.findOne({
      'providerReferences.provider': provider,
      'providerReferences.externalId': externalId,
    } as any, options);
  }
  
  /**
   * Query profiles with complex filters
   */
  async query(
    filter: KYCProfileFilter,
    pagination?: PaginationInput
  ): Promise<PaginationResult<KYCProfile>> {
    const mongoFilter = this.buildKYCFilter(filter);
    return this.paginate(mongoFilter as any, pagination);
  }
  
  /**
   * Find profiles with expiring verifications
   */
  async findExpiringProfiles(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    return this.findMany({
      expiresAt: { $lte: beforeDate },
      status: 'approved',
    } as any, {
      sort: { expiresAt: 1 },
      limit,
    });
  }
  
  /**
   * Find profiles needing review
   */
  async findProfilesNeedingReview(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    return this.findMany({
      nextReviewAt: { $lte: beforeDate },
      status: 'approved',
    } as any, {
      sort: { nextReviewAt: 1 },
      limit,
    });
  }
  
  /**
   * Find high-risk profiles
   */
  async findHighRiskProfiles(
    tenantId: string,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    return this.findMany({
      tenantId,
      $or: [
        { riskLevel: { $in: ['high', 'critical'] } },
        { isHighRisk: true },
        { isPEP: true },
      ],
    } as any, {
      sort: { riskScore: -1 },
      limit,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Updates
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update status with history
   */
  async updateStatus(
    id: string,
    newStatus: KYCStatus,
    reason: string,
    triggeredBy: 'user' | 'system' | 'admin' | 'provider',
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    const profile = await this.findById(id, options);
    if (!profile) return null;
    
    const result = await this.updateWithOperators(id, {
      $set: {
        status: newStatus,
      },
      $push: {
        statusHistory: {
          timestamp: new Date(),
          previousStatus: profile.status,
          newStatus,
          reason,
          triggeredBy,
        },
      } as any,
    }, options);
    
    logger.info('KYC profile status updated', {
      profileId: id,
      previousStatus: profile.status,
      newStatus,
      reason,
    });
    
    return result;
  }
  
  /**
   * Update tier
   */
  async updateTier(
    id: string,
    newTier: KYCTier,
    reason: string,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    const result = await this.update(id, {
      currentTier: newTier,
      lastVerifiedAt: new Date(),
    } as any, options);
    
    if (result) {
      logger.info('KYC profile tier updated', {
        profileId: id,
        newTier,
        reason,
      });
    }
    
    return result;
  }
  
  /**
   * Update risk level
   */
  async updateRiskLevel(
    id: string,
    riskLevel: RiskLevel,
    riskScore: number,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    const isHighRisk = riskLevel === 'high' || riskLevel === 'critical';
    
    return this.update(id, {
      riskLevel,
      riskScore,
      isHighRisk,
    } as any, options);
  }
  
  /**
   * Add address
   */
  async addAddress(
    id: string,
    address: KYCAddress,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    // If primary, unset other primary addresses first
    if (address.isPrimary) {
      const collection = await this.getCollection();
      await collection.updateOne(
        { id, 'addresses.isPrimary': true },
        { $set: { 'addresses.$.isPrimary': false } },
        { session: options?.session }
      );
    }
    
    return this.updateWithOperators(id, {
      $push: { addresses: address } as any,
    }, options);
  }
  
  /**
   * Add provider reference
   */
  async addProviderReference(
    id: string,
    reference: ProviderReference,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    return this.updateWithOperators(id, {
      $push: { providerReferences: reference } as any,
    }, options);
  }
  
  /**
   * Set PEP status
   */
  async setPEPStatus(
    id: string,
    isPEP: boolean,
    requiresEDD: boolean,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    return this.update(id, {
      isPEP,
      requiresEnhancedDueDiligence: requiresEDD,
    } as any, options);
  }
  
  /**
   * Set expiration
   */
  async setExpiration(
    id: string,
    expiresAt: Date,
    nextReviewAt?: Date,
    options?: WriteOptions
  ): Promise<KYCProfile | null> {
    const update: any = { expiresAt };
    if (nextReviewAt) {
      update.nextReviewAt = nextReviewAt;
    }
    
    return this.update(id, update, options);
  }
  
  // ───────────────────────────────────────────────────────────────────
  // GDPR / Soft Delete
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Soft delete (GDPR - anonymize data)
   */
  async softDelete(
    id: string,
    options?: WriteOptions
  ): Promise<boolean> {
    const result = await this.updateWithOperators(id, {
      $set: {
        status: 'deleted' as any,
        personalInfo: undefined,
        addresses: [],
        documents: [],
      },
      $push: {
        statusHistory: {
          timestamp: new Date(),
          newStatus: 'deleted',
          reason: 'GDPR deletion request',
          triggeredBy: 'system',
        },
      } as any,
    }, options);
    
    return result !== null;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildKYCFilter(filter: KYCProfileFilter): Record<string, unknown> {
    const mongoFilter: Record<string, unknown> = {};
    
    if (filter.tenantId) {
      mongoFilter.tenantId = filter.tenantId;
    }
    
    if (filter.userId) {
      mongoFilter.userId = filter.userId;
    }
    
    if (filter.status) {
      mongoFilter.status = Array.isArray(filter.status)
        ? { $in: filter.status }
        : filter.status;
    }
    
    if (filter.currentTier) {
      mongoFilter.currentTier = Array.isArray(filter.currentTier)
        ? { $in: filter.currentTier }
        : filter.currentTier;
    }
    
    if (filter.riskLevel) {
      mongoFilter.riskLevel = Array.isArray(filter.riskLevel)
        ? { $in: filter.riskLevel }
        : filter.riskLevel;
    }
    
    if (filter.jurisdictionCode) {
      mongoFilter.jurisdictionCode = filter.jurisdictionCode;
    }
    
    if (filter.isPEP !== undefined) {
      mongoFilter.isPEP = filter.isPEP;
    }
    
    if (filter.isHighRisk !== undefined) {
      mongoFilter.isHighRisk = filter.isHighRisk;
    }
    
    if (filter.expiringBefore) {
      mongoFilter.expiresAt = { $lte: filter.expiringBefore };
    }
    
    if (filter.nextReviewBefore) {
      mongoFilter.nextReviewAt = { $lte: filter.nextReviewBefore };
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const kycRepository = new KYCRepository();
