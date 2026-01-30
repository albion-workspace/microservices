/**
 * KYC Eligibility Checker
 * 
 * Client-safe eligibility checking for KYC requirements.
 * No server dependencies - can be used in frontend apps.
 */

import type {
  KYCTier,
  KYCStatus,
  KYCUserContext,
  TierLimits,
  EligibilityCheck,
  EligibilityResult,
  OperationLimits,
} from './types.js';

import {
  TIER_ORDER,
  TIER_DISPLAY_NAMES,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Default Limits Configuration
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_LIMITS: Record<KYCTier, TierLimits> = {
  none: {
    currency: 'EUR',
    deposit: { maxAmount: 0, dailyLimit: 0, monthlyLimit: 0 },
    withdrawal: { maxAmount: 0, dailyLimit: 0, monthlyLimit: 0 },
  },
  basic: {
    currency: 'EUR',
    deposit: { maxAmount: 1000, dailyLimit: 2000, monthlyLimit: 5000 },
    withdrawal: { maxAmount: 500, dailyLimit: 1000, monthlyLimit: 2500 },
    transfer: { maxAmount: 500, dailyLimit: 1000, monthlyLimit: 2500 },
    maxBalance: 5000,
  },
  standard: {
    currency: 'EUR',
    deposit: { maxAmount: 5000, dailyLimit: 10000, monthlyLimit: 25000 },
    withdrawal: { maxAmount: 2500, dailyLimit: 5000, monthlyLimit: 15000 },
    transfer: { maxAmount: 2500, dailyLimit: 5000, monthlyLimit: 15000 },
    maxBalance: 50000,
  },
  enhanced: {
    currency: 'EUR',
    deposit: { maxAmount: 25000, dailyLimit: 50000, monthlyLimit: 150000 },
    withdrawal: { maxAmount: 15000, dailyLimit: 30000, monthlyLimit: 100000 },
    transfer: { maxAmount: 15000, dailyLimit: 30000, monthlyLimit: 100000 },
    maxBalance: 250000,
  },
  full: {
    currency: 'EUR',
    deposit: { maxAmount: 100000, dailyLimit: 250000, monthlyLimit: 1000000 },
    withdrawal: { maxAmount: 50000, dailyLimit: 150000, monthlyLimit: 500000 },
    transfer: { maxAmount: 50000, dailyLimit: 150000, monthlyLimit: 500000 },
  },
  professional: {
    currency: 'EUR',
    deposit: { maxAmount: 1000000, dailyLimit: 5000000, monthlyLimit: 50000000 },
    withdrawal: { maxAmount: 500000, dailyLimit: 2500000, monthlyLimit: 25000000 },
    transfer: { maxAmount: 500000, dailyLimit: 2500000, monthlyLimit: 25000000 },
  },
};

// ═══════════════════════════════════════════════════════════════════
// KYC Eligibility Class
// ═══════════════════════════════════════════════════════════════════

export class KYCEligibility {
  private context: KYCUserContext;
  private limits: Record<KYCTier, TierLimits>;
  
  constructor(
    context: KYCUserContext,
    customLimits?: Partial<Record<KYCTier, TierLimits>>
  ) {
    this.context = context;
    this.limits = customLimits 
      ? { ...DEFAULT_LIMITS, ...customLimits }
      : DEFAULT_LIMITS;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Main Check Method
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check eligibility for a requirement
   */
  check(input: EligibilityCheck): EligibilityResult {
    switch (input.type) {
      case 'tier':
        return this.checkTierEligibility(input.requiredTier ?? 'basic');
      
      case 'transaction':
        return this.checkTransactionEligibility(
          input.transactionType ?? 'deposit',
          input.amount ?? 0,
          input.currency ?? 'EUR'
        );
      
      case 'feature':
        return this.checkFeatureEligibility(input.feature ?? '');
      
      default:
        return this.createResult(false, 'Unknown check type');
    }
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Tier Eligibility
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check if user meets tier requirement
   */
  checkTierEligibility(requiredTier: KYCTier): EligibilityResult {
    const reasons: string[] = [];
    const warnings: string[] = [];
    
    // Check status first
    if (this.context.status !== 'approved' && this.context.currentTier !== 'none') {
      return this.createResult(false, this.getStatusReason(), {
        requiredTier,
      });
    }
    
    // Compare tiers
    const currentIndex = TIER_ORDER.indexOf(this.context.currentTier);
    const requiredIndex = TIER_ORDER.indexOf(requiredTier);
    
    const meetsRequirement = currentIndex >= requiredIndex;
    
    if (!meetsRequirement) {
      reasons.push(`Current tier (${TIER_DISPLAY_NAMES[this.context.currentTier]}) is below required tier (${TIER_DISPLAY_NAMES[requiredTier]})`);
    }
    
    // Check expiration
    if (this.context.expiresAt) {
      const daysUntilExpiry = this.getDaysUntilExpiry();
      if (daysUntilExpiry <= 0) {
        reasons.push('KYC verification has expired');
      } else if (daysUntilExpiry <= 30) {
        warnings.push(`KYC verification expires in ${daysUntilExpiry} days`);
      }
    }
    
    return this.createResult(
      meetsRequirement && reasons.length === 0,
      reasons.join('; ') || undefined,
      {
        requiredTier: meetsRequirement ? undefined : requiredTier,
        upgradeRequired: !meetsRequirement,
        upgradeUrl: !meetsRequirement ? `/kyc/upgrade?tier=${requiredTier}` : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        isExpiringSoon: this.isExpiringSoon(),
        reasons: reasons.length > 0 ? reasons : undefined,
      }
    );
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Transaction Eligibility
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check if transaction is allowed
   */
  checkTransactionEligibility(
    type: 'deposit' | 'withdrawal' | 'transfer',
    amount: number,
    currency: string
  ): EligibilityResult {
    const reasons: string[] = [];
    
    // Check status
    if (this.context.status !== 'approved' && this.context.currentTier !== 'none') {
      return this.createResult(false, this.getStatusReason());
    }
    
    // Check expiration
    if (this.isExpired()) {
      return this.createResult(false, 'KYC verification has expired');
    }
    
    // Get limits for current tier
    const tierLimits = this.limits[this.context.currentTier];
    const operationLimits = tierLimits[type];
    
    if (!operationLimits) {
      return this.createResult(
        false,
        `${type} is not allowed for current tier`,
        { requiredTier: this.findTierForAmount(type, amount) }
      );
    }
    
    // Check minimum
    if (operationLimits.minAmount && amount < operationLimits.minAmount) {
      reasons.push(`Amount below minimum (${operationLimits.minAmount} ${currency})`);
    }
    
    // Check single amount
    if (amount > operationLimits.maxAmount) {
      const requiredTier = this.findTierForAmount(type, amount);
      reasons.push(`Amount exceeds single transaction limit (${operationLimits.maxAmount} ${currency})`);
      
      return this.createResult(false, reasons.join('; '), {
        limits: operationLimits,
        requiredTier,
        upgradeRequired: true,
        upgradeUrl: `/kyc/upgrade?tier=${requiredTier}`,
        reasons,
      });
    }
    
    // Note: Daily/monthly limits would need server-side tracking
    // Client-side can only check single transaction limits
    
    return this.createResult(true, undefined, {
      limits: operationLimits,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Feature Eligibility
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Check if feature is available
   */
  checkFeatureEligibility(feature: string): EligibilityResult {
    // Define feature requirements
    const featureRequirements: Record<string, KYCTier> = {
      'deposit': 'basic',
      'withdrawal': 'standard',
      'transfer': 'standard',
      'trading': 'enhanced',
      'high_value_trading': 'full',
      'margin_trading': 'full',
      'corporate_account': 'professional',
      'api_access': 'enhanced',
      'bonus_claim': 'basic',
    };
    
    const requiredTier = featureRequirements[feature];
    
    if (!requiredTier) {
      // Unknown feature - allow by default
      return this.createResult(true);
    }
    
    return this.checkTierEligibility(requiredTier);
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Helper Methods
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Get current tier
   */
  getCurrentTier(): KYCTier {
    return this.context.currentTier;
  }
  
  /**
   * Get current status
   */
  getCurrentStatus(): KYCStatus {
    return this.context.status;
  }
  
  /**
   * Get limits for current tier
   */
  getCurrentLimits(): TierLimits {
    return this.limits[this.context.currentTier];
  }
  
  /**
   * Get limits for a specific tier
   */
  getTierLimits(tier: KYCTier): TierLimits {
    return this.limits[tier];
  }
  
  /**
   * Check if verification is expiring soon
   */
  isExpiringSoon(): boolean {
    if (!this.context.expiresAt) return false;
    return this.getDaysUntilExpiry() <= 30 && this.getDaysUntilExpiry() > 0;
  }
  
  /**
   * Check if verification is expired
   */
  isExpired(): boolean {
    if (!this.context.expiresAt) return false;
    return this.context.expiresAt < new Date();
  }
  
  /**
   * Get days until expiry
   */
  getDaysUntilExpiry(): number {
    if (!this.context.expiresAt) return Infinity;
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((this.context.expiresAt.getTime() - Date.now()) / msPerDay);
  }
  
  /**
   * Check if user can upgrade to tier
   */
  canUpgradeTo(tier: KYCTier): boolean {
    const currentIndex = TIER_ORDER.indexOf(this.context.currentTier);
    const targetIndex = TIER_ORDER.indexOf(tier);
    return targetIndex > currentIndex;
  }
  
  /**
   * Get next tier
   */
  getNextTier(): KYCTier | null {
    const currentIndex = TIER_ORDER.indexOf(this.context.currentTier);
    if (currentIndex >= TIER_ORDER.length - 1) return null;
    return TIER_ORDER[currentIndex + 1];
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Private Helpers
  // ───────────────────────────────────────────────────────────────────
  
  private createResult(
    eligible: boolean,
    reason?: string,
    extra?: Partial<EligibilityResult>
  ): EligibilityResult {
    return {
      eligible,
      currentTier: this.context.currentTier,
      currentStatus: this.context.status,
      reason,
      expiresAt: this.context.expiresAt,
      ...extra,
    };
  }
  
  private getStatusReason(): string {
    switch (this.context.status) {
      case 'pending':
        return 'KYC verification is pending';
      case 'in_review':
        return 'KYC verification is under review';
      case 'rejected':
        return 'KYC verification was rejected';
      case 'expired':
        return 'KYC verification has expired';
      case 'suspended':
        return 'Account is suspended';
      case 'manual_review':
        return 'KYC verification is pending manual review';
      default:
        return 'KYC verification status is invalid';
    }
  }
  
  private findTierForAmount(type: 'deposit' | 'withdrawal' | 'transfer', amount: number): KYCTier {
    for (const tier of TIER_ORDER) {
      const limits = this.limits[tier][type];
      if (limits && amount <= limits.maxAmount) {
        return tier;
      }
    }
    return 'professional';
  }
}
