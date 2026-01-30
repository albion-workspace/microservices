/**
 * Document Repository
 * 
 * Data access layer for KYC documents
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
  KYCDocument,
  DocumentType,
  DocumentCategory,
  DocumentStatus,
  DocumentFile,
  DocumentVerificationResult,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface DocumentFilter {
  profileId?: string;
  type?: DocumentType | DocumentType[];
  category?: DocumentCategory;
  status?: DocumentStatus | DocumentStatus[];
  expiringBefore?: Date;
  providerId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Repository Class
// ═══════════════════════════════════════════════════════════════════

export class DocumentRepository {
  private getCollection(): Promise<Collection<KYCDocument>> {
    return db.getDb().then(database => database.collection<KYCDocument>(COLLECTIONS.DOCUMENTS));
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new document record
   */
  async create(
    input: {
      profileId: string;
      type: DocumentType;
      category: DocumentCategory;
      files: DocumentFile[];
      documentNumber?: string;
      issuingCountry?: string;
      issuedAt?: Date;
      expiresAt?: Date;
      uploadedBy: string;
      metadata?: Record<string, unknown>;
    },
    session?: ClientSession
  ): Promise<KYCDocument> {
    const collection = await this.getCollection();
    const now = new Date();
    
    const document: KYCDocument = {
      id: generateId(),
      profileId: input.profileId,
      type: input.type,
      category: input.category,
      
      documentNumber: input.documentNumber,
      issuingCountry: input.issuingCountry,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      
      files: input.files,
      
      status: 'pending',
      
      uploadedAt: now,
      uploadedBy: input.uploadedBy,
      
      metadata: input.metadata,
    };
    
    await collection.insertOne(document as any, { session });
    
    logger.info('KYC document created', {
      documentId: document.id,
      profileId: document.profileId,
      type: document.type,
    });
    
    return document;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find document by ID
   */
  async findById(
    id: string,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    return collection.findOne({ id }, { session }) as Promise<KYCDocument | null>;
  }
  
  /**
   * Find documents by profile ID
   */
  async findByProfileId(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCDocument[]> {
    const collection = await this.getCollection();
    return collection.find({ profileId }, { session })
      .sort({ uploadedAt: -1 })
      .toArray() as Promise<KYCDocument[]>;
  }
  
  /**
   * Find documents by type
   */
  async findByType(
    profileId: string,
    type: DocumentType,
    session?: ClientSession
  ): Promise<KYCDocument[]> {
    const collection = await this.getCollection();
    return collection.find({ profileId, type }, { session })
      .sort({ uploadedAt: -1 })
      .toArray() as Promise<KYCDocument[]>;
  }
  
  /**
   * Find verified identity document
   */
  async findVerifiedIdentityDocument(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      profileId,
      category: 'identity',
      status: 'verified',
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    }, { session }) as Promise<KYCDocument | null>;
  }
  
  /**
   * Find verified address document
   */
  async findVerifiedAddressDocument(
    profileId: string,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    return collection.findOne({
      profileId,
      category: 'address',
      status: 'verified',
    }, { session }) as Promise<KYCDocument | null>;
  }
  
  /**
   * Query documents with filters
   */
  async query(
    filter: DocumentFilter,
    pagination?: { first?: number; after?: string }
  ): Promise<{
    nodes: KYCDocument[];
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
      sort: { uploadedAt: -1 },
    });
  }
  
  /**
   * Find expiring documents
   */
  async findExpiringDocuments(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCDocument[]> {
    const collection = await this.getCollection();
    
    return collection.find({
      status: 'verified',
      expiresAt: { $lte: beforeDate },
    })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .toArray() as Promise<KYCDocument[]>;
  }
  
  /**
   * Count documents by status for profile
   */
  async countByStatus(
    profileId: string
  ): Promise<Record<DocumentStatus, number>> {
    const collection = await this.getCollection();
    
    const pipeline = [
      { $match: { profileId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];
    
    const results = await collection.aggregate(pipeline).toArray();
    
    const counts: Record<DocumentStatus, number> = {
      pending: 0,
      processing: 0,
      verified: 0,
      rejected: 0,
      expired: 0,
    };
    
    for (const result of results) {
      counts[result._id as DocumentStatus] = result.count;
    }
    
    return counts;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Update
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update document status
   */
  async updateStatus(
    id: string,
    status: DocumentStatus,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    
    const update: any = {
      status,
    };
    
    if (status === 'processing') {
      update.processedAt = new Date();
    }
    
    const result = await collection.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after', session }
    );
    
    return result as KYCDocument | null;
  }
  
  /**
   * Set verification result
   */
  async setVerificationResult(
    id: string,
    result: DocumentVerificationResult,
    newStatus: DocumentStatus,
    verifiedBy: string,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    
    const updateResult = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          verificationResult: result,
          status: newStatus,
          verifiedAt: new Date(),
          verifiedBy,
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('Document verification result set', {
      documentId: id,
      status: newStatus,
      isAuthentic: result.isAuthentic,
    });
    
    return updateResult as KYCDocument | null;
  }
  
  /**
   * Reject document
   */
  async reject(
    id: string,
    reason: string,
    details?: string[],
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          status: 'rejected',
          rejectionReason: reason,
          rejectionDetails: details,
        },
      },
      { returnDocument: 'after', session }
    );
    
    logger.info('Document rejected', {
      documentId: id,
      reason,
    });
    
    return result as KYCDocument | null;
  }
  
  /**
   * Set provider reference
   */
  async setProviderReference(
    id: string,
    providerId: string,
    providerDocumentId: string,
    session?: ClientSession
  ): Promise<KYCDocument | null> {
    const collection = await this.getCollection();
    
    const result = await collection.findOneAndUpdate(
      { id },
      {
        $set: {
          providerId,
          providerDocumentId,
        },
      },
      { returnDocument: 'after', session }
    );
    
    return result as KYCDocument | null;
  }
  
  /**
   * Mark documents as expired
   */
  async markExpired(
    beforeDate: Date,
    session?: ClientSession
  ): Promise<number> {
    const collection = await this.getCollection();
    
    const result = await collection.updateMany(
      {
        status: 'verified',
        expiresAt: { $lte: beforeDate },
      },
      {
        $set: { status: 'expired' },
      },
      { session }
    );
    
    if (result.modifiedCount > 0) {
      logger.info('Documents marked as expired', {
        count: result.modifiedCount,
        beforeDate: beforeDate.toISOString(),
      });
    }
    
    return result.modifiedCount;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Delete
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Delete document (hard delete - for GDPR)
   */
  async delete(
    id: string,
    session?: ClientSession
  ): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.deleteOne({ id }, { session });
    return result.deletedCount > 0;
  }
  
  /**
   * Delete all documents for profile (GDPR)
   */
  async deleteByProfileId(
    profileId: string,
    session?: ClientSession
  ): Promise<number> {
    const collection = await this.getCollection();
    const result = await collection.deleteMany({ profileId }, { session });
    return result.deletedCount;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildFilter(filter: DocumentFilter): Filter<KYCDocument> {
    const mongoFilter: Filter<KYCDocument> = {};
    
    if (filter.profileId) {
      mongoFilter.profileId = filter.profileId;
    }
    
    if (filter.type) {
      mongoFilter.type = Array.isArray(filter.type)
        ? { $in: filter.type }
        : filter.type;
    }
    
    if (filter.category) {
      mongoFilter.category = filter.category;
    }
    
    if (filter.status) {
      mongoFilter.status = Array.isArray(filter.status)
        ? { $in: filter.status }
        : filter.status;
    }
    
    if (filter.expiringBefore) {
      mongoFilter.expiresAt = { $lte: filter.expiringBefore } as any;
    }
    
    if (filter.providerId) {
      mongoFilter.providerId = filter.providerId;
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const documentRepository = new DocumentRepository();
