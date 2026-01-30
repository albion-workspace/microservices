/**
 * KYCEligibility - Client-Safe KYC Validation & Eligibility Checker
 * 
 * A static class for checking KYC eligibility, limits, and requirements on client-side.
 * No database dependencies - pure functions only.
 * 
 * Usage:
 * ```typescript
 * import { KYCEligibility } from 'shared-validators';
 * 
 * // Check if user can make a transaction
 * const result = KYCEligibility.checkTransaction(limits, {
 *   currentTier: 'basic',
 *   transactionType: 'withdrawal',
 *   amount: 5000,
 *   currency: 'EUR',
 *   usedToday: 1000,
 *   usedThisMonth: 10000,
 * });
 * 
 * if (!result.allowed) {
 *   console.log(result.reason);
 *   console.log(`Remaining: ${result.remaining}`);
 * }
 * 
 * // Get requirements for next tier
 * const requirements = KYCEligibility.getTierRequirements('enhanced');
 * 
 * // Check if user can access a feature
 * const canWithdraw = KYCEligibility.canPerformAction('withdrawal', 'basic', 'standard');
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (Self-contained)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * KYC verification tiers - ordered from lowest to highest
 */
export type KYCTier = 'none' | 'basic' | 'standard' | 'enhanced' | 'full' | 'professional';

/**
 * KYC verification status
 */
export type KYCStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'suspended' | 'manual_review';

/**
 * Risk assessment levels
 */
export type KYCRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Document types for verification
 */
export type KYCDocumentType =
  | 'passport' | 'national_id' | 'drivers_license' | 'residence_permit' | 'visa'
  | 'utility_bill' | 'bank_statement' | 'tax_document' | 'government_letter' | 'rental_agreement'
  | 'proof_of_income' | 'employment_letter' | 'tax_return' | 'investment_statement'
  | 'company_registration' | 'articles_of_incorporation' | 'shareholder_register'
  | 'selfie' | 'liveness_video' | 'other';

/**
 * Document categories
 */
export type KYCDocumentCategory = 'identity' | 'address' | 'financial' | 'corporate' | 'biometric';

/**
 * Transaction types
 */
export type KYCTransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'trade' | 'bet' | 'purchase';

/**
 * Limits for a specific operation type
 */
export interface KYCOperationLimits {
  minAmount?: number;
  maxAmount: number;
  dailyLimit: number;
  weeklyLimit?: number;
  monthlyLimit: number;
  yearlyLimit?: number;
  maxDailyTransactions?: number;
  maxMonthlyTransactions?: number;
}

/**
 * Transaction limits for a tier
 */
export interface KYCTierLimits {
  currency: string;
  deposit: KYCOperationLimits;
  withdrawal: KYCOperationLimits;
  transfer?: KYCOperationLimits;
  maxBalance?: number;
}

/**
 * Document requirement
 */
export interface KYCDocumentRequirement {
  id: string;
  name: string;
  description?: string;
  category: KYCDocumentCategory;
  acceptedTypes: KYCDocumentType[];
  required: boolean;
  minCount?: number;
  maxAgeDays?: number;
  mustNotBeExpired?: boolean;
}

/**
 * Check requirement (AML, PEP, etc.)
 */
export interface KYCCheckRequirement {
  id: string;
  name: string;
  type: 'aml' | 'pep' | 'sanctions' | 'liveness' | 'face_match' | 'address_verification';
  required: boolean;
}

/**
 * Information field requirement
 */
export interface KYCInfoRequirement {
  id: string;
  fieldPath: string;
  displayName: string;
  required: boolean;
}

/**
 * Complete tier requirements
 */
export interface KYCTierRequirements {
  tier: KYCTier;
  displayName: string;
  description: string;
  documents: KYCDocumentRequirement[];
  checks: KYCCheckRequirement[];
  information: KYCInfoRequirement[];
  prerequisiteTier?: KYCTier;
  minimumAge?: number;
}

/**
 * Context for transaction checking
 */
export interface KYCTransactionContext {
  currentTier: KYCTier;
  kycStatus?: KYCStatus;
  transactionType: KYCTransactionType;
  amount: number;
  currency: string;
  
  // Usage tracking
  usedToday?: number;
  usedThisWeek?: number;
  usedThisMonth?: number;
  usedThisYear?: number;
  transactionsToday?: number;
  transactionsThisMonth?: number;
  currentBalance?: number;
  
  // User info
  country?: string;
  userAge?: number;
  accountAgeDays?: number;
  
  // Verification status
  documentsExpireAt?: Date;
  
  // Time context
  currentDate?: Date;
}

/**
 * Context for general KYC eligibility checking
 */
export interface KYCEligibilityContext {
  userId?: string;
  tenantId?: string;
  currentTier: KYCTier;
  kycStatus: KYCStatus;
  country: string;
  
  // Risk
  riskLevel?: KYCRiskLevel;
  riskScore?: number;
  
  // Documents
  hasIdentityDoc?: boolean;
  hasAddressDoc?: boolean;
  hasFinancialDoc?: boolean;
  documentsExpireAt?: Date;
  
  // Checks completed
  amlCheckPassed?: boolean;
  pepCheckPassed?: boolean;
  sanctionsCheckPassed?: boolean;
  livenessCheckPassed?: boolean;
  
  // User info
  userAge?: number;
  accountAgeDays?: number;
  isPEP?: boolean;
  
  // Time context
  currentDate?: Date;
}

/**
 * Transaction check result
 */
export interface KYCTransactionResult {
  allowed: boolean;
  reason?: string;
  
  // Limits info
  remaining?: number;
  dailyRemaining?: number;
  monthlyRemaining?: number;
  maxAllowed?: number;
  
  // Upgrade info
  requiredTier?: KYCTier;
  upgradeMessage?: string;
}

/**
 * Tier eligibility result
 */
export interface KYCTierEligibilityResult {
  currentTier: KYCTier;
  targetTier: KYCTier;
  eligible: boolean;
  missingRequirements: string[];
  completedRequirements: string[];
  progress: number; // 0-100
}

/**
 * Action eligibility result
 */
export interface KYCActionResult {
  allowed: boolean;
  reason?: string;
  requiredTier?: KYCTier;
  requiredStatus?: KYCStatus;
}

/**
 * Jurisdiction rules for validation
 */
export interface KYCJurisdictionRules {
  code: string;
  name: string;
  minimumAge: number;
  blockedCountries: string[];
  highRiskCountries: string[];
  restrictedNationalities?: string[];
  requiresLocalResidence?: boolean;
  selfExclusionRequired?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tier hierarchy (lower index = lower tier)
 */
const TIER_LEVELS: Record<KYCTier, number> = {
  'none': 0,
  'basic': 1,
  'standard': 2,
  'enhanced': 3,
  'full': 4,
  'professional': 5,
};

/**
 * Tier display names
 */
const TIER_NAMES: Record<KYCTier, string> = {
  'none': 'Unverified',
  'basic': 'Basic',
  'standard': 'Standard',
  'enhanced': 'Enhanced',
  'full': 'Full',
  'professional': 'Professional',
};

/**
 * Tier descriptions
 */
const TIER_DESCRIPTIONS: Record<KYCTier, string> = {
  'none': 'No verification completed',
  'basic': 'Email and phone verified',
  'standard': 'Government-issued ID verified',
  'enhanced': 'ID and address verified',
  'full': 'Full KYC with source of funds',
  'professional': 'Corporate/institutional verification',
};

/**
 * Default tier requirements
 */
const DEFAULT_TIER_REQUIREMENTS: Record<KYCTier, KYCTierRequirements> = {
  none: {
    tier: 'none',
    displayName: TIER_NAMES.none,
    description: TIER_DESCRIPTIONS.none,
    documents: [],
    checks: [],
    information: [],
  },
  
  basic: {
    tier: 'basic',
    displayName: TIER_NAMES.basic,
    description: TIER_DESCRIPTIONS.basic,
    documents: [],
    checks: [
      { id: 'aml_basic', name: 'AML Screening', type: 'aml', required: true },
    ],
    information: [
      { id: 'firstName', fieldPath: 'personalInfo.firstName', displayName: 'First Name', required: true },
      { id: 'lastName', fieldPath: 'personalInfo.lastName', displayName: 'Last Name', required: true },
      { id: 'dob', fieldPath: 'personalInfo.dateOfBirth', displayName: 'Date of Birth', required: true },
      { id: 'email', fieldPath: 'personalInfo.email', displayName: 'Email Address', required: true },
    ],
  },
  
  standard: {
    tier: 'standard',
    displayName: TIER_NAMES.standard,
    description: TIER_DESCRIPTIONS.standard,
    prerequisiteTier: 'basic',
    documents: [
      { 
        id: 'identity', 
        name: 'Government-issued ID',
        category: 'identity',
        acceptedTypes: ['passport', 'national_id', 'drivers_license'],
        required: true,
        mustNotBeExpired: true,
      },
      {
        id: 'selfie',
        name: 'Selfie Photo',
        category: 'biometric',
        acceptedTypes: ['selfie'],
        required: true,
      },
    ],
    checks: [
      { id: 'aml', name: 'AML Screening', type: 'aml', required: true },
      { id: 'pep', name: 'PEP Screening', type: 'pep', required: true },
      { id: 'liveness', name: 'Liveness Check', type: 'liveness', required: true },
      { id: 'face_match', name: 'Face Match', type: 'face_match', required: true },
    ],
    information: [
      { id: 'nationality', fieldPath: 'personalInfo.nationality', displayName: 'Nationality', required: true },
      { id: 'residence', fieldPath: 'personalInfo.countryOfResidence', displayName: 'Country of Residence', required: true },
    ],
  },
  
  enhanced: {
    tier: 'enhanced',
    displayName: TIER_NAMES.enhanced,
    description: TIER_DESCRIPTIONS.enhanced,
    prerequisiteTier: 'standard',
    documents: [
      {
        id: 'address',
        name: 'Proof of Address',
        category: 'address',
        acceptedTypes: ['utility_bill', 'bank_statement', 'tax_document', 'government_letter'],
        required: true,
        maxAgeDays: 90,
      },
    ],
    checks: [
      { id: 'sanctions', name: 'Sanctions Screening', type: 'sanctions', required: true },
      { id: 'address_verify', name: 'Address Verification', type: 'address_verification', required: true },
    ],
    information: [
      { id: 'address', fieldPath: 'addresses', displayName: 'Residential Address', required: true },
    ],
  },
  
  full: {
    tier: 'full',
    displayName: TIER_NAMES.full,
    description: TIER_DESCRIPTIONS.full,
    prerequisiteTier: 'enhanced',
    documents: [
      {
        id: 'financial',
        name: 'Source of Funds Documentation',
        category: 'financial',
        acceptedTypes: ['proof_of_income', 'tax_return', 'bank_statement', 'employment_letter'],
        required: true,
      },
    ],
    checks: [],
    information: [
      { id: 'occupation', fieldPath: 'personalInfo.occupation', displayName: 'Occupation', required: true },
      { id: 'sof', fieldPath: 'sourceOfFunds', displayName: 'Source of Funds', required: true },
    ],
  },
  
  professional: {
    tier: 'professional',
    displayName: TIER_NAMES.professional,
    description: TIER_DESCRIPTIONS.professional,
    prerequisiteTier: 'enhanced',
    documents: [
      {
        id: 'company_reg',
        name: 'Company Registration Documents',
        category: 'corporate',
        acceptedTypes: ['company_registration', 'articles_of_incorporation'],
        required: true,
      },
      {
        id: 'ubo',
        name: 'Beneficial Owner Documentation',
        category: 'corporate',
        acceptedTypes: ['shareholder_register'],
        required: true,
      },
    ],
    checks: [],
    information: [
      { id: 'company_name', fieldPath: 'businessInfo.companyName', displayName: 'Company Name', required: true },
      { id: 'reg_number', fieldPath: 'businessInfo.registrationNumber', displayName: 'Registration Number', required: true },
      { id: 'ubos', fieldPath: 'businessInfo.beneficialOwners', displayName: 'Beneficial Owners', required: true },
    ],
  },
};

/**
 * Default tier limits (EUR)
 */
const DEFAULT_TIER_LIMITS: Record<KYCTier, KYCTierLimits> = {
  none: {
    currency: 'EUR',
    deposit: { minAmount: 10, maxAmount: 0, dailyLimit: 0, monthlyLimit: 0 },
    withdrawal: { minAmount: 10, maxAmount: 0, dailyLimit: 0, monthlyLimit: 0 },
  },
  
  basic: {
    currency: 'EUR',
    deposit: { minAmount: 10, maxAmount: 1000, dailyLimit: 2000, monthlyLimit: 5000 },
    withdrawal: { minAmount: 10, maxAmount: 500, dailyLimit: 1000, monthlyLimit: 2500 },
    transfer: { minAmount: 10, maxAmount: 500, dailyLimit: 1000, monthlyLimit: 2500 },
    maxBalance: 5000,
  },
  
  standard: {
    currency: 'EUR',
    deposit: { minAmount: 10, maxAmount: 5000, dailyLimit: 10000, monthlyLimit: 25000 },
    withdrawal: { minAmount: 10, maxAmount: 2500, dailyLimit: 5000, monthlyLimit: 15000 },
    transfer: { minAmount: 10, maxAmount: 2500, dailyLimit: 5000, monthlyLimit: 15000 },
    maxBalance: 50000,
  },
  
  enhanced: {
    currency: 'EUR',
    deposit: { minAmount: 10, maxAmount: 25000, dailyLimit: 50000, monthlyLimit: 150000 },
    withdrawal: { minAmount: 10, maxAmount: 15000, dailyLimit: 30000, monthlyLimit: 100000 },
    transfer: { minAmount: 10, maxAmount: 15000, dailyLimit: 30000, monthlyLimit: 100000 },
    maxBalance: 250000,
  },
  
  full: {
    currency: 'EUR',
    deposit: { minAmount: 10, maxAmount: 100000, dailyLimit: 250000, monthlyLimit: 1000000 },
    withdrawal: { minAmount: 10, maxAmount: 50000, dailyLimit: 150000, monthlyLimit: 500000 },
    transfer: { minAmount: 10, maxAmount: 50000, dailyLimit: 150000, monthlyLimit: 500000 },
  },
  
  professional: {
    currency: 'EUR',
    deposit: { minAmount: 100, maxAmount: 1000000, dailyLimit: 5000000, monthlyLimit: 50000000 },
    withdrawal: { minAmount: 100, maxAmount: 500000, dailyLimit: 2500000, monthlyLimit: 25000000 },
    transfer: { minAmount: 100, maxAmount: 500000, dailyLimit: 2500000, monthlyLimit: 25000000 },
  },
};

/**
 * Minimum tier required for actions
 */
const DEFAULT_ACTION_TIERS: Record<string, KYCTier> = {
  'deposit': 'basic',
  'withdrawal': 'standard',
  'transfer': 'standard',
  'trade': 'standard',
  'bet': 'basic',
  'purchase': 'basic',
  'claim_bonus': 'basic',
  'crypto_withdrawal': 'enhanced',
  'high_value_transaction': 'full',
  'corporate_account': 'professional',
};

// ═══════════════════════════════════════════════════════════════════════════
// STATIC CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class KYCEligibility {

  // ─────────────────────────────────────────────────────────────────────────
  // TIER UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get numeric level for a tier (for comparisons)
   */
  static getTierLevel(tier: KYCTier): number {
    return TIER_LEVELS[tier] ?? 0;
  }

  /**
   * Compare two tiers. Returns negative if a < b, 0 if equal, positive if a > b
   */
  static compareTiers(a: KYCTier, b: KYCTier): number {
    return this.getTierLevel(a) - this.getTierLevel(b);
  }

  /**
   * Check if tier meets minimum requirement
   */
  static tierMeetsRequirement(currentTier: KYCTier, requiredTier: KYCTier): boolean {
    return this.getTierLevel(currentTier) >= this.getTierLevel(requiredTier);
  }

  /**
   * Get display name for a tier
   */
  static getTierDisplayName(tier: KYCTier): string {
    return TIER_NAMES[tier] ?? tier;
  }

  /**
   * Get description for a tier
   */
  static getTierDescription(tier: KYCTier): string {
    return TIER_DESCRIPTIONS[tier] ?? '';
  }

  /**
   * Get next tier in the hierarchy
   */
  static getNextTier(currentTier: KYCTier): KYCTier | null {
    const tiers: KYCTier[] = ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'];
    const currentIndex = tiers.indexOf(currentTier);
    if (currentIndex === -1 || currentIndex >= tiers.length - 1) return null;
    return tiers[currentIndex + 1];
  }

  /**
   * Get all tiers in order
   */
  static getAllTiers(): KYCTier[] {
    return ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TIER REQUIREMENTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get requirements for a tier
   */
  static getTierRequirements(tier: KYCTier): KYCTierRequirements {
    return DEFAULT_TIER_REQUIREMENTS[tier];
  }

  /**
   * Get all requirements needed to reach a tier from current tier
   */
  static getRequirementsToReachTier(
    currentTier: KYCTier,
    targetTier: KYCTier
  ): KYCTierRequirements[] {
    const requirements: KYCTierRequirements[] = [];
    const tiers = this.getAllTiers();
    const currentIndex = tiers.indexOf(currentTier);
    const targetIndex = tiers.indexOf(targetTier);
    
    if (targetIndex <= currentIndex) return [];
    
    for (let i = currentIndex + 1; i <= targetIndex; i++) {
      requirements.push(this.getTierRequirements(tiers[i]));
    }
    
    return requirements;
  }

  /**
   * Check eligibility for a target tier
   */
  static checkTierEligibility(
    targetTier: KYCTier,
    context: KYCEligibilityContext
  ): KYCTierEligibilityResult {
    const requirements = this.getTierRequirements(targetTier);
    const missingRequirements: string[] = [];
    const completedRequirements: string[] = [];
    
    // Check prerequisite tier
    if (requirements.prerequisiteTier) {
      if (!this.tierMeetsRequirement(context.currentTier, requirements.prerequisiteTier)) {
        missingRequirements.push(`Requires ${this.getTierDisplayName(requirements.prerequisiteTier)} tier first`);
      } else {
        completedRequirements.push(`${this.getTierDisplayName(requirements.prerequisiteTier)} tier`);
      }
    }
    
    // Check documents
    for (const doc of requirements.documents) {
      if (!doc.required) continue;
      
      let hasDoc = false;
      if (doc.category === 'identity' && context.hasIdentityDoc) hasDoc = true;
      if (doc.category === 'address' && context.hasAddressDoc) hasDoc = true;
      if (doc.category === 'financial' && context.hasFinancialDoc) hasDoc = true;
      
      if (hasDoc) {
        completedRequirements.push(doc.name);
      } else {
        missingRequirements.push(doc.name);
      }
    }
    
    // Check verification checks
    for (const check of requirements.checks) {
      if (!check.required) continue;
      
      let passed = false;
      if (check.type === 'aml' && context.amlCheckPassed) passed = true;
      if (check.type === 'pep' && context.pepCheckPassed) passed = true;
      if (check.type === 'sanctions' && context.sanctionsCheckPassed) passed = true;
      if (check.type === 'liveness' && context.livenessCheckPassed) passed = true;
      
      if (passed) {
        completedRequirements.push(check.name);
      } else {
        missingRequirements.push(check.name);
      }
    }
    
    // Check age requirement
    if (requirements.minimumAge && context.userAge) {
      if (context.userAge < requirements.minimumAge) {
        missingRequirements.push(`Minimum age ${requirements.minimumAge}`);
      } else {
        completedRequirements.push('Age requirement');
      }
    }
    
    const total = missingRequirements.length + completedRequirements.length;
    const progress = total > 0 ? Math.round((completedRequirements.length / total) * 100) : 0;
    
    return {
      currentTier: context.currentTier,
      targetTier,
      eligible: missingRequirements.length === 0,
      missingRequirements,
      completedRequirements,
      progress,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSACTION LIMITS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get limits for a tier
   */
  static getTierLimits(tier: KYCTier, customLimits?: Record<KYCTier, KYCTierLimits>): KYCTierLimits {
    const limits = customLimits ?? DEFAULT_TIER_LIMITS;
    return limits[tier];
  }

  /**
   * Check if a transaction is allowed
   */
  static checkTransaction(
    limits: KYCTierLimits | Record<KYCTier, KYCTierLimits>,
    context: KYCTransactionContext
  ): KYCTransactionResult {
    // Get limits for current tier
    const tierLimits: KYCTierLimits = 'deposit' in limits 
      ? limits as KYCTierLimits
      : (limits as Record<KYCTier, KYCTierLimits>)[context.currentTier];
    
    if (!tierLimits) {
      return { allowed: false, reason: 'Unknown KYC tier' };
    }
    
    // Check KYC status
    if (context.kycStatus && !['approved', 'in_review'].includes(context.kycStatus)) {
      return { 
        allowed: false, 
        reason: `KYC status '${context.kycStatus}' does not allow transactions`,
      };
    }
    
    // Get operation limits
    const opType = context.transactionType === 'bet' || context.transactionType === 'purchase' 
      ? 'deposit' 
      : context.transactionType === 'trade'
        ? 'transfer'
        : context.transactionType;
    
    const opLimits = tierLimits[opType as keyof KYCTierLimits] as KYCOperationLimits | undefined;
    
    if (!opLimits) {
      return { 
        allowed: false, 
        reason: `Transaction type '${context.transactionType}' not allowed at this tier`,
        requiredTier: this.getNextTier(context.currentTier) ?? undefined,
      };
    }
    
    // Check minimum amount
    if (opLimits.minAmount && context.amount < opLimits.minAmount) {
      return {
        allowed: false,
        reason: `Minimum amount is ${opLimits.minAmount} ${context.currency}`,
        maxAllowed: opLimits.minAmount,
      };
    }
    
    // Check max amount per transaction
    if (context.amount > opLimits.maxAmount) {
      // Find what tier would allow this amount
      const requiredTier = this.findTierForAmount(context.amount, context.transactionType);
      
      return {
        allowed: false,
        reason: `Maximum amount per transaction is ${opLimits.maxAmount} ${context.currency}`,
        maxAllowed: opLimits.maxAmount,
        requiredTier: requiredTier ?? undefined,
        upgradeMessage: requiredTier 
          ? `Upgrade to ${this.getTierDisplayName(requiredTier)} for higher limits`
          : undefined,
      };
    }
    
    // Check daily limit
    const usedToday = context.usedToday ?? 0;
    const dailyRemaining = opLimits.dailyLimit - usedToday;
    
    if (context.amount > dailyRemaining) {
      return {
        allowed: false,
        reason: `Daily limit exceeded. Remaining today: ${Math.max(0, dailyRemaining)} ${context.currency}`,
        remaining: Math.max(0, dailyRemaining),
        dailyRemaining: Math.max(0, dailyRemaining),
        maxAllowed: Math.min(opLimits.maxAmount, dailyRemaining),
      };
    }
    
    // Check monthly limit
    const usedThisMonth = context.usedThisMonth ?? 0;
    const monthlyRemaining = opLimits.monthlyLimit - usedThisMonth;
    
    if (context.amount > monthlyRemaining) {
      return {
        allowed: false,
        reason: `Monthly limit exceeded. Remaining this month: ${Math.max(0, monthlyRemaining)} ${context.currency}`,
        remaining: Math.max(0, monthlyRemaining),
        monthlyRemaining: Math.max(0, monthlyRemaining),
        maxAllowed: Math.min(opLimits.maxAmount, monthlyRemaining),
      };
    }
    
    // Check weekly limit if defined
    if (opLimits.weeklyLimit) {
      const usedThisWeek = context.usedThisWeek ?? 0;
      const weeklyRemaining = opLimits.weeklyLimit - usedThisWeek;
      
      if (context.amount > weeklyRemaining) {
        return {
          allowed: false,
          reason: `Weekly limit exceeded. Remaining this week: ${Math.max(0, weeklyRemaining)} ${context.currency}`,
          remaining: Math.max(0, weeklyRemaining),
          maxAllowed: Math.min(opLimits.maxAmount, weeklyRemaining),
        };
      }
    }
    
    // Check transaction count limits
    if (opLimits.maxDailyTransactions) {
      const txToday = context.transactionsToday ?? 0;
      if (txToday >= opLimits.maxDailyTransactions) {
        return {
          allowed: false,
          reason: `Daily transaction limit reached (${opLimits.maxDailyTransactions} transactions)`,
        };
      }
    }
    
    // Check balance limit (for deposits)
    if (context.transactionType === 'deposit' && tierLimits.maxBalance) {
      const currentBalance = context.currentBalance ?? 0;
      const newBalance = currentBalance + context.amount;
      
      if (newBalance > tierLimits.maxBalance) {
        const maxDeposit = tierLimits.maxBalance - currentBalance;
        return {
          allowed: false,
          reason: `Would exceed maximum balance of ${tierLimits.maxBalance} ${context.currency}`,
          maxAllowed: Math.max(0, maxDeposit),
        };
      }
    }
    
    // All checks passed
    return {
      allowed: true,
      remaining: Math.min(dailyRemaining, monthlyRemaining) - context.amount,
      dailyRemaining: dailyRemaining - context.amount,
      monthlyRemaining: monthlyRemaining - context.amount,
      maxAllowed: Math.min(opLimits.maxAmount, dailyRemaining, monthlyRemaining),
    };
  }

  /**
   * Get remaining limits for a user
   */
  static getRemainingLimits(
    tier: KYCTier,
    transactionType: KYCTransactionType,
    usage: { daily?: number; weekly?: number; monthly?: number },
    customLimits?: Record<KYCTier, KYCTierLimits>
  ): { daily: number; weekly?: number; monthly: number; perTransaction: number } {
    const tierLimits = this.getTierLimits(tier, customLimits);
    const opType = transactionType === 'bet' || transactionType === 'purchase' 
      ? 'deposit' 
      : transactionType === 'trade' ? 'transfer' : transactionType;
    
    const opLimits = tierLimits[opType as keyof KYCTierLimits] as KYCOperationLimits | undefined;
    
    if (!opLimits) {
      return { daily: 0, monthly: 0, perTransaction: 0 };
    }
    
    return {
      daily: Math.max(0, opLimits.dailyLimit - (usage.daily ?? 0)),
      weekly: opLimits.weeklyLimit 
        ? Math.max(0, opLimits.weeklyLimit - (usage.weekly ?? 0))
        : undefined,
      monthly: Math.max(0, opLimits.monthlyLimit - (usage.monthly ?? 0)),
      perTransaction: opLimits.maxAmount,
    };
  }

  /**
   * Find the minimum tier that allows a specific amount
   */
  static findTierForAmount(
    amount: number,
    transactionType: KYCTransactionType,
    customLimits?: Record<KYCTier, KYCTierLimits>
  ): KYCTier | null {
    const limits = customLimits ?? DEFAULT_TIER_LIMITS;
    const tiers = this.getAllTiers();
    
    const opType = transactionType === 'bet' || transactionType === 'purchase' 
      ? 'deposit' 
      : transactionType === 'trade' ? 'transfer' : transactionType;
    
    for (const tier of tiers) {
      const tierLimits = limits[tier];
      const opLimits = tierLimits[opType as keyof KYCTierLimits] as KYCOperationLimits | undefined;
      
      if (opLimits && opLimits.maxAmount >= amount) {
        return tier;
      }
    }
    
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION ELIGIBILITY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if user can perform an action based on their tier
   */
  static canPerformAction(
    action: string,
    currentTier: KYCTier,
    customActionTiers?: Record<string, KYCTier>
  ): KYCActionResult {
    const actionTiers = customActionTiers ?? DEFAULT_ACTION_TIERS;
    const requiredTier = actionTiers[action];
    
    if (!requiredTier) {
      // Action not defined, allow by default
      return { allowed: true };
    }
    
    const allowed = this.tierMeetsRequirement(currentTier, requiredTier);
    
    return {
      allowed,
      reason: allowed ? undefined : `Requires ${this.getTierDisplayName(requiredTier)} tier`,
      requiredTier: allowed ? undefined : requiredTier,
    };
  }

  /**
   * Get all actions a tier can perform
   */
  static getAvailableActions(
    tier: KYCTier,
    customActionTiers?: Record<string, KYCTier>
  ): string[] {
    const actionTiers = customActionTiers ?? DEFAULT_ACTION_TIERS;
    const available: string[] = [];
    
    for (const [action, requiredTier] of Object.entries(actionTiers)) {
      if (this.tierMeetsRequirement(tier, requiredTier)) {
        available.push(action);
      }
    }
    
    return available;
  }

  /**
   * Get actions that require upgrade
   */
  static getLockedActions(
    tier: KYCTier,
    customActionTiers?: Record<string, KYCTier>
  ): Array<{ action: string; requiredTier: KYCTier }> {
    const actionTiers = customActionTiers ?? DEFAULT_ACTION_TIERS;
    const locked: Array<{ action: string; requiredTier: KYCTier }> = [];
    
    for (const [action, requiredTier] of Object.entries(actionTiers)) {
      if (!this.tierMeetsRequirement(tier, requiredTier)) {
        locked.push({ action, requiredTier });
      }
    }
    
    return locked;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JURISDICTION RULES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if a country is blocked
   */
  static isCountryBlocked(
    country: string,
    rules: KYCJurisdictionRules
  ): boolean {
    return rules.blockedCountries.includes(country);
  }

  /**
   * Check if a country is high risk
   */
  static isCountryHighRisk(
    country: string,
    rules: KYCJurisdictionRules
  ): boolean {
    return rules.highRiskCountries.includes(country);
  }

  /**
   * Check age eligibility for a jurisdiction
   */
  static checkAgeEligibility(
    userAge: number,
    rules: KYCJurisdictionRules
  ): { eligible: boolean; reason?: string } {
    if (userAge < rules.minimumAge) {
      return {
        eligible: false,
        reason: `Minimum age is ${rules.minimumAge} years`,
      };
    }
    return { eligible: true };
  }

  /**
   * Check nationality eligibility
   */
  static checkNationalityEligibility(
    nationality: string,
    rules: KYCJurisdictionRules
  ): { eligible: boolean; reason?: string } {
    if (rules.restrictedNationalities?.includes(nationality)) {
      return {
        eligible: false,
        reason: `Nationality '${nationality}' is restricted`,
      };
    }
    return { eligible: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENT VALIDATION (Client-side)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if a document is expired
   */
  static isDocumentExpired(expiryDate: Date, currentDate?: Date): boolean {
    const now = currentDate ?? new Date();
    return new Date(expiryDate) < now;
  }

  /**
   * Check if a document is too old (e.g., utility bill older than 3 months)
   */
  static isDocumentTooOld(issuedDate: Date, maxAgeDays: number, currentDate?: Date): boolean {
    const now = currentDate ?? new Date();
    const ageMs = now.getTime() - new Date(issuedDate).getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    return ageDays > maxAgeDays;
  }

  /**
   * Validate document file (client-side pre-validation)
   */
  static validateDocumentFile(
    file: { name: string; size: number; type: string },
    options: {
      maxSizeMB?: number;
      allowedTypes?: string[];
      allowedExtensions?: string[];
    } = {}
  ): { valid: boolean; reason?: string } {
    const { 
      maxSizeMB = 10, 
      allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'],
    } = options;
    
    // Check file size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      return { valid: false, reason: `File too large. Maximum size is ${maxSizeMB}MB` };
    }
    
    // Check mime type
    if (!allowedTypes.includes(file.type)) {
      return { valid: false, reason: `File type '${file.type}' not allowed` };
    }
    
    // Check extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return { valid: false, reason: `File extension '${ext}' not allowed` };
    }
    
    return { valid: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RISK LEVEL UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate risk level from score
   */
  static getRiskLevelFromScore(
    score: number,
    thresholds: { low: number; medium: number; high: number } = { low: 30, medium: 50, high: 70 }
  ): KYCRiskLevel {
    if (score >= thresholds.high) return 'critical';
    if (score >= thresholds.medium) return 'high';
    if (score >= thresholds.low) return 'medium';
    return 'low';
  }

  /**
   * Check if enhanced due diligence is required
   */
  static requiresEnhancedDueDiligence(context: KYCEligibilityContext): boolean {
    // PEP always requires EDD
    if (context.isPEP) return true;
    
    // High/critical risk requires EDD
    if (context.riskLevel === 'high' || context.riskLevel === 'critical') return true;
    
    // High risk score requires EDD
    if (context.riskScore && context.riskScore >= 70) return true;
    
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const checkKYCTransaction = KYCEligibility.checkTransaction.bind(KYCEligibility);
export const getTierRequirements = KYCEligibility.getTierRequirements.bind(KYCEligibility);
export const checkTierEligibility = KYCEligibility.checkTierEligibility.bind(KYCEligibility);
export const canPerformAction = KYCEligibility.canPerformAction.bind(KYCEligibility);
export const tierMeetsRequirement = KYCEligibility.tierMeetsRequirement.bind(KYCEligibility);
export const getRemainingLimits = KYCEligibility.getRemainingLimits.bind(KYCEligibility);
