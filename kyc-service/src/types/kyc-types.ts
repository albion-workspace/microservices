/**
 * KYC Core Types
 * 
 * Generic KYC types supporting multiple industries:
 * - Finance (banking, forex, trading)
 * - Betting/Gaming (casino, sports, lottery)
 * - Crypto (exchanges, wallets)
 * - E-commerce (marketplaces)
 */

// Import shared types from core-service (single source of truth)
import type { 
  StatusHistoryEntry as CoreStatusHistoryEntry, 
  TriggeredBy as CoreTriggeredBy, 
  BaseEntity,
  UserEntity as CoreUserEntity,
} from 'core-service';

// Re-export for consumers
export type StatusHistoryEntry<T = string> = CoreStatusHistoryEntry;
export type TriggeredBy = CoreTriggeredBy;
export type UserEntity = CoreUserEntity;

// ═══════════════════════════════════════════════════════════════════
// KYC Tiers & Status
// ═══════════════════════════════════════════════════════════════════

/**
 * KYC verification tiers
 * Each tier unlocks higher limits and more features
 */
export type KYCTier = 
  | 'none'           // Not started (default)
  | 'basic'          // Email/phone verified (Level 0)
  | 'standard'       // ID document verified (Level 1)
  | 'enhanced'       // ID + address proof (Level 2)
  | 'full'           // ID + address + source of funds (Level 3)
  | 'professional';  // Corporate/institutional (Level 4)

/**
 * KYC verification status
 */
export type KYCStatus =
  | 'pending'        // Awaiting documents/verification
  | 'in_review'      // Documents submitted, under review
  | 'approved'       // Verification successful
  | 'rejected'       // Verification failed
  | 'expired'        // Verification expired (re-verification needed)
  | 'suspended'      // Suspended due to suspicious activity
  | 'manual_review'; // Needs human review (edge cases)

/**
 * Risk assessment levels
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ═══════════════════════════════════════════════════════════════════
// Document Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Supported document types for verification
 */
export type DocumentType =
  // Identity Documents
  | 'passport'
  | 'national_id'
  | 'drivers_license'
  | 'residence_permit'
  | 'visa'
  // Address Documents
  | 'utility_bill'
  | 'bank_statement'
  | 'tax_document'
  | 'government_letter'
  | 'rental_agreement'
  // Financial Documents
  | 'proof_of_income'
  | 'employment_letter'
  | 'tax_return'
  | 'investment_statement'
  | 'crypto_wallet_proof'
  // Corporate Documents
  | 'company_registration'
  | 'articles_of_incorporation'
  | 'shareholder_register'
  | 'board_resolution'
  | 'annual_report'
  | 'beneficial_owner_declaration'
  // Biometric
  | 'selfie'
  | 'liveness_video'
  // Other
  | 'other';

/**
 * Document category groupings
 */
export type DocumentCategory = 'identity' | 'address' | 'financial' | 'corporate' | 'biometric';

/**
 * Document verification status
 */
export type DocumentStatus = 'pending' | 'processing' | 'verified' | 'rejected' | 'expired';

// ═══════════════════════════════════════════════════════════════════
// KYC Profile - Core Entity
// ═══════════════════════════════════════════════════════════════════

/**
 * Main KYC profile for a user
 */
export interface KYCProfile extends CoreUserEntity {
  // Current State
  currentTier: KYCTier;
  status: KYCStatus;
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  
  // Personal Information (encrypted at rest)
  personalInfo?: PersonalInfo;
  
  // Addresses
  addresses: KYCAddress[];
  
  // Verifications (history)
  verifications: KYCVerification[];
  
  // Documents
  documents: KYCDocument[];
  
  // Compliance Checks
  amlChecks: AMLCheck[];
  pepScreenings: PEPScreening[];
  sanctionScreenings: SanctionScreening[];
  
  // Source of Funds (for enhanced/full tiers)
  sourceOfFunds?: SourceOfFunds;
  
  // Business KYC (for professional tier)
  businessInfo?: BusinessKYC;
  
  // Risk Assessments
  riskAssessments: RiskAssessment[];
  
  // Expiration & Review
  expiresAt?: Date;
  lastVerifiedAt?: Date;
  nextReviewAt?: Date;
  
  // Provider References (for external provider sync)
  providerReferences: ProviderReference[];
  
  // Jurisdiction
  jurisdictionCode: string; // ISO 3166-1 alpha-2
  
  // Flags
  isPEP: boolean;
  isHighRisk: boolean;
  requiresEnhancedDueDiligence: boolean;
  
  // Status History (audit trail)
  statusHistory: CoreStatusHistoryEntry[];
}

/**
 * Personal information collected during KYC
 */
export interface PersonalInfo {
  // Name
  firstName: string;
  lastName: string;
  middleName?: string;
  
  // Demographics
  dateOfBirth: Date;
  placeOfBirth?: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  // Nationality & Residence
  nationality: string; // ISO 3166-1 alpha-2
  countryOfResidence: string;
  citizenships?: string[]; // Multiple citizenships
  
  // Identifiers
  taxIdentificationNumber?: string;
  socialSecurityNumber?: string;
  nationalIdNumber?: string;
  passportNumber?: string;
  
  // Contact (optional, may already be in auth-service)
  email?: string;
  phone?: string;
  
  // Occupation
  occupation?: string;
  employerName?: string;
  employerIndustry?: string;
}

/**
 * Address information
 */
export interface KYCAddress {
  id: string;
  type: 'residential' | 'mailing' | 'business' | 'registered';
  
  // Address Fields
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  
  // Status
  isPrimary: boolean;
  isVerified: boolean;
  verifiedAt?: Date;
  verifiedBy?: string; // Document ID that verified this address
  
  // Validity
  validFrom?: Date;
  validUntil?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Documents
// ═══════════════════════════════════════════════════════════════════

/**
 * KYC Document
 */
export interface KYCDocument extends BaseEntity {
  profileId: string;
  
  // Document Classification
  type: DocumentType;
  category: DocumentCategory;
  
  // Document Details
  documentNumber?: string;
  issuingCountry?: string;
  issuingAuthority?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  
  // Files
  files: DocumentFile[];
  
  // Verification
  status: DocumentStatus;
  verificationResult?: DocumentVerificationResult;
  verifiedAt?: Date;
  verifiedBy?: string; // 'system' or admin user ID
  
  // Provider Reference
  providerId?: string;
  providerDocumentId?: string;
  
  // Rejection
  rejectionReason?: string;
  rejectionDetails?: string[];
  
  // Audit
  uploadedAt: Date;
  uploadedBy: string;
  processedAt?: Date;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Document file reference
 */
export interface DocumentFile {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  
  // Storage
  storageRef: string; // Reference to secure storage (S3, Azure Blob, etc.)
  encryptionKeyRef?: string; // Reference to encryption key in KMS
  
  // Integrity
  checksum: string; // SHA-256
  checksumAlgorithm: 'sha256';
  
  // Image Processing
  thumbnailRef?: string;
  processedRef?: string; // OCR-enhanced, etc.
  
  uploadedAt: Date;
}

/**
 * Result from document verification
 */
export interface DocumentVerificationResult {
  isAuthentic: boolean;
  isExpired: boolean;
  
  // Confidence
  confidenceScore?: number; // 0-100
  
  // Fraud Detection
  fraudScore?: number; // 0-100
  fraudIndicators?: string[];
  
  // Extracted Data
  extractedData?: ExtractedDocumentData;
  
  // Data Matching
  dataMatchScore?: number; // How well extracted data matches profile
  dataDiscrepancies?: string[];
  
  // Warnings
  warnings?: string[];
  
  // Provider
  provider: string;
  providerVerificationId: string;
  providerResponse?: Record<string, unknown>;
  
  verifiedAt: Date;
}

/**
 * Data extracted from document via OCR/AI
 */
export interface ExtractedDocumentData {
  // Name
  firstName?: string;
  lastName?: string;
  middleName?: string;
  fullName?: string;
  
  // Document
  documentNumber?: string;
  issuingCountry?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  
  // Personal
  dateOfBirth?: Date;
  gender?: string;
  nationality?: string;
  placeOfBirth?: string;
  
  // Address (from address documents)
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  
  // MRZ (Machine Readable Zone for passports/IDs)
  mrz?: {
    line1?: string;
    line2?: string;
    line3?: string;
  };
  
  // Raw extraction
  raw?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Verification Flow
// ═══════════════════════════════════════════════════════════════════

/**
 * A verification attempt/session
 */
export interface KYCVerification extends BaseEntity {
  profileId: string;
  
  // Target
  targetTier: KYCTier;
  fromTier: KYCTier;
  
  // Status
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'expired' | 'cancelled';
  
  // Requirements
  requirements: VerificationRequirement[];
  
  // Provider Session
  providerSession?: ProviderSession;
  
  // Result
  result?: VerificationResult;
  
  // Timing
  startedAt: Date;
  completedAt?: Date;
  expiresAt: Date;
  
  // Initiator
  initiatedBy: TriggeredBy;
  initiatedByUserId?: string;
  
  // Notes
  notes?: string;
  internalNotes?: string; // Admin only
}

/**
 * A single requirement for verification
 */
export interface VerificationRequirement {
  id: string;
  type: 'document' | 'check' | 'information' | 'biometric';
  name: string;
  description?: string;
  
  // For document requirements
  documentTypes?: DocumentType[];
  documentCategory?: DocumentCategory;
  
  // For check requirements
  checkType?: 'aml' | 'pep' | 'sanctions' | 'liveness' | 'face_match' | 'address_verification';
  
  // For information requirements
  fields?: string[];
  
  // Status
  status: 'pending' | 'in_progress' | 'satisfied' | 'failed' | 'waived';
  
  // Satisfaction
  satisfiedBy?: string; // Document ID, check ID, etc.
  satisfiedAt?: Date;
  
  // Config
  optional: boolean;
  order: number; // Display order
}

/**
 * Provider verification session
 */
export interface ProviderSession {
  provider: string;
  sessionId: string;
  applicantId: string;
  
  // For redirect-based flows
  sessionUrl?: string;
  sessionToken?: string;
  
  // For SDK-based flows
  sdkToken?: string;
  
  expiresAt: Date;
  
  // Webhook
  webhookReceived: boolean;
  webhookReceivedAt?: Date;
}

/**
 * Verification result
 */
export interface VerificationResult {
  decision: 'approved' | 'rejected' | 'manual_review';
  reasons: string[];
  
  // If approved
  newTier?: KYCTier;
  
  // If rejected
  rejectionCode?: string;
  canRetry: boolean;
  retryAfter?: Date;
  
  // Admin Override
  overriddenBy?: string;
  overrideReason?: string;
  overriddenAt?: Date;
  
  // Provider
  providerDecision?: string;
  providerReasons?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// AML/PEP/Sanctions Screening
// ═══════════════════════════════════════════════════════════════════

/**
 * Anti-Money Laundering check
 */
export interface AMLCheck {
  id: string;
  profileId: string;
  
  type: 'initial' | 'periodic' | 'triggered' | 'transaction';
  triggerReason?: string;
  
  // Provider
  provider: string;
  providerCheckId: string;
  
  // Result
  status: 'pending' | 'clear' | 'match' | 'potential_match' | 'error';
  
  // Match Details
  matchDetails?: {
    matchCount: number;
    highestMatchScore: number;
    matches: MatchedEntity[];
    requiresManualReview: boolean;
  };
  
  // Review
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewDecision?: 'clear' | 'block' | 'monitor';
  reviewNotes?: string;
  
  // Timing
  performedAt: Date;
  nextScheduledAt?: Date;
  
  // Provider Response
  providerResponse?: Record<string, unknown>;
}

/**
 * Politically Exposed Person screening
 */
export interface PEPScreening {
  id: string;
  profileId: string;
  
  // Provider
  provider: string;
  providerCheckId: string;
  
  // Result
  isPEP: boolean;
  pepType?: 'direct' | 'relative' | 'close_associate';
  pepCategory?: 'head_of_state' | 'government' | 'judicial' | 'military' | 'diplomatic' | 'political_party' | 'state_owned_enterprise' | 'international_organization';
  
  // Details
  pepDetails?: {
    position?: string;
    organization?: string;
    country?: string;
    startDate?: Date;
    endDate?: Date;
    isFormer?: boolean;
  };
  
  // Risk
  requiresEnhancedDueDiligence: boolean;
  riskMultiplier?: number;
  
  performedAt: Date;
  providerResponse?: Record<string, unknown>;
}

/**
 * Sanctions list screening
 */
export interface SanctionScreening {
  id: string;
  profileId: string;
  
  // Provider
  provider: string;
  providerCheckId: string;
  
  // Lists Checked
  listsChecked: string[]; // OFAC, EU, UN, etc.
  
  // Result
  result: 'clear' | 'match' | 'potential_match' | 'error';
  
  // Match Details
  matchDetails?: MatchedEntity[];
  
  // If match found
  blockedListName?: string;
  blockingAction?: 'block' | 'flag' | 'monitor';
  
  performedAt: Date;
  providerResponse?: Record<string, unknown>;
}

/**
 * Matched entity from screening
 */
export interface MatchedEntity {
  id: string;
  name: string;
  matchScore: number; // 0-100
  matchType: 'exact' | 'partial' | 'fuzzy' | 'alias';
  
  // Entity Info
  entityType: 'person' | 'organization' | 'vessel' | 'aircraft' | 'unknown';
  
  // List Info
  listName: string;
  listType: 'sanctions' | 'pep' | 'adverse_media' | 'watchlist' | 'enforcement';
  
  // Details
  details?: {
    aliases?: string[];
    dateOfBirth?: string;
    nationality?: string[];
    addresses?: string[];
    programs?: string[]; // Sanction programs
    remarks?: string;
  };
  
  // Source
  sourceUrl?: string;
  sourceDate?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Source of Funds / Enhanced Due Diligence
// ═══════════════════════════════════════════════════════════════════

/**
 * Source of funds declaration
 */
export interface SourceOfFunds {
  id: string;
  profileId: string;
  
  // Primary Source
  primarySource: FundsSource;
  primarySourceDetails?: string;
  
  // Additional Sources
  additionalSources?: {
    source: FundsSource;
    details?: string;
    percentage?: number;
  }[];
  
  // Expected Activity
  expectedMonthlyDeposit?: MoneyRange;
  expectedMonthlyWithdrawal?: MoneyRange;
  expectedTransactionCount?: {
    min: number;
    max: number;
  };
  
  // Verification
  status: 'pending' | 'verified' | 'rejected' | 'requires_documentation';
  supportingDocumentIds: string[];
  
  verifiedAt?: Date;
  verifiedBy?: string;
  rejectionReason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Source of funds categories
 */
export type FundsSource =
  | 'employment_income'
  | 'self_employment'
  | 'business_profits'
  | 'investments'
  | 'dividends'
  | 'rental_income'
  | 'inheritance'
  | 'gift'
  | 'property_sale'
  | 'pension'
  | 'savings'
  | 'lottery_gambling'
  | 'crypto_trading'
  | 'loan'
  | 'government_benefits'
  | 'legal_settlement'
  | 'other';

/**
 * Money range
 */
export interface MoneyRange {
  min: number;
  max: number;
  currency: string;
}

// ═══════════════════════════════════════════════════════════════════
// Corporate KYC (KYB - Know Your Business)
// ═══════════════════════════════════════════════════════════════════

/**
 * Business/Corporate KYC
 */
export interface BusinessKYC {
  id: string;
  profileId: string;
  
  // Company Identification
  companyName: string;
  tradingName?: string;
  registrationNumber: string;
  registrationCountry: string;
  incorporationDate?: Date;
  
  // Company Type
  companyType: 'corporation' | 'llc' | 'partnership' | 'sole_proprietor' | 'trust' | 'foundation' | 'cooperative' | 'other';
  
  // Tax
  taxIdentificationNumber?: string;
  vatNumber?: string;
  
  // Addresses
  registeredAddress: KYCAddress;
  businessAddress?: KYCAddress;
  
  // Ownership Structure
  beneficialOwners: BeneficialOwner[];
  shareholderStructure?: ShareholderEntry[];
  
  // Management
  directors: CorporateOfficer[];
  authorizedSignatories: CorporateOfficer[];
  
  // Business Activity
  industryCode?: string; // NAICS, NACE, SIC
  industryDescription?: string;
  businessDescription?: string;
  website?: string;
  
  // Financial
  annualRevenue?: MoneyRange;
  employeeCount?: {
    min: number;
    max: number;
  };
  
  // Verification
  status: 'pending' | 'verified' | 'rejected';
  verifiedAt?: Date;
  verifiedBy?: string;
  
  // Documents
  documentIds: string[];
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Beneficial Owner (UBO)
 */
export interface BeneficialOwner {
  id: string;
  
  // Link to User (if they have an account)
  userId?: string;
  kycProfileId?: string;
  
  // Personal Details
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  nationality?: string;
  countryOfResidence?: string;
  
  // Ownership
  ownershipPercentage: number;
  ownershipType: 'direct' | 'indirect' | 'control_without_ownership';
  controlType?: 'voting_rights' | 'board_appointment' | 'veto_rights' | 'other';
  
  // Verification
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedAt?: Date;
  
  // Document
  documentIds: string[];
  
  // PEP Status
  isPEP: boolean;
  pepDetails?: PEPScreening;
}

/**
 * Shareholder entry in structure
 */
export interface ShareholderEntry {
  id: string;
  
  // Entity
  type: 'individual' | 'company' | 'trust' | 'other';
  name: string;
  registrationNumber?: string; // For companies
  country?: string;
  
  // Ownership
  ownershipPercentage: number;
  shareClass?: string;
  
  // Nested structure (for chains)
  parentId?: string; // Parent shareholder
}

/**
 * Corporate officer/director
 */
export interface CorporateOfficer {
  id: string;
  
  role: 'director' | 'ceo' | 'cfo' | 'coo' | 'secretary' | 'treasurer' | 'authorized_signatory' | 'compliance_officer' | 'other';
  roleDescription?: string;
  
  // Personal
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  nationality?: string;
  
  // Link
  userId?: string;
  kycProfileId?: string;
  
  // Appointment
  appointedAt?: Date;
  terminatedAt?: Date;
  
  // Verification
  verificationStatus: 'pending' | 'verified' | 'rejected';
  
  // PEP
  isPEP: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Risk Assessment
// ═══════════════════════════════════════════════════════════════════

/**
 * Risk assessment record
 */
export interface RiskAssessment {
  id: string;
  profileId: string;
  
  type: 'initial' | 'periodic' | 'triggered' | 'upgrade';
  triggerReason?: string;
  
  // Risk Factors
  factors: RiskFactor[];
  
  // Calculated Score
  score: number; // 0-100
  level: RiskLevel;
  previousLevel?: RiskLevel;
  
  // Recommendations
  recommendations: string[];
  requiredActions?: RequiredAction[];
  
  // Review
  assessedAt: Date;
  assessedBy: 'system' | string;
  
  reviewRequired: boolean;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  reviewDecision?: 'accept' | 'escalate' | 'block';
}

/**
 * Individual risk factor
 */
export interface RiskFactor {
  id: string;
  category: 'geography' | 'customer_type' | 'product' | 'channel' | 'activity' | 'compliance';
  name: string;
  
  // Scoring
  weight: number; // Factor weight
  score: number; // Raw score 0-100
  weightedScore: number; // weight * score
  
  // Details
  details?: string;
  evidence?: string[];
  
  // Thresholds
  isHighRisk: boolean;
  threshold?: number;
}

/**
 * Required action from risk assessment
 */
export interface RequiredAction {
  type: 'document_upload' | 'verification' | 'manual_review' | 'limit_reduction' | 'account_suspension' | 'enhanced_monitoring';
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: Date;
  completedAt?: Date;
  completedBy?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Provider References
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to external provider
 */
export interface ProviderReference {
  provider: string;
  externalId: string;
  applicantId?: string;
  
  createdAt: Date;
  lastSyncedAt?: Date;
  syncStatus?: 'synced' | 'pending' | 'error';
  
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Input Types
// ═══════════════════════════════════════════════════════════════════

export interface CreateKYCProfileInput {
  userId: string;
  tenantId: string;
  jurisdictionCode: string;
  personalInfo?: Partial<PersonalInfo>;
}

export interface StartVerificationInput {
  profileId?: string; // If not provided, uses current user's profile
  targetTier: KYCTier;
  redirectUrl?: string; // For redirect-based flows
  preferredProvider?: string;
}

export interface UploadDocumentInput {
  profileId?: string;
  type: DocumentType;
  files: {
    data: ArrayBuffer | string; // ArrayBuffer or base64
    filename: string;
    mimeType: string;
  }[];
  documentNumber?: string;
  issuingCountry?: string;
  issuedAt?: Date;
  expiresAt?: Date;
}

export interface UpdatePersonalInfoInput {
  profileId?: string;
  personalInfo: Partial<PersonalInfo>;
}

export interface AddAddressInput {
  profileId?: string;
  address: Omit<KYCAddress, 'id' | 'isVerified' | 'verifiedAt' | 'verifiedBy' | 'createdAt' | 'updatedAt'>;
}

export interface ApproveVerificationInput {
  verificationId: string;
  notes?: string;
  newTier?: KYCTier; // Override if different from target
}

export interface RejectVerificationInput {
  verificationId: string;
  reason: string;
  details?: string[];
  canRetry?: boolean;
  retryAfterDays?: number;
}

export interface SubmitSourceOfFundsInput {
  profileId?: string;
  primarySource: FundsSource;
  primarySourceDetails?: string;
  additionalSources?: {
    source: FundsSource;
    details?: string;
    percentage?: number;
  }[];
  expectedMonthlyDeposit?: MoneyRange;
  expectedMonthlyWithdrawal?: MoneyRange;
  supportingDocumentIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Check Results
// ═══════════════════════════════════════════════════════════════════

/**
 * Result of transaction limit check
 */
export interface TransactionLimitCheck {
  allowed: boolean;
  reason?: string;
  
  // Current limits
  limits?: {
    single: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
  
  // Usage
  usage?: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  
  // If not allowed
  requiredTier?: KYCTier;
  requiresAdditionalVerification?: boolean;
  upgradeUrl?: string;
}

/**
 * KYC eligibility check result
 */
export interface KYCEligibility {
  currentTier: KYCTier;
  currentStatus: KYCStatus;
  meetsRequirement: boolean;
  
  requiredTier?: KYCTier;
  missingRequirements?: string[];
  upgradeUrl?: string;
  
  // Expiration warning
  isExpiringSoon?: boolean;
  expiresAt?: Date;
}
