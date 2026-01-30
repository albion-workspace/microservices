/**
 * KYC Service Repositories
 * 
 * All repositories extend BaseRepository from core-service,
 * providing common CRUD operations with domain-specific methods.
 */

export { KYCRepository, kycRepository } from './kyc-repository.js';
export type { KYCProfileFilter } from './kyc-repository.js';

export { DocumentRepository, documentRepository } from './document-repository.js';
export type { DocumentFilter, CreateDocumentInput } from './document-repository.js';

export { VerificationRepository, verificationRepository } from './verification-repository.js';
export type { VerificationFilter, CreateVerificationInput } from './verification-repository.js';
