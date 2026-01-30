/**
 * BonusEligibility - Client-Safe Eligibility Checker
 * 
 * A static class for checking bonus eligibility on client-side.
 * No database dependencies - pure functions only.
 * 
 * Usage:
 * ```typescript
 * import { BonusEligibility } from 'shared-validators';
 * 
 * // Check single template
 * const result = BonusEligibility.check(template, context);
 * if (result.eligible) {
 *   notify(`You're eligible for ${template.name}!`);
 * }
 * 
 * // Check multiple templates
 * const eligible = BonusEligibility.checkMany(templates, context);
 * eligible.filter(r => r.eligible).forEach(r => {
 *   notify(`Eligible: ${r.template.name}`);
 * });
 * 
 * // Find best bonus for deposit
 * const best = BonusEligibility.findBestForDeposit(templates, 100, 'USD');
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (Self-contained)
// ═══════════════════════════════════════════════════════════════════════════

export type BonusCurrency = 'USD' | 'EUR' | 'GBP' | 'BTC' | 'ETH' | 'USDT' | string;

export type BonusType = 
  // Onboarding
  | 'welcome' | 'first_deposit' | 'first_purchase' | 'first_action'
  // Recurring
  | 'reload' | 'top_up'
  // Referrals
  | 'referral' | 'referee' | 'commission'
  // Activity
  | 'activity' | 'milestone' | 'streak' | 'winback'
  // Recovery
  | 'cashback' | 'consolation'
  // Credits
  | 'free_credit' | 'trial'
  // Loyalty
  | 'loyalty' | 'loyalty_points' | 'vip' | 'tier_upgrade'
  // Time-based
  | 'birthday' | 'anniversary' | 'seasonal' | 'daily_login' | 'flash'
  // Achievement
  | 'achievement' | 'task_completion' | 'challenge'
  // Competition
  | 'tournament' | 'leaderboard'
  // Selection
  | 'selection' | 'combo' | 'bundle'
  // Promotional
  | 'promo_code' | 'special_event' | 'custom';

export type BonusDomain = 
  | 'universal' | 'casino' | 'sports' | 'poker' | 'crypto'
  | 'ecommerce' | 'saas' | 'gaming' | 'fintech' | 'social';

export type BonusValueType = 'fixed' | 'percentage' | 'tiered' | 'dynamic';

export type BonusStatus = 
  | 'pending' | 'active' | 'in_progress' | 'requirements_met'
  | 'converted' | 'claimed' | 'expired' | 'cancelled' | 'forfeited' | 'locked';

/**
 * Minimal BonusTemplate interface for eligibility checking.
 * Your full template may have more fields.
 */
export interface BonusTemplate {
  id: string;
  name: string;
  code: string;
  type: BonusType;
  domain: BonusDomain;
  description?: string;
  
  // Value
  valueType: BonusValueType;
  value: number;
  currency: BonusCurrency;
  supportedCurrencies?: BonusCurrency[];
  maxValue?: number;
  minDeposit?: number;
  
  // Turnover
  turnoverMultiplier: number;
  activityContributions?: Record<string, number>;
  
  // Validity
  validFrom: Date | string;
  validUntil: Date | string;
  claimDeadlineDays?: number;
  usageDeadlineDays?: number;
  
  // Limits (server checks these against DB)
  maxUsesTotal?: number;
  maxUsesPerUser?: number;
  currentUsesTotal?: number;
  
  // Eligibility
  eligibleTiers?: string[];
  eligibleCountries?: string[];
  excludedCountries?: string[];
  minAccountAgeDays?: number;
  requiresDeposit?: boolean;
  requiresVerification?: boolean;
  requiredKYCTier?: string;
  
  // Stacking
  stackable?: boolean;
  excludedBonusTypes?: BonusType[];
  
  // Selection-specific
  minSelections?: number;
  maxSelections?: number;
  min?: number;
  max?: number;
  minTotal?: number;
  maxTotal?: number;
  
  // Combo-specific
  minActions?: number;
  comboMultiplier?: number;
  
  // Activity-specific
  eligibleCategories?: string[];
  
  // Status
  isActive: boolean;
  priority?: number;
  tags?: string[];
}

/**
 * Context for eligibility checking.
 * Populate with user's current state.
 */
export interface BonusEligibilityContext {
  userId?: string;
  tenantId?: string;
  currency?: BonusCurrency;
  userTier?: string;
  country?: string;
  
  // KYC context
  kycTier?: string;
  kycStatus?: string;
  
  // Deposit context
  depositAmount?: number;
  isFirstDeposit?: boolean;
  isFirstPurchase?: boolean;
  
  // Selection context (for combo/selection bonuses)
  selectionCount?: number;
  selections?: Array<{ 
    id: string; 
    value?: number;
    category?: string; 
  }>;
  selectionsTotal?: number;
  
  // Activity context
  activityCategory?: string;
  activityAmount?: number;
  consecutiveDays?: number;
  
  // Verification
  isVerified?: boolean;
  accountAgeDays?: number;
  
  // Time context (defaults to now)
  currentDate?: Date;
  
  // Custom metadata
  metadata?: Record<string, unknown>;
}

export interface BonusEligibilityResult {
  template: BonusTemplate;
  eligible: boolean;
  reasons: string[];
  calculatedValue?: number;
  turnoverRequired?: number;
}

export interface BonusValidationRule {
  name: string;
  check: (template: BonusTemplate, context: BonusEligibilityContext) => boolean;
  message: (template: BonusTemplate, context: BonusEligibilityContext) => string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class BonusEligibility {
  
  private static readonly rules: BonusValidationRule[] = [
    // Active check
    {
      name: 'is_active',
      check: (t) => t.isActive === true,
      message: () => 'Bonus is not active',
    },
    
    // Date range
    {
      name: 'date_range',
      check: (t, c) => {
        const now = c.currentDate || new Date();
        const from = new Date(t.validFrom);
        const until = new Date(t.validUntil);
        return now >= from && now <= until;
      },
      message: (t, c) => {
        const now = c.currentDate || new Date();
        const from = new Date(t.validFrom);
        if (now < from) return `Bonus starts on ${from.toLocaleDateString()}`;
        return 'Bonus has expired';
      },
    },
    
    // Currency
    {
      name: 'currency',
      check: (t, c) => {
        if (!c.currency) return true;
        if (!t.supportedCurrencies?.length) return true;
        return t.supportedCurrencies.includes(c.currency);
      },
      message: (t, c) => `Currency ${c.currency} not supported. Supported: ${t.supportedCurrencies?.join(', ')}`,
    },
    
    // Min deposit
    {
      name: 'min_deposit',
      check: (t, c) => {
        if (!t.minDeposit) return true;
        if (!c.depositAmount) return true;
        return c.depositAmount >= t.minDeposit;
      },
      message: (t) => `Minimum deposit of ${t.minDeposit} ${t.currency} required`,
    },
    
    // User tier
    {
      name: 'tier',
      check: (t, c) => {
        if (!t.eligibleTiers?.length) return true;
        if (!c.userTier) return false;
        return t.eligibleTiers.includes(c.userTier);
      },
      message: (t) => `Required tier: ${t.eligibleTiers?.join(' or ')}`,
    },
    
    // KYC Tier
    {
      name: 'kyc_tier',
      check: (t, c) => {
        if (!t.requiredKYCTier) return true;
        if (!c.kycTier) return false;
        // Import KYCEligibility for tier comparison would create circular dep
        // Use simple tier level comparison
        const tierLevels: Record<string, number> = {
          'none': 0, 'basic': 1, 'standard': 2, 
          'enhanced': 3, 'full': 4, 'professional': 5
        };
        const required = tierLevels[t.requiredKYCTier] ?? 0;
        const current = tierLevels[c.kycTier] ?? 0;
        return current >= required;
      },
      message: (t) => `KYC tier '${t.requiredKYCTier}' or higher required`,
    },
    
    // Country
    {
      name: 'country',
      check: (t, c) => {
        if (!c.country) return true;
        if (t.excludedCountries?.includes(c.country)) return false;
        if (t.eligibleCountries?.length && !t.eligibleCountries.includes(c.country)) return false;
        return true;
      },
      message: (t, c) => `Country ${c.country} not eligible`,
    },
    
    // Verification
    {
      name: 'verification',
      check: (t, c) => {
        if (!t.requiresVerification) return true;
        return c.isVerified === true;
      },
      message: () => 'Account verification required',
    },
    
    // Account age
    {
      name: 'account_age',
      check: (t, c) => {
        if (!t.minAccountAgeDays) return true;
        if (c.accountAgeDays === undefined) return true;
        return c.accountAgeDays >= t.minAccountAgeDays;
      },
      message: (t) => `Account must be at least ${t.minAccountAgeDays} days old`,
    },
    
    // First deposit (type-specific)
    {
      name: 'first_deposit',
      check: (t, c) => {
        if (t.type !== 'first_deposit' && t.type !== 'welcome') return true;
        return c.isFirstDeposit === true;
      },
      message: () => 'Only available for first deposit',
    },
    
    // First purchase (type-specific)
    {
      name: 'first_purchase',
      check: (t, c) => {
        if (t.type !== 'first_purchase') return true;
        return c.isFirstPurchase === true;
      },
      message: () => 'Only available for first purchase',
    },
    
    // Selection count
    {
      name: 'selection_count',
      check: (t, c) => {
        if (!['selection', 'combo', 'bundle'].includes(t.type)) return true;
        const count = c.selectionCount ?? c.selections?.length ?? 0;
        if (t.minSelections && count < t.minSelections) return false;
        if (t.maxSelections && count > t.maxSelections) return false;
        return true;
      },
      message: (t, c) => {
        const count = c.selectionCount ?? c.selections?.length ?? 0;
        if (t.minSelections && count < t.minSelections) {
          return `Minimum ${t.minSelections} selections required (you have ${count})`;
        }
        return `Maximum ${t.maxSelections} selections allowed (you have ${count})`;
      },
    },
    
    // Selection value range
    {
      name: 'selection_value_range',
      check: (t, c) => {
        if (!['selection', 'combo', 'bundle'].includes(t.type)) return true;
        if (!c.selections?.length) return true;
        
        for (const sel of c.selections) {
          if (sel.value === undefined) continue;
          if (t.min !== undefined && sel.value < t.min) return false;
          if (t.max !== undefined && sel.value > t.max) return false;
        }
        return true;
      },
      message: (t, c) => {
        if (!c.selections) return 'Invalid selections';
        for (const sel of c.selections) {
          if (sel.value === undefined) continue;
          if (t.min !== undefined && sel.value < t.min) {
            return `Selection value ${sel.value} is below minimum ${t.min}`;
          }
          if (t.max !== undefined && sel.value > t.max) {
            return `Selection value ${sel.value} exceeds maximum ${t.max}`;
          }
        }
        return 'Selection value out of range';
      },
    },
    
    // Selection total range
    {
      name: 'selection_total_range',
      check: (t, c) => {
        if (!['selection', 'combo', 'bundle'].includes(t.type)) return true;
        
        let total = c.selectionsTotal;
        if (total === undefined && c.selections?.length) {
          const isMultiplicative = t.type === 'combo';
          if (isMultiplicative) {
            total = c.selections.reduce((acc, s) => acc * (s.value ?? 1), 1);
          } else {
            total = c.selections.reduce((acc, s) => acc + (s.value ?? 0), 0);
          }
        }
        
        if (total === undefined) return true;
        if (t.minTotal !== undefined && total < t.minTotal) return false;
        if (t.maxTotal !== undefined && total > t.maxTotal) return false;
        return true;
      },
      message: (t, c) => {
        let total = c.selectionsTotal;
        if (total === undefined && c.selections?.length) {
          const isMultiplicative = t.type === 'combo';
          if (isMultiplicative) {
            total = c.selections.reduce((acc, s) => acc * (s.value ?? 1), 1);
          } else {
            total = c.selections.reduce((acc, s) => acc + (s.value ?? 0), 0);
          }
        }
        
        if (t.minTotal !== undefined && total !== undefined && total < t.minTotal) {
          return `Combined total ${total.toFixed(2)} is below minimum ${t.minTotal}`;
        }
        if (t.maxTotal !== undefined && total !== undefined && total > t.maxTotal) {
          return `Combined total ${total.toFixed(2)} exceeds maximum ${t.maxTotal}`;
        }
        return 'Combined total out of range';
      },
    },
    
    // Activity category
    {
      name: 'activity_category',
      check: (t, c) => {
        if (!t.eligibleCategories?.length) return true;
        if (!c.activityCategory) return true;
        return t.eligibleCategories.includes(c.activityCategory);
      },
      message: (t) => `Activity category not eligible. Allowed: ${t.eligibleCategories?.join(', ')}`,
    },
    
    // Total uses limit
    {
      name: 'total_uses',
      check: (t) => {
        if (!t.maxUsesTotal || t.currentUsesTotal === undefined) return true;
        return t.currentUsesTotal < t.maxUsesTotal;
      },
      message: () => 'Bonus no longer available (limit reached)',
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check eligibility for a single bonus template.
   */
  static check(template: BonusTemplate, context: BonusEligibilityContext = {}): BonusEligibilityResult {
    const reasons: string[] = [];
    
    for (const rule of this.rules) {
      if (!rule.check(template, context)) {
        reasons.push(rule.message(template, context));
      }
    }
    
    const eligible = reasons.length === 0;
    
    return {
      template,
      eligible,
      reasons,
      calculatedValue: eligible ? this.calculateValue(template, context) : undefined,
      turnoverRequired: eligible ? this.calculateTurnover(template, context) : undefined,
    };
  }

  /**
   * Check eligibility for multiple templates.
   * Returns all results, sorted by priority (highest first).
   */
  static checkMany(
    templates: BonusTemplate[], 
    context: BonusEligibilityContext = {}
  ): BonusEligibilityResult[] {
    return templates
      .map(t => this.check(t, context))
      .sort((a, b) => (b.template.priority ?? 0) - (a.template.priority ?? 0));
  }

  /**
   * Get only eligible bonuses from a list.
   */
  static getEligible(
    templates: BonusTemplate[], 
    context: BonusEligibilityContext = {}
  ): BonusEligibilityResult[] {
    return this.checkMany(templates, context).filter(r => r.eligible);
  }

  /**
   * Find the best bonus for a deposit amount.
   */
  static findBestForDeposit(
    templates: BonusTemplate[],
    amount: number,
    currency: BonusCurrency,
    context: Partial<BonusEligibilityContext> = {}
  ): BonusEligibilityResult | null {
    const ctx: BonusEligibilityContext = {
      ...context,
      depositAmount: amount,
      currency,
    };
    
    const depositTypes: BonusType[] = ['first_deposit', 'reload', 'welcome', 'top_up'];
    const depositTemplates = templates.filter(t => depositTypes.includes(t.type));
    
    const eligible = this.getEligible(depositTemplates, ctx);
    
    if (eligible.length === 0) return null;
    
    return eligible.sort((a, b) => 
      (b.calculatedValue ?? 0) - (a.calculatedValue ?? 0)
    )[0];
  }

  /**
   * Find eligible selection/combo bonuses based on selection count.
   */
  static findForSelections(
    templates: BonusTemplate[],
    selectionCount: number,
    context: Partial<BonusEligibilityContext> = {}
  ): BonusEligibilityResult[] {
    const ctx: BonusEligibilityContext = {
      ...context,
      selectionCount,
    };
    
    const selectionTypes: BonusType[] = ['selection', 'combo', 'bundle'];
    const selectionTemplates = templates.filter(t => selectionTypes.includes(t.type));
    
    return this.getEligible(selectionTemplates, ctx);
  }

  /**
   * Check if user qualifies for any bonus of a specific type.
   */
  static hasEligibleOfType(
    templates: BonusTemplate[],
    type: BonusType,
    context: BonusEligibilityContext = {}
  ): BonusEligibilityResult | null {
    const typeTemplates = templates.filter(t => t.type === type);
    const eligible = this.getEligible(typeTemplates, context);
    return eligible[0] ?? null;
  }

  /**
   * Group eligible bonuses by type.
   */
  static groupByType(
    templates: BonusTemplate[],
    context: BonusEligibilityContext = {}
  ): Map<BonusType, BonusEligibilityResult[]> {
    const results = this.checkMany(templates, context);
    const grouped = new Map<BonusType, BonusEligibilityResult[]>();
    
    for (const result of results) {
      const type = result.template.type;
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(result);
    }
    
    return grouped;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  static calculateValue(template: BonusTemplate, context: BonusEligibilityContext): number {
    const baseAmount = context.depositAmount ?? context.activityAmount ?? 0;
    
    switch (template.valueType) {
      case 'fixed':
        return template.value;
        
      case 'percentage': {
        const calculated = baseAmount * (template.value / 100);
        return template.maxValue ? Math.min(calculated, template.maxValue) : calculated;
      }
      
      case 'tiered': {
        const multiplier = this.getTierMultiplier(template, context);
        return template.value * multiplier;
      }
      
      case 'dynamic': {
        return this.calculateDynamicValue(template, context);
      }
      
      default:
        return template.value;
    }
  }

  static calculateTurnover(template: BonusTemplate, context: BonusEligibilityContext): number {
    const bonusValue = this.calculateValue(template, context);
    return bonusValue * template.turnoverMultiplier;
  }

  static getContributionRate(template: BonusTemplate, category: string): number {
    if (!template.activityContributions) return 100;
    return template.activityContributions[category] ?? 0;
  }

  static calculateTurnoverContribution(
    template: BonusTemplate,
    amount: number,
    category: string
  ): number {
    const rate = this.getContributionRate(template, category);
    return amount * (rate / 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private static getTierMultiplier(_template: BonusTemplate, context: BonusEligibilityContext): number {
    const tierMultipliers: Record<string, number> = {
      'bronze': 1.0,
      'silver': 1.25,
      'gold': 1.5,
      'platinum': 2.0,
      'diamond': 2.5,
    };
    
    return tierMultipliers[context.userTier?.toLowerCase() ?? ''] ?? 1.0;
  }

  private static calculateDynamicValue(template: BonusTemplate, context: BonusEligibilityContext): number {
    if (template.type === 'combo' && context.selectionCount) {
      const baseValue = template.value;
      const multiplier = template.comboMultiplier ?? 1.1;
      const minActions = template.minActions ?? 3;
      const extraSelections = Math.max(0, context.selectionCount - minActions);
      return baseValue * Math.pow(multiplier, extraSelections);
    }
    
    if (template.type === 'streak' && context.consecutiveDays) {
      return template.value * Math.min(context.consecutiveDays, 7);
    }
    
    return template.value;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOM RULE EXTENSION
  // ─────────────────────────────────────────────────────────────────────────

  static addRule(rule: BonusValidationRule): void {
    this.rules.push(rule);
  }

  static removeRule(name: string): void {
    const index = this.rules.findIndex(r => r.name === name);
    if (index !== -1) {
      this.rules.splice(index, 1);
    }
  }

  static getRuleNames(): string[] {
    return this.rules.map(r => r.name);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const checkBonusEligibility = BonusEligibility.check.bind(BonusEligibility);
export const checkManyBonusEligibility = BonusEligibility.checkMany.bind(BonusEligibility);
export const getEligibleBonuses = BonusEligibility.getEligible.bind(BonusEligibility);
export const findBestDepositBonus = BonusEligibility.findBestForDeposit.bind(BonusEligibility);
export const findSelectionBonuses = BonusEligibility.findForSelections.bind(BonusEligibility);
