/**
 * Verification Repository
 * 
 * Data access layer for KYC verifications.
 * Extends BaseRepository from core-service for common CRUD operations.
 */

import { 
  BaseRepository,
  logger,
  type RepositoryPaginationInput as PaginationInput,
  type PaginationResult,
  type WriteOptions,
} from 'core-service';

import { db, COLLECTIONS } from '../database.js';
import type {
  KYCVerification,
  KYCTier,
  VerificationRequirement,
  ProviderSession,
  VerificationResult,
  TriggeredBy,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface VerificationFilter {
  profileId?: string;
  status?: KYCVerification['status'] | KYCVerification['status'][];
  targetTier?: KYCTier;
  expiredBefore?: Date;
}

export interface CreateVerificationInput {
  profileId: string;
  targetTier: KYCTier;
  fromTier: KYCTier;
  requirements: VerificationRequirement[];
  expiresAt: Date;
  initiatedBy: TriggeredBy;
  initiatedByUserId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Class
// ═══════════════════════════════════════════════════════════════════

export class VerificationRepository extends BaseRepository<KYCVerification> {
  constructor() {
    super(COLLECTIONS.VERIFICATIONS, db, {
      timestamps: false, // We use startedAt/completedAt instead
      defaultSortField: 'startedAt',
      defaultSortDirection: 'desc',
      indexes: [
        { key: { profileId: 1 } },
        { key: { profileId: 1, status: 1 } },
        { key: { 'providerSession.sessionId': 1 }, sparse: true },
        { key: { expiresAt: 1 } },
        { key: { status: 1, expiresAt: 1 } },
      ],
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new verification
   */
  async createVerification(
    input: CreateVerificationInput,
    options?: WriteOptions
  ): Promise<KYCVerification> {
    const now = new Date();
    
    const verification = await this.create({
      profileId: input.profileId,
      targetTier: input.targetTier,
      fromTier: input.fromTier,
      status: 'pending',
      requirements: input.requirements,
      startedAt: now,
      expiresAt: input.expiresAt,
      initiatedBy: input.initiatedBy,
      initiatedByUserId: input.initiatedByUserId,
    } as any, options);
    
    logger.info('KYC verification created', {
      verificationId: verification.id,
      profileId: verification.profileId,
      targetTier: verification.targetTier,
    });
    
    return verification;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Queries
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find verification by provider session ID
   */
  async findBySessionId(
    sessionId: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    return this.findOne({
      'providerSession.sessionId': sessionId,
    } as any, options);
  }
  
  /**
   * Find active verification for profile
   */
  async findActiveForProfile(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    return this.findOne({
      profileId,
      status: { $in: ['pending', 'in_progress'] },
      expiresAt: { $gt: new Date() },
    } as any, options);
  }
  
  /**
   * Find verifications by profile
   */
  async findByProfileId(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCVerification[]> {
    return this.findMany({ profileId } as any, {
      sort: { startedAt: -1 },
      session: options?.session,
    });
  }
  
  /**
   * Find latest completed verification
   */
  async findLatestCompleted(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const results = await this.findMany({
      profileId,
      status: 'completed',
    } as any, {
      sort: { completedAt: -1 },
      limit: 1,
      session: options?.session,
    });
    
    return results[0] ?? null;
  }
  
  /**
   * Query verifications with complex filters
   */
  async query(
    filter: VerificationFilter,
    pagination?: PaginationInput
  ): Promise<PaginationResult<KYCVerification>> {
    const mongoFilter = this.buildVerificationFilter(filter);
    return this.paginate(mongoFilter as any, pagination);
  }
  
  /**
   * Find expired verifications
   */
  async findExpired(
    limit: number = 100
  ): Promise<KYCVerification[]> {
    return this.findMany({
      status: { $in: ['pending', 'in_progress'] },
      expiresAt: { $lte: new Date() },
    } as any, {
      limit,
    });
  }
  
  /**
   * Find pending manual reviews
   */
  async findPendingManualReviews(
    limit: number = 100
  ): Promise<KYCVerification[]> {
    return this.findMany({
      status: 'in_progress',
      'result.decision': 'manual_review',
    } as any, {
      sort: { startedAt: 1 },
      limit,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Updates
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update status
   */
  async updateStatus(
    id: string,
    status: KYCVerification['status'],
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const update: any = { status };
    
    if (status === 'completed' || status === 'failed') {
      update.completedAt = new Date();
    }
    
    return this.update(id, update, options);
  }
  
  /**
   * Set provider session
   */
  async setProviderSession(
    id: string,
    providerSession: ProviderSession,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    return this.update(id, {
      providerSession,
      status: 'in_progress',
    } as any, options);
  }
  
  /**
   * Set result
   */
  async setResult(
    id: string,
    result: VerificationResult,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const status: KYCVerification['status'] = 
      result.decision === 'approved' ? 'completed' :
      result.decision === 'rejected' ? 'failed' :
      'in_progress'; // manual_review
    
    const updateResult = await this.update(id, {
      result,
      status,
      completedAt: status !== 'in_progress' ? new Date() : undefined,
    } as any, options);
    
    logger.info('Verification result set', {
      verificationId: id,
      decision: result.decision,
      status,
    });
    
    return updateResult;
  }
  
  /**
   * Update requirement status
   */
  async updateRequirement(
    id: string,
    requirementId: string,
    status: VerificationRequirement['status'],
    satisfiedBy?: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const update: any = {
      'requirements.$.status': status,
    };
    
    if (satisfiedBy) {
      update['requirements.$.satisfiedBy'] = satisfiedBy;
      update['requirements.$.satisfiedAt'] = new Date();
    }
    
    const result = await collection.findOneAndUpdate(
      { id, 'requirements.id': requirementId },
      { $set: update },
      { 
        returnDocument: 'after',
        session: options?.session,
      }
    );
    
    return result ? this.normalize(result) : null;
  }
  
  /**
   * Mark webhook received
   */
  async markWebhookReceived(
    id: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    return this.update(id, {
      'providerSession.webhookReceived': true,
      'providerSession.webhookReceivedAt': new Date(),
    } as any, options);
  }
  
  /**
   * Cancel verification
   */
  async cancel(
    id: string,
    reason: string,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const result = await this.update(id, {
      status: 'cancelled',
      completedAt: new Date(),
      notes: reason,
    } as any, options);
    
    if (result) {
      logger.info('Verification cancelled', {
        verificationId: id,
        reason,
      });
    }
    
    return result;
  }
  
  /**
   * Mark expired verifications
   */
  async markExpired(
    options?: WriteOptions
  ): Promise<number> {
    const count = await this.updateMany({
      status: { $in: ['pending', 'in_progress'] },
      expiresAt: { $lte: new Date() },
    } as any, {
      status: 'expired',
      completedAt: new Date(),
    } as any, options);
    
    if (count > 0) {
      logger.info('Verifications marked as expired', {
        count,
      });
    }
    
    return count;
  }
  
  /**
   * Add admin note
   */
  async addNote(
    id: string,
    note: string,
    isInternal: boolean,
    options?: WriteOptions
  ): Promise<KYCVerification | null> {
    const field = isInternal ? 'internalNotes' : 'notes';
    return this.update(id, { [field]: note } as any, options);
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildVerificationFilter(filter: VerificationFilter): Record<string, unknown> {
    const mongoFilter: Record<string, unknown> = {};
    
    if (filter.profileId) {
      mongoFilter.profileId = filter.profileId;
    }
    
    if (filter.status) {
      mongoFilter.status = Array.isArray(filter.status)
        ? { $in: filter.status }
        : filter.status;
    }
    
    if (filter.targetTier) {
      mongoFilter.targetTier = filter.targetTier;
    }
    
    if (filter.expiredBefore) {
      mongoFilter.expiresAt = { $lte: filter.expiredBefore };
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const verificationRepository = new VerificationRepository();
