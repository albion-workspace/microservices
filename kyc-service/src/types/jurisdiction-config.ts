/**
 * Jurisdiction Configuration Types
 * 
 * Define KYC requirements per jurisdiction/country
 * Supports regulatory requirements for:
 * - MGA (Malta Gaming Authority)
 * - UKGC (UK Gambling Commission)
 * - FINCEN (US Financial Crimes Enforcement)
 * - 5AMLD/6AMLD (EU Anti-Money Laundering)
 * - MiCA (EU Markets in Crypto-Assets)
 * - Various national regulations
 */

import type { Domain } from 'core-service';
import type { 
  KYCTier, 
  DocumentType, 
  DocumentCategory,
  RiskLevel 
} from './kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Jurisdiction Configuration
// ═══════════════════════════════════════════════════════════════════

/**
 * Complete jurisdiction configuration
 */
export interface JurisdictionConfig {
  // Identification
  code: string; // ISO 3166-1 alpha-2
  name: string;
  region?: string; // EU, NA, APAC, etc.
  
  // Regulatory Framework
  regulatoryBody?: string;
  regulatoryFramework?: string[]; // GDPR, 5AMLD, MGA, etc.
  
  // Tier Requirements
  tierRequirements: Record<KYCTier, TierRequirements>;
  
  // Transaction Limits per Tier
  limits: Record<KYCTier, TransactionLimits>;
  
  // AML/Compliance
  amlRequirements: AMLRequirements;
  
  // Document Acceptance
  acceptedDocuments: AcceptedDocuments;
  
  // Verification Expiry
  verificationExpiry: VerificationExpiry;
  
  // Special Rules
  specialRules: JurisdictionSpecialRules;
  
  // Provider Preferences
  preferredProviders?: string[];
  excludedProviders?: string[];
  
  // Risk Configuration
  riskConfig: JurisdictionRiskConfig;
  
  // Active
  isActive: boolean;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/**
 * Requirements for a specific KYC tier
 */
export interface TierRequirements {
  // Tier Info
  tier: KYCTier;
  displayName: string;
  description: string;
  
  // Required Documents
  documents: DocumentRequirement[];
  
  // Required Checks
  checks: CheckRequirement[];
  
  // Required Information
  information: InformationRequirement[];
  
  // Prerequisites
  prerequisiteTier?: KYCTier; // Must have this tier first
  minimumAge?: number;
  minimumAccountAge?: number; // Days
  
  // Auto-approval
  allowAutoApproval: boolean;
  autoApprovalConditions?: string[];
  
  // Timing
  processingTime?: string; // Human-readable, e.g., "1-2 business days"
  validityPeriod?: number; // Days
}

/**
 * Document requirement
 */
export interface DocumentRequirement {
  id: string;
  name: string;
  description?: string;
  
  category: DocumentCategory;
  acceptedTypes: DocumentType[];
  
  required: boolean;
  
  // Quantity
  minCount?: number; // Default 1
  maxCount?: number;
  
  // Validation Rules
  mustNotBeExpired?: boolean;
  minValidityDays?: number; // Document must be valid for at least X days
  maxAgeDays?: number; // Document must be issued within X days
  
  // Country Restrictions
  acceptedCountries?: string[]; // If empty, all countries
  rejectedCountries?: string[];
  
  // Alternatives
  alternativeGroupId?: string; // Group of alternatives (submit any one)
}

/**
 * Check requirement (AML, PEP, etc.)
 */
export interface CheckRequirement {
  id: string;
  name: string;
  description?: string;
  
  type: 'aml' | 'pep' | 'sanctions' | 'liveness' | 'face_match' | 'address_verification' | 'phone_verification' | 'email_verification';
  
  required: boolean;
  
  // Configuration
  config?: {
    // For sanctions
    sanctionLists?: string[];
    
    // For liveness
    livenessLevel?: 'basic' | 'enhanced';
    
    // For face match
    matchThreshold?: number;
    
    // For address verification
    acceptedMethods?: ('document' | 'database' | 'postal')[];
  };
  
  // Provider
  preferredProvider?: string;
}

/**
 * Information field requirement
 */
export interface InformationRequirement {
  id: string;
  fieldPath: string; // e.g., 'personalInfo.dateOfBirth'
  displayName: string;
  description?: string;
  
  required: boolean;
  
  // Validation
  validationType?: 'date' | 'string' | 'number' | 'email' | 'phone' | 'country' | 'enum';
  validationRules?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enumValues?: string[];
    minAge?: number;
    maxAge?: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Transaction Limits
// ═══════════════════════════════════════════════════════════════════

/**
 * Transaction limits for a tier
 */
export interface TransactionLimits {
  // Currency for these limits
  currency: string;
  
  // Deposit Limits
  deposit: OperationLimits;
  
  // Withdrawal Limits
  withdrawal: OperationLimits;
  
  // Transfer Limits (P2P)
  transfer?: OperationLimits;
  
  // Balance Limits
  maxBalance?: number;
  
  // Crypto-specific
  crypto?: {
    deposit: OperationLimits;
    withdrawal: OperationLimits;
  };
}

/**
 * Limits for a specific operation type
 */
export interface OperationLimits {
  // Per Transaction
  minAmount?: number;
  maxAmount: number;
  
  // Aggregate
  dailyLimit: number;
  weeklyLimit?: number;
  monthlyLimit: number;
  yearlyLimit?: number;
  
  // Count
  maxDailyTransactions?: number;
  maxMonthlyTransactions?: number;
}

// ═══════════════════════════════════════════════════════════════════
// AML Requirements
// ═══════════════════════════════════════════════════════════════════

/**
 * AML/Compliance requirements
 */
export interface AMLRequirements {
  // Initial Screening
  initialScreeningRequired: boolean;
  initialScreeningTier?: KYCTier; // Tier at which initial screening is done
  
  // Periodic Screening
  periodicScreeningRequired: boolean;
  periodicScreeningInterval?: number; // Days
  
  // PEP
  pepScreeningRequired: boolean;
  pepScreeningInterval?: number; // Days
  pepEnhancedDueDiligence: boolean;
  
  // Sanctions
  sanctionScreeningRequired: boolean;
  sanctionLists: string[]; // OFAC, EU, UN, etc.
  
  // Source of Funds
  sourceOfFundsRequired: boolean;
  sourceOfFundsThreshold?: number; // Amount that triggers SOF
  sourceOfFundsCurrency?: string;
  
  // Enhanced Due Diligence Triggers
  eddTriggers: EDDTrigger[];
  
  // Suspicious Activity
  sarThreshold?: number; // Transaction amount for SAR consideration
  transactionMonitoringRequired: boolean;
}

/**
 * Enhanced Due Diligence trigger
 */
export interface EDDTrigger {
  type: 'pep' | 'high_risk_country' | 'high_value' | 'unusual_activity' | 'adverse_media' | 'complex_structure';
  description: string;
  automatic: boolean;
  threshold?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Document Acceptance
// ═══════════════════════════════════════════════════════════════════

/**
 * Accepted documents by category
 */
export interface AcceptedDocuments {
  identity: DocumentAcceptanceRule[];
  address: DocumentAcceptanceRule[];
  financial: DocumentAcceptanceRule[];
  corporate: DocumentAcceptanceRule[];
}

/**
 * Document acceptance rule
 */
export interface DocumentAcceptanceRule {
  type: DocumentType;
  accepted: boolean;
  
  // Conditions
  conditions?: {
    // Country restrictions
    acceptedCountries?: string[];
    rejectedCountries?: string[];
    
    // Validity
    maxAgeDays?: number;
    minValidityDays?: number;
    
    // Format
    acceptedFormats?: string[]; // PDF, JPG, PNG
    maxFileSizeMB?: number;
    
    // Quality
    minResolution?: { width: number; height: number };
  };
  
  // Notes
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Verification Expiry
// ═══════════════════════════════════════════════════════════════════

/**
 * Verification expiry configuration
 */
export interface VerificationExpiry {
  // Per Tier
  tierExpiry: Record<KYCTier, number | null>; // Days, null = never expires
  
  // Document Expiry Warning
  documentExpiryWarningDays: number;
  
  // Re-verification
  reVerificationGracePeriod: number; // Days after expiry
  reVerificationRequirements?: 'full' | 'simplified';
  
  // Auto-downgrade
  autoDowngradeOnExpiry: boolean;
  downgradeToTier?: KYCTier;
}

// ═══════════════════════════════════════════════════════════════════
// Special Rules
// ═══════════════════════════════════════════════════════════════════

/**
 * Jurisdiction-specific special rules
 */
export interface JurisdictionSpecialRules {
  // Age
  minimumAge: number;
  maximumAge?: number;
  
  // Residency
  requireLocalResidence: boolean;
  requireLocalAddress: boolean;
  requireLocalBankAccount: boolean;
  
  // Nationality
  restrictedNationalities: string[];
  allowedNationalities?: string[]; // If set, only these are allowed
  
  // High Risk Countries
  highRiskCountries: string[];
  blockedCountries: string[];
  
  // Self-exclusion (gambling)
  selfExclusionRequired?: boolean;
  selfExclusionDatabases?: string[];
  
  // Cooling-off periods (gambling)
  coolingOffRequired?: boolean;
  coolingOffPeriodHours?: number;
  
  // Time restrictions (gambling)
  sessionTimeLimit?: number; // Minutes
  dailyTimeLimit?: number; // Minutes
  
  // Reality checks (gambling)
  realityCheckRequired?: boolean;
  realityCheckInterval?: number; // Minutes
  
  // Responsible gambling
  responsibleGamblingRequired?: boolean;
  depositLimitRequired?: boolean;
  lossLimitRequired?: boolean;
  
  // Tax
  taxDocumentationRequired?: boolean;
  taxReportingRequired?: boolean;
  
  // Corporate
  uboThreshold?: number; // Percentage for UBO identification
  maxOwnershipLayers?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Risk Configuration
// ═══════════════════════════════════════════════════════════════════

/**
 * Jurisdiction-specific risk configuration
 */
export interface JurisdictionRiskConfig {
  // Base risk score for this jurisdiction
  baseRiskScore: number; // 0-100
  
  // Risk category
  riskCategory: RiskLevel;
  
  // FATF Status
  fatfStatus?: 'member' | 'grey_list' | 'black_list' | 'none';
  
  // Risk multipliers
  multipliers: {
    pep: number;
    highRiskCountry: number;
    complexStructure: number;
    highValue: number;
    cashIntensive: number;
    cryptoRelated: number;
  };
  
  // Thresholds
  thresholds: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    criticalRisk: number;
  };
  
  // Auto-actions
  autoActions: {
    highRisk: ('manual_review' | 'enhanced_monitoring' | 'limit_reduction')[];
    criticalRisk: ('manual_review' | 'account_suspension' | 'report_to_authority')[];
  };
}

// ═══════════════════════════════════════════════════════════════════
// Domain Configuration
// ═══════════════════════════════════════════════════════════════════

/**
 * Domain-specific KYC configuration
 */
export interface DomainKYCConfig {
  // Domain
  domain: Domain;
  displayName: string;
  
  // Available Tiers
  availableTiers: KYCTier[];
  defaultTier: KYCTier;
  
  // Minimum Tiers for Operations
  minimumTiers: {
    registration?: KYCTier;
    deposit?: KYCTier;
    withdrawal?: KYCTier;
    transfer?: KYCTier;
    trading?: KYCTier;
    betting?: KYCTier;
    bonusClaim?: KYCTier;
  };
  
  // Limit Multipliers (per domain)
  limitMultipliers?: {
    deposit?: number;
    withdrawal?: number;
    transfer?: number;
  };
  
  // Risk Weights
  riskWeights: {
    highValueCustomer?: number;
    frequentTrader?: number;
    crossBorderActivity?: number;
    cryptoActivity?: number;
    gamblingActivity?: number;
  };
  
  // Additional Checks
  additionalChecks: {
    type: string;
    name: string;
    description: string;
    requiredTier: KYCTier;
    provider?: string;
  }[];
  
  // Domain-specific rules
  domainRules?: {
    // Gambling
    selfExclusionCheck?: boolean;
    responsibleGamblingRequired?: boolean;
    affordabilityCheck?: boolean;
    
    // Crypto
    walletAddressVerification?: boolean;
    travelRuleCompliance?: boolean;
    
    // Finance
    accreditedInvestorCheck?: boolean;
    suitabilityAssessment?: boolean;
  };
  
  // Active
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Configuration Update Inputs
// ═══════════════════════════════════════════════════════════════════

export interface UpdateJurisdictionConfigInput {
  code: string;
  config: Partial<Omit<JurisdictionConfig, 'code' | 'createdAt' | 'updatedAt' | 'version'>>;
}

export interface UpdateDomainConfigInput {
  domain: Domain;
  config: Partial<Omit<DomainKYCConfig, 'domain'>>;
}

// ═══════════════════════════════════════════════════════════════════
// Resolved Configuration
// ═══════════════════════════════════════════════════════════════════

/**
 * Fully resolved configuration for a user
 * Combines jurisdiction + domain + user-specific overrides
 */
export interface ResolvedKYCConfig {
  userId: string;
  tenantId: string;
  
  jurisdictionCode: string;
  domain: Domain;
  
  // Current user tier
  currentTier: KYCTier;
  
  // Effective requirements for next tier
  nextTier?: KYCTier;
  nextTierRequirements?: TierRequirements;
  
  // Effective limits
  effectiveLimits: TransactionLimits;
  
  // Required checks
  requiredChecks: {
    aml: boolean;
    pep: boolean;
    sanctions: boolean;
    sourceOfFunds: boolean;
  };
  
  // Risk profile
  baseRiskScore: number;
  riskMultipliers: Record<string, number>;
  
  // Special rules applied
  appliedRules: string[];
  
  // Computed at
  computedAt: Date;
}
