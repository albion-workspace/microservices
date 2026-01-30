/**
 * KYC Repository
 * 
 * Data access layer for KYC profiles
 */

import { 
  generateId, 
  paginateCollection,
  findOneById,
  logger,
} from 'core-service';
import type { 
  Db, 
  ClientSession, 
  Filter,
  UpdateFilter,
  Collection,
} from 'core-service';

import { db, COLLECTIONS } from '../database.js';
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
  status?: KYCStatus | KYCStatus[];
  currentTier?: KYCTier | KYCTier[];
  riskLevel?: RiskLevel | RiskLevel[];
  jurisdictionCode?: string;
  isPEP?: boolean;
  isHighRisk?: boolean;
  expiringBefore?: Date;
  nextReviewBefore?: Date;
}

export interface PaginationInput {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Class
// ═══════════════════════════════════════════════════════════════════

export class KYCRepository {
  private getCollection(): Promise<Collection<KYCProfile>> {
    return db.getDb().then(database => database.collection<KYCProfile>(COLLECTIONS.PROFILES));
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new KYC profile
   */
  async create(
    input: CreateKYCProfileInput,
    session?: ClientSession
  ): Promise<KYCProfile> {
    const collection = await this.getCollection();
    const now = new Date();
    
    const profile: KYCProfile = {
      id: generateId(),
      userId: input.userId,
      tenantId: input.tenantId,
      
      // Initial state
      currentTier: 'none',
      status: 'pending',
      riskLevel: 'low',
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
      
      // Timestamps
      createdAt: now,
      updatedAt: now,
    };
    
    await collection.insertOne(profile as any, { session });
    
    logger.info('KYC profile created', {
      profileId: profile.id,
      userId: profile.userId,
      tenantId: profile.tenantId,
    });
    
    return profile;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find profile by ID
   */
  async findById(
    id: string,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    return collection.findOne({ id }, { session }) as Promise<KYCProfile | null>;
  }
  
  /**
   * Find profile by user ID
   */
  async findByUserId(
    userId: string,
    tenantId: string,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    return collection.findOne({ userId, tenantId }, { session }) as Promise<KYCProfile | null>;
  }
  
  /**
   * Find profile by provider reference
   */
  async findByProviderReference(
    provider: string,
    externalId: string,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      'providerReferences.provider': provider,
      'providerReferences.externalId': externalId,
    }, { session }) as Promise<KYCProfile | null>;
  }
  
  /**
   * Query profiles with filters and pagination
   */
  async query(
    filter: KYCProfileFilter,
    pagination?: PaginationInput
  ): Promise<{
    nodes: KYCProfile[];
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor?: string;
      endCursor?: string;
    };
    totalCount: number;
  }> {
    const collection = await this.getCollection();
    const mongoFilter = this.buildFilter(filter);
    
    return paginateCollection(collection as any, {
      filter: mongoFilter,
      first: pagination?.first ?? 20,
      after: pagination?.after,
      sort: { createdAt: -1 },
    });
  }
  
  /**
   * Find profiles with expiring verifications
   */
  async findExpiringProfiles(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      expiresAt: { $lte: beforeDate },
      status: 'approved',
    })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .toArray() as Promise<KYCProfile[]>;
  }
  
  /**
   * Find profiles needing review
   */
  async findProfilesNeedingReview(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      nextReviewAt: { $lte: beforeDate },
      status: 'approved',
    })
      .sort({ nextReviewAt: 1 })
      .limit(limit)
      .toArray() as Promise<KYCProfile[]>;
  }
  
  /**
   * Find high-risk profiles
   */
  async findHighRiskProfiles(
    tenantId: string,
    limit: number = 100
  ): Promise<KYCProfile[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      tenantId,
      $or: [
        { riskLevel: { $in: ['high', 'critical'] } },
        { isHighRisk: true },
        { isPEP: true },
      ],
    })
      .sort({ riskScore: -1 })
      .limit(limit)
      .toArray() as Promise<KYCProfile[]>;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Update
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update profile
   */
  async update(
    id: string,
    update: Partial<KYCProfile>,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          ...update,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  /**
   * Update status with history
   */
  async updateStatus(
    id: string,
    newStatus: KYCStatus,
    reason: string,
    triggeredBy: 'user' | 'system' | 'admin' | 'provider',
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    const profile = await this.findById(id, session);
    
    if (!profile) return null;
    
    const now = new Date();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          status: newStatus,
          updatedAt: now,
        },
        $push: {
          statusHistory: {
            timestamp: now,
            previousStatus: profile.status,
            newStatus,
            reason,
            triggeredBy,
          },
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('KYC profile status updated', {
      profileId: id,
      previousStatus: profile.status,
      newStatus,
      reason,
    });
    
    return result as KYCProfile | null;
  }
  
  /**
   * Update tier
   */
  async updateTier(
    id: string,
    newTier: KYCTier,
    reason: string,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    const now = new Date();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          currentTier: newTier,
          lastVerifiedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('KYC profile tier updated', {
      profileId: id,
      newTier,
      reason,
    });
    
    return result as KYCProfile | null;
  }
  
  /**
   * Update risk level
   */
  async updateRiskLevel(
    id: string,
    riskLevel: RiskLevel,
    riskScore: number,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    const isHighRisk = riskLevel === 'high' || riskLevel === 'critical';
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          riskLevel,
          riskScore,
          isHighRisk,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  /**
   * Add address
   */
  async addAddress(
    id: string,
    address: KYCAddress,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    // If primary, unset other primary addresses
    if (address.isPrimary) {
      await collection.updateOne(
        { id, 'addresses.isPrimary': true },
        { $set: { 'addresses.$.isPrimary': false } },
        { session }
      );
    }
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $push: { addresses: address },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  /**
   * Add provider reference
   */
  async addProviderReference(
    id: string,
    reference: ProviderReference,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $push: { providerReferences: reference },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  /**
   * Set PEP status
   */
  async setPEPStatus(
    id: string,
    isPEP: boolean,
    requiresEDD: boolean,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          isPEP,
          requiresEnhancedDueDiligence: requiresEDD,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  /**
   * Set expiration
   */
  async setExpiration(
    id: string,
    expiresAt: Date,
    nextReviewAt?: Date,
    session?: ClientSession
  ): Promise<KYCProfile | null> {
    const collection = await this.getCollection();
    
    const update: any = {
      expiresAt,
      updatedAt: new Date(),
    };
    
    if (nextReviewAt) {
      update.nextReviewAt = nextReviewAt;
    }
    
    const result = await collection.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after', session }
    );
    
    return result as KYCProfile | null;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Delete
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Soft delete (GDPR - anonymize data)
   */
  async softDelete(
    id: string,
    session?: ClientSession
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.updateOne(
      { id },
      {
        $set: {
          status: 'deleted' as any,
          personalInfo: undefined,
          addresses: [],
          documents: [],
          updatedAt: new Date(),
        },
        $push: {
          statusHistory: {
            timestamp: new Date(),
            newStatus: 'deleted',
            reason: 'GDPR deletion request',
            triggeredBy: 'system',
          },
        },
      },
      { session }
    );
    
    return result.modifiedCount > 0;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildFilter(filter: KYCProfileFilter): Filter<KYCProfile> {
    const mongoFilter: Filter<KYCProfile> = {};
    
    if (filter.tenantId) {
      mongoFilter.tenantId = filter.tenantId;
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
      mongoFilter.expiresAt = { $lte: filter.expiringBefore } as any;
    }
    
    if (filter.nextReviewBefore) {
      mongoFilter.nextReviewAt = { $lte: filter.nextReviewBefore } as any;
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const kycRepository = new KYCRepository();
