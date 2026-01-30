/**
 * KYC Shared Types
 * 
 * Client-safe type definitions
 */

// ═══════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════

/**
 * KYC verification tiers
 */
export type KYCTier = 
  | 'none'
  | 'basic'
  | 'standard'
  | 'enhanced'
  | 'full'
  | 'professional';

/**
 * KYC verification status
 */
export type KYCStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'suspended'
  | 'manual_review';

/**
 * User context for eligibility checks
 */
export interface KYCUserContext {
  currentTier: KYCTier;
  status: KYCStatus;
  jurisdictionCode?: string;
  expiresAt?: Date;
  isPEP?: boolean;
  isHighRisk?: boolean;
}

/**
 * Transaction limits for a tier
 */
export interface TierLimits {
  currency: string;
  deposit: OperationLimits;
  withdrawal: OperationLimits;
  transfer?: OperationLimits;
  maxBalance?: number;
}

/**
 * Limits for a specific operation
 */
export interface OperationLimits {
  minAmount?: number;
  maxAmount: number;
  dailyLimit: number;
  weeklyLimit?: number;
  monthlyLimit: number;
}

// ═══════════════════════════════════════════════════════════════════
// Eligibility Check Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Eligibility check input
 */
export interface EligibilityCheck {
  // What we're checking
  type: 'tier' | 'transaction' | 'feature';
  
  // For tier checks
  requiredTier?: KYCTier;
  
  // For transaction checks
  transactionType?: 'deposit' | 'withdrawal' | 'transfer';
  amount?: number;
  currency?: string;
  
  // For feature checks
  feature?: string;
}

/**
 * Eligibility check result
 */
export interface EligibilityResult {
  eligible: boolean;
  
  // Tier info
  currentTier: KYCTier;
  requiredTier?: KYCTier;
  
  // Status
  currentStatus: KYCStatus;
  
  // Reason if not eligible
  reason?: string;
  reasons?: string[];
  
  // Limits (for transaction checks)
  limits?: OperationLimits;
  
  // Upgrade info
  upgradeRequired?: boolean;
  upgradeUrl?: string;
  
  // Warnings
  warnings?: string[];
  isExpiringSoon?: boolean;
  expiresAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Display Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Tier display names
 */
export const TIER_DISPLAY_NAMES: Record<KYCTier, string> = {
  none: 'Unverified',
  basic: 'Basic',
  standard: 'Standard',
  enhanced: 'Enhanced',
  full: 'Full',
  professional: 'Professional',
};

/**
 * Tier descriptions
 */
export const TIER_DESCRIPTIONS: Record<KYCTier, string> = {
  none: 'No verification completed',
  basic: 'Email and phone verified',
  standard: 'Government-issued ID verified',
  enhanced: 'ID and address verified',
  full: 'Full KYC with source of funds',
  professional: 'Corporate/institutional verification',
};

/**
 * Status display names
 */
export const STATUS_DISPLAY_NAMES: Record<KYCStatus, string> = {
  pending: 'Pending',
  in_review: 'Under Review',
  approved: 'Verified',
  rejected: 'Rejected',
  expired: 'Expired',
  suspended: 'Suspended',
  manual_review: 'Pending Review',
};

/**
 * Tier order for comparison
 */
export const TIER_ORDER: KYCTier[] = [
  'none',
  'basic',
  'standard',
  'enhanced',
  'full',
  'professional',
];
