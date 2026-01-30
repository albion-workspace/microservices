/**
 * Verification Repository
 * 
 * Data access layer for KYC verifications
 */

import { 
  generateId, 
  paginateCollection,
  logger,
} from 'core-service';
import type { 
  ClientSession, 
  Filter,
  Collection,
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

export class VerificationRepository {
  private getCollection(): Promise<Collection<KYCVerification>> {
    return db.getDb().then(database => database.collection<KYCVerification>(COLLECTIONS.VERIFICATIONS));
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new verification
   */
  async create(
    input: CreateVerificationInput,
    session?: ClientSession
  ): Promise<KYCVerification> {
    const collection = await this.getCollection();
    const now = new Date();
    
    const verification: KYCVerification = {
      id: generateId(),
      profileId: input.profileId,
      targetTier: input.targetTier,
      fromTier: input.fromTier,
      status: 'pending',
      requirements: input.requirements,
      startedAt: now,
      expiresAt: input.expiresAt,
      initiatedBy: input.initiatedBy,
      initiatedByUserId: input.initiatedByUserId,
    };
    
    await collection.insertOne(verification as any, { session });
    
    logger.info('KYC verification created', {
      verificationId: verification.id,
      profileId: verification.profileId,
      targetTier: verification.targetTier,
    });
    
    return verification;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find verification by ID
   */
  async findById(
    id: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    return collection.findOne({ id }, { session }) as Promise<KYCVerification | null>;
  }
  
  /**
   * Find verification by provider session ID
   */
  async findBySessionId(
    sessionId: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      'providerSession.sessionId': sessionId,
    }, { session }) as Promise<KYCVerification | null>;
  }
  
  /**
   * Find active verification for profile
   */
  async findActiveForProfile(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      profileId,
      status: { $in: ['pending', 'in_progress'] },
      expiresAt: { $gt: new Date() },
    }, { session }) as Promise<KYCVerification | null>;
  }
  
  /**
   * Find verifications by profile
   */
  async findByProfileId(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCVerification[]> {
    const collection = await this.getCollection();
    return collection.find({ profileId }, { session })
      .sort({ startedAt: -1 })
      .toArray() as Promise<KYCVerification[]>;
  }
  
  /**
   * Find latest completed verification
   */
  async findLatestCompleted(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      profileId,
      status: 'completed',
    }, {
      sort: { completedAt: -1 },
      session,
    }) as Promise<KYCVerification | null>;
  }
  
  /**
   * Query verifications with filters
   */
  async query(
    filter: VerificationFilter,
    pagination?: { first?: number; after?: string }
  ): Promise<{
    nodes: KYCVerification[];
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
      sort: { startedAt: -1 },
    });
  }
  
  /**
   * Find expired verifications
   */
  async findExpired(
    limit: number = 100
  ): Promise<KYCVerification[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      status: { $in: ['pending', 'in_progress'] },
      expiresAt: { $lte: new Date() },
    })
      .limit(limit)
      .toArray() as Promise<KYCVerification[]>;
  }
  
  /**
   * Find pending manual reviews
   */
  async findPendingManualReviews(
    limit: number = 100
  ): Promise<KYCVerification[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      status: 'in_progress',
      'result.decision': 'manual_review',
    })
      .sort({ startedAt: 1 })
      .limit(limit)
      .toArray() as Promise<KYCVerification[]>;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Update
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update status
   */
  async updateStatus(
    id: string,
    status: KYCVerification['status'],
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const update: any = { status };
    
    if (status === 'completed' || status === 'failed') {
      update.completedAt = new Date();
    }
    
    const result = await collection.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after', session }
    );
    
    return result as KYCVerification | null;
  }
  
  /**
   * Set provider session
   */
  async setProviderSession(
    id: string,
    providerSession: ProviderSession,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          providerSession,
          status: 'in_progress',
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCVerification | null;
  }
  
  /**
   * Set result
   */
  async setResult(
    id: string,
    result: VerificationResult,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const status: KYCVerification['status'] = 
      result.decision === 'approved' ? 'completed' :
      result.decision === 'rejected' ? 'failed' :
      'in_progress'; // manual_review
    
    const updateResult = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          result,
          status,
          completedAt: status !== 'in_progress' ? new Date() : undefined,
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('Verification result set', {
      verificationId: id,
      decision: result.decision,
      status,
    });
    
    return updateResult as KYCVerification | null;
  }
  
  /**
   * Update requirement status
   */
  async updateRequirement(
    id: string,
    requirementId: string,
    status: VerificationRequirement['status'],
    satisfiedBy?: string,
    session?: ClientSession
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
      { returnDocument: 'after', session }
    );
    
    return result as KYCVerification | null;
  }
  
  /**
   * Mark webhook received
   */
  async markWebhookReceived(
    id: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          'providerSession.webhookReceived': true,
          'providerSession.webhookReceivedAt': new Date(),
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCVerification | null;
  }
  
  /**
   * Cancel verification
   */
  async cancel(
    id: string,
    reason: string,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          status: 'cancelled',
          completedAt: new Date(),
          notes: reason,
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('Verification cancelled', {
      verificationId: id,
      reason,
    });
    
    return result as KYCVerification | null;
  }
  
  /**
   * Mark expired verifications
   */
  async markExpired(
    session?: ClientSession
  ): Promise<number> {
    const collection = await this.getCollection();
    
    const result = await collection.updateMany(
      {
        status: { $in: ['pending', 'in_progress'] },
        expiresAt: { $lte: new Date() },
      },
      {
        $set: {
          status: 'expired',
          completedAt: new Date(),
        },
      },
      { session }
    );
    
    if (result.modifiedCount > 0) {
      logger.info('Verifications marked as expired', {
        count: result.modifiedCount,
      });
    }
    
    return result.modifiedCount;
  }
  
  /**
   * Add admin note
   */
  async addNote(
    id: string,
    note: string,
    isInternal: boolean,
    session?: ClientSession
  ): Promise<KYCVerification | null> {
    const collection = await this.getCollection();
    
    const field = isInternal ? 'internalNotes' : 'notes';
    
    const result = await collection.findOneAndUpdate(
      { id },
      { $set: { [field]: note } },
      { returnDocument: 'after', session }
    );
    
    return result as KYCVerification | null;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildFilter(filter: VerificationFilter): Filter<KYCVerification> {
    const mongoFilter: Filter<KYCVerification> = {};
    
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
      mongoFilter.expiresAt = { $lte: filter.expiredBefore } as any;
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const verificationRepository = new VerificationRepository();
