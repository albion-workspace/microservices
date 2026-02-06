/**
 * Document Repository
 * 
 * Data access layer for KYC documents.
 * Extends BaseRepository from core-service for common CRUD operations.
 */

import { 
  BaseRepository,
  logger,
  generateId,
  type RepositoryPaginationInput as PaginationInput,
  type PaginationResult,
  type WriteOptions,
} from 'core-service';

import { db, COLLECTIONS } from '../accessors.js';
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

export interface CreateDocumentInput {
  tenantId: string;
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
}

// ═══════════════════════════════════════════════════════════════════
// Repository Class
// ═══════════════════════════════════════════════════════════════════

export class DocumentRepository extends BaseRepository<KYCDocument> {
  constructor() {
    super(COLLECTIONS.DOCUMENTS, db, {
      timestamps: false, // We use uploadedAt instead
      defaultSortField: 'uploadedAt',
      defaultSortDirection: 'desc',
      indexes: [
        { key: { profileId: 1 } },
        { key: { profileId: 1, type: 1 } },
        { key: { status: 1 } },
        { key: { expiresAt: 1 }, sparse: true },
        { key: { providerDocumentId: 1 }, sparse: true },
      ],
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Create
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a new document record
   */
  async createDocument(
    input: CreateDocumentInput,
    options?: WriteOptions
  ): Promise<KYCDocument> {
    const now = new Date();
    
    const doc = await this.create({
      tenantId: input.tenantId,
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
    } as any, options);
    
    logger.info('KYC document created', {
      documentId: doc.id,
      profileId: doc.profileId,
      type: doc.type,
    });
    
    return doc;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Queries
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Find documents by profile ID
   */
  async findByProfileId(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCDocument[]> {
    return this.findMany({ profileId } as any, {
      sort: { uploadedAt: -1 },
      session: options?.session,
    });
  }
  
  /**
   * Find documents by type
   */
  async findByType(
    profileId: string,
    type: DocumentType,
    options?: WriteOptions
  ): Promise<KYCDocument[]> {
    return this.findMany({ profileId, type } as any, {
      sort: { uploadedAt: -1 },
      session: options?.session,
    });
  }
  
  /**
   * Find verified identity document
   */
  async findVerifiedIdentityDocument(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    return this.findOne({
      profileId,
      category: 'identity',
      status: 'verified',
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    } as any, options);
  }
  
  /**
   * Find verified address document
   */
  async findVerifiedAddressDocument(
    profileId: string,
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    return this.findOne({
      profileId,
      category: 'address',
      status: 'verified',
    } as any, options);
  }
  
  /**
   * Query documents with complex filters
   */
  async query(
    filter: DocumentFilter,
    pagination?: PaginationInput
  ): Promise<PaginationResult<KYCDocument>> {
    const mongoFilter = this.buildDocumentFilter(filter);
    return this.paginate(mongoFilter as any, pagination);
  }
  
  /**
   * Find expiring documents
   */
  async findExpiringDocuments(
    beforeDate: Date,
    limit: number = 100
  ): Promise<KYCDocument[]> {
    return this.findMany({
      status: 'verified',
      expiresAt: { $lte: beforeDate },
    } as any, {
      sort: { expiresAt: 1 },
      limit,
    });
  }
  
  /**
   * Count documents by status for profile
   */
  async countByStatus(
    profileId: string
  ): Promise<Record<DocumentStatus, number>> {
    const results = await this.aggregate<{ _id: DocumentStatus; count: number }>([
      { $match: { profileId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    const counts: Record<DocumentStatus, number> = {
      pending: 0,
      processing: 0,
      verified: 0,
      rejected: 0,
      expired: 0,
    };
    
    for (const result of results) {
      counts[result._id] = result.count;
    }
    
    return counts;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Domain-Specific Updates
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Update document status
   */
  async updateStatus(
    id: string,
    status: DocumentStatus,
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    const update: any = { status };
    
    if (status === 'processing') {
      update.processedAt = new Date();
    }
    
    return this.update(id, update, options);
  }
  
  /**
   * Set verification result
   */
  async setVerificationResult(
    id: string,
    result: DocumentVerificationResult,
    newStatus: DocumentStatus,
    verifiedBy: string,
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    const updateResult = await this.update(id, {
      verificationResult: result,
      status: newStatus,
      verifiedAt: new Date(),
      verifiedBy,
    } as any, options);
    
    if (updateResult) {
      logger.info('Document verification result set', {
        documentId: id,
        status: newStatus,
        isAuthentic: result.isAuthentic,
      });
    }
    
    return updateResult;
  }
  
  /**
   * Reject document
   */
  async reject(
    id: string,
    reason: string,
    details?: string[],
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    const result = await this.update(id, {
      status: 'rejected',
      rejectionReason: reason,
      rejectionDetails: details,
    } as any, options);
    
    if (result) {
      logger.info('Document rejected', {
        documentId: id,
        reason,
      });
    }
    
    return result;
  }
  
  /**
   * Set provider reference
   */
  async setProviderReference(
    id: string,
    providerId: string,
    providerDocumentId: string,
    options?: WriteOptions
  ): Promise<KYCDocument | null> {
    return this.update(id, {
      providerId,
      providerDocumentId,
    } as any, options);
  }
  
  /**
   * Mark documents as expired
   */
  async markExpired(
    beforeDate: Date,
    options?: WriteOptions
  ): Promise<number> {
    const count = await this.updateMany({
      status: 'verified',
      expiresAt: { $lte: beforeDate },
    } as any, {
      status: 'expired',
    } as any, options);
    
    if (count > 0) {
      logger.info('Documents marked as expired', {
        count,
        beforeDate: beforeDate.toISOString(),
      });
    }
    
    return count;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Delete
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Delete all documents for profile (GDPR)
   */
  async deleteByProfileId(
    profileId: string,
    options?: WriteOptions
  ): Promise<number> {
    return this.deleteMany({ profileId } as any, options);
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private buildDocumentFilter(filter: DocumentFilter): Record<string, unknown> {
    const mongoFilter: Record<string, unknown> = {};
    
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
      mongoFilter.expiresAt = { $lte: filter.expiringBefore };
    }
    
    if (filter.providerId) {
      mongoFilter.providerId = filter.providerId;
    }
    
    return mongoFilter;
  }
}

// Export singleton
export const documentRepository = new DocumentRepository();
