/**
 * KYC Provider Types
 * 
 * Provider-agnostic interfaces for KYC verification providers
 * Supports: Onfido, Sumsub, Jumio, ID.me, etc.
 */

import type {
  KYCTier,
  DocumentType,
  DocumentVerificationResult,
  AMLCheck,
  PEPScreening,
  SanctionScreening,
  ExtractedDocumentData,
} from './kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Provider Interface
// ═══════════════════════════════════════════════════════════════════

/**
 * KYC Provider interface
 * All providers must implement this interface
 */
export interface KYCProvider {
  // Provider Identification
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  
  // Capabilities
  readonly capabilities: ProviderCapabilities;
  
  // ───────────────────────────────────────────────────────────────────
  // Applicant Management
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create an applicant in the provider's system
   */
  createApplicant(input: CreateApplicantInput): Promise<CreateApplicantResult>;
  
  /**
   * Update an existing applicant
   */
  updateApplicant(applicantId: string, input: UpdateApplicantInput): Promise<void>;
  
  /**
   * Get applicant details
   */
  getApplicant(applicantId: string): Promise<ApplicantDetails | null>;
  
  /**
   * Delete applicant (GDPR compliance)
   */
  deleteApplicant(applicantId: string): Promise<void>;
  
  // ───────────────────────────────────────────────────────────────────
  // Document Management
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Upload a document
   */
  uploadDocument(input: UploadDocumentToProviderInput): Promise<UploadDocumentResult>;
  
  /**
   * Get document details
   */
  getDocument(documentId: string): Promise<ProviderDocument | null>;
  
  /**
   * Verify a document
   */
  verifyDocument(documentId: string): Promise<DocumentVerificationResult>;
  
  // ───────────────────────────────────────────────────────────────────
  // Verification Sessions
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Create a verification session (for SDK/redirect flows)
   */
  createVerificationSession(input: CreateSessionInput): Promise<VerificationSession>;
  
  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  
  /**
   * Get verification result
   */
  getVerificationResult(sessionId: string): Promise<ProviderVerificationResult>;
  
  // ───────────────────────────────────────────────────────────────────
  // Compliance Checks
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Perform AML check
   */
  performAMLCheck(applicantId: string, options?: AMLCheckOptions): Promise<AMLCheck>;
  
  /**
   * Perform PEP screening
   */
  performPEPScreening(applicantId: string, options?: PEPScreeningOptions): Promise<PEPScreening>;
  
  /**
   * Perform sanctions screening
   */
  performSanctionScreening(applicantId: string, options: SanctionScreeningOptions): Promise<SanctionScreening>;
  
  // ───────────────────────────────────────────────────────────────────
  // Biometric
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Perform liveness check
   */
  performLivenessCheck?(applicantId: string, options?: LivenessCheckOptions): Promise<LivenessCheckResult>;
  
  /**
   * Perform face match (selfie vs document)
   */
  performFaceMatch?(applicantId: string, documentId: string, selfieId: string): Promise<FaceMatchResult>;
  
  // ───────────────────────────────────────────────────────────────────
  // Webhooks
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Parse and validate incoming webhook
   */
  parseWebhook(payload: unknown, signature: string, secret: string): Promise<ProviderWebhookEvent>;
  
  /**
   * Get webhook secret header name
   */
  getWebhookSignatureHeader(): string;
  
  // ───────────────────────────────────────────────────────────────────
  // Health
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check provider health/availability
   */
  checkHealth(): Promise<ProviderHealthStatus>;
}

// ═══════════════════════════════════════════════════════════════════
// Provider Capabilities
// ═══════════════════════════════════════════════════════════════════

/**
 * What the provider supports
 */
export interface ProviderCapabilities {
  // Document Verification
  supportedDocuments: DocumentType[];
  
  // Checks
  checks: {
    aml: boolean;
    pep: boolean;
    sanctions: boolean;
    liveness: boolean;
    faceMatch: boolean;
    addressVerification: boolean;
    phoneVerification: boolean;
  };
  
  // Geographic
  supportedCountries: string[]; // ISO codes, empty = all
  excludedCountries?: string[];
  
  // Flow Types
  flows: {
    sdk: boolean; // Mobile/Web SDK
    redirect: boolean; // URL redirect
    api: boolean; // Direct API
  };
  
  // Features
  features: {
    ocr: boolean;
    nfc: boolean; // NFC chip reading
    videoIdent: boolean;
    biometric: boolean;
    addressLookup: boolean;
    realTimeDecisions: boolean;
    batchProcessing: boolean;
    webhooks: boolean;
  };
  
  // Data Retention
  dataRetention: {
    defaultDays: number;
    maxDays: number;
    gdprCompliant: boolean;
    dataResidencyOptions?: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════
// Applicant
// ═══════════════════════════════════════════════════════════════════

export interface CreateApplicantInput {
  externalUserId: string;
  
  // Personal Info
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: Date;
  
  // Contact
  email?: string;
  phone?: string;
  
  // Address
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  
  // Nationality
  nationality?: string;
  countryOfResidence?: string;
  
  // Tax
  taxIdNumber?: string;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

export interface CreateApplicantResult {
  applicantId: string;
  externalUserId: string;
  createdAt: Date;
}

export interface UpdateApplicantInput extends Partial<CreateApplicantInput> {}

export interface ApplicantDetails {
  id: string;
  externalUserId: string;
  
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  
  status: 'active' | 'pending' | 'rejected' | 'deleted';
  
  documents: string[]; // Document IDs
  checks: string[]; // Check IDs
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════════════════════════════

export interface UploadDocumentToProviderInput {
  applicantId: string;
  type: DocumentType;
  
  // File - use Uint8Array for cross-platform compatibility
  file: Uint8Array;
  filename: string;
  mimeType: string;
  
  // Document details
  documentNumber?: string;
  issuingCountry?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  
  // Which side (for two-sided documents)
  side?: 'front' | 'back';
  
  // Metadata
  metadata?: Record<string, unknown>;
}

export interface UploadDocumentResult {
  documentId: string;
  status: 'uploaded' | 'processing' | 'verified' | 'rejected';
  uploadedAt: Date;
}

export interface ProviderDocument {
  id: string;
  applicantId: string;
  type: DocumentType;
  
  status: 'uploaded' | 'processing' | 'verified' | 'rejected';
  
  // Extracted data
  extractedData?: ExtractedDocumentData;
  
  // Verification
  verificationResult?: DocumentVerificationResult;
  
  // Files
  files: {
    id: string;
    side?: 'front' | 'back';
    url?: string;
    expiresAt?: Date;
  }[];
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Verification Session
// ═══════════════════════════════════════════════════════════════════

export interface CreateSessionInput {
  applicantId: string;
  
  // Verification level
  level: KYCTier;
  
  // Flow configuration
  flow?: {
    // Steps to include
    steps?: ('document' | 'selfie' | 'liveness' | 'poa' | 'questionnaire')[];
    
    // Document types to accept
    acceptedDocuments?: DocumentType[];
    
    // Countries
    acceptedCountries?: string[];
  };
  
  // Callbacks
  redirectUrl?: string;
  webhookUrl?: string;
  
  // Session config
  expiresInMinutes?: number;
  locale?: string;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

export interface VerificationSession {
  sessionId: string;
  applicantId: string;
  
  // For SDK flow
  sdkToken?: string;
  
  // For redirect flow
  sessionUrl?: string;
  
  expiresAt: Date;
  createdAt: Date;
}

export interface SessionStatus {
  sessionId: string;
  status: 'pending' | 'in_progress' | 'awaiting_review' | 'completed' | 'expired' | 'cancelled';
  
  // Progress
  completedSteps?: string[];
  currentStep?: string;
  remainingSteps?: string[];
  
  // Result (if completed)
  result?: 'approved' | 'rejected' | 'manual_review';
  
  updatedAt: Date;
}

export interface ProviderVerificationResult {
  sessionId: string;
  applicantId: string;
  
  // Decision
  decision: 'approved' | 'rejected' | 'manual_review';
  decisionReasons?: string[];
  
  // Risk
  riskScore?: number;
  riskSignals?: string[];
  
  // Verified data
  verifiedData?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: Date;
    nationality?: string;
    address?: {
      line1?: string;
      city?: string;
      country?: string;
    };
  };
  
  // Documents verified
  verifiedDocuments?: {
    documentId: string;
    type: DocumentType;
    status: 'verified' | 'rejected';
    reasons?: string[];
  }[];
  
  // Checks performed
  checksPerformed?: {
    type: string;
    result: 'clear' | 'match' | 'caution';
    details?: Record<string, unknown>;
  }[];
  
  completedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Compliance Checks
// ═══════════════════════════════════════════════════════════════════

export interface AMLCheckOptions {
  scope?: 'standard' | 'enhanced';
  includePEP?: boolean;
  includeSanctions?: boolean;
  includeAdverseMedia?: boolean;
}

export interface PEPScreeningOptions {
  includeRelatives?: boolean;
  includeAssociates?: boolean;
  yearsToSearch?: number;
}

export interface SanctionScreeningOptions {
  lists: string[]; // OFAC, EU, UN, etc.
  includeHistorical?: boolean;
  matchThreshold?: number; // 0-100
}

// ═══════════════════════════════════════════════════════════════════
// Biometric
// ═══════════════════════════════════════════════════════════════════

export interface LivenessCheckOptions {
  level?: 'basic' | 'enhanced';
  challengeType?: 'video' | 'photo' | 'motion';
}

export interface LivenessCheckResult {
  id: string;
  passed: boolean;
  
  confidence?: number; // 0-100
  
  // Liveness signals
  signals?: {
    isLive: boolean;
    spoofingAttempt?: boolean;
    spoofingType?: string;
  };
  
  performedAt: Date;
}

export interface FaceMatchResult {
  id: string;
  matched: boolean;
  
  similarity: number; // 0-100
  
  // Match details
  details?: {
    selfieQuality?: number;
    documentPhotoQuality?: number;
    ageEstimate?: number;
    ageEstimateMatch?: boolean;
  };
  
  performedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Webhooks
// ═══════════════════════════════════════════════════════════════════

export interface ProviderWebhookEvent {
  id: string;
  type: WebhookEventType;
  
  applicantId: string;
  
  // Related entity
  entityType?: 'applicant' | 'document' | 'check' | 'session';
  entityId?: string;
  
  // Data
  data?: Record<string, unknown>;
  
  // Timestamps
  createdAt: Date;
  receivedAt: Date;
}

export type WebhookEventType =
  | 'applicant.created'
  | 'applicant.updated'
  | 'applicant.deleted'
  | 'document.uploaded'
  | 'document.verified'
  | 'document.rejected'
  | 'check.started'
  | 'check.completed'
  | 'verification.started'
  | 'verification.completed'
  | 'verification.expired'
  | 'session.completed'
  | 'session.expired'
  | 'risk.alert';

// ═══════════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════════

export interface ProviderHealthStatus {
  healthy: boolean;
  
  // Service status
  services: {
    name: string;
    status: 'operational' | 'degraded' | 'outage';
    latencyMs?: number;
  }[];
  
  // Rate limits
  rateLimits?: {
    remaining: number;
    limit: number;
    resetsAt: Date;
  };
  
  checkedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Provider Configuration
// ═══════════════════════════════════════════════════════════════════

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  
  // API Configuration
  apiUrl: string;
  apiKey: string;
  apiSecret?: string;
  
  // Webhook Configuration
  webhookSecret?: string;
  
  // Timeouts
  timeoutMs?: number;
  
  // Retry
  retryConfig?: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
  
  // Feature flags
  features?: {
    [key: string]: boolean;
  };
  
  // Environment
  sandbox?: boolean;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Provider Factory Types
// ═══════════════════════════════════════════════════════════════════

export interface ProviderFactory {
  /**
   * Get provider by name
   */
  getProvider(name: string): KYCProvider | null;
  
  /**
   * Get all registered providers
   */
  getProviders(): KYCProvider[];
  
  /**
   * Get provider for specific capabilities
   */
  getProviderForCapability(capability: keyof ProviderCapabilities['checks']): KYCProvider | null;
  
  /**
   * Get provider for country
   */
  getProviderForCountry(countryCode: string): KYCProvider | null;
  
  /**
   * Get preferred provider for tier
   */
  getProviderForTier(tier: KYCTier, countryCode?: string): KYCProvider | null;
  
  /**
   * Register a provider
   */
  registerProvider(provider: KYCProvider): void;
}
