/**
 * Bonus Engine Types
 */

import type { BonusTemplate, UserBonus, BonusType, Currency } from '../../types.js';

// Re-export for consumers
export type { BonusTemplate, UserBonus, BonusType, Currency };

// ═══════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════

export interface BonusContext {
  userId: string;
  tenantId: string;
  currency?: Currency;
  
  // Deposit/transaction context
  depositAmount?: number;
  depositId?: string;
  transactionId?: string;
  walletId?: string;
  isFirstDeposit?: boolean;
  isFirstPurchase?: boolean;
  
  // Referral context
  referrerId?: string;
  refereeId?: string;
  referralCount?: number;  // Current referral count for tiered rewards
  
  // Activity context
  activityAmount?: number;
  activityType?: string;
  activityCategory?: string;
  category?: string;
  lossAmount?: number;
  
  // Selection context (for combo/bundle bonuses)
  selectionCount?: number;
  selections?: Array<{ id: string; value: number }>;
  
  // User context
  consecutiveDays?: number;
  achievementCode?: string;
  newTier?: string;
  userTier?: string;
  country?: string;
  
  // Custom metadata
  metadata?: Record<string, unknown>;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  template?: BonusTemplate;
  validators?: ValidatorResult[];
}

export interface ValidatorResult {
  validator: string;
  passed: boolean;
  reason?: string;
}

export interface BonusCalculation {
  bonusValue: number;
  turnoverRequired: number;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AwardResult {
  success: boolean;
  bonus?: UserBonus;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Handler Interface (Strategy Pattern)
// ═══════════════════════════════════════════════════════════════════

/**
 * Interface for all bonus type handlers.
 * Each bonus type implements this interface.
 */
export interface IBonusHandler {
  /** The bonus type this handler processes */
  readonly type: BonusType;
  
  /** Check if user is eligible for this bonus */
  checkEligibility(context: BonusContext): Promise<EligibilityResult>;
  
  /** Calculate bonus value and requirements */
  calculate(template: BonusTemplate, context: BonusContext): BonusCalculation;
  
  /** Award the bonus to the user */
  award(template: BonusTemplate, context: BonusContext): Promise<AwardResult>;
  
  /** Optional: Handle specific events for this bonus type */
  handleEvent?(eventType: string, data: unknown): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// Validator Interface (Chain of Responsibility)
// ═══════════════════════════════════════════════════════════════════

/**
 * Interface for eligibility validators.
 * Validators can be chained to build complex eligibility rules.
 */
export interface IEligibilityValidator {
  /** Unique identifier for this validator */
  readonly name: string;
  
  /** Priority (lower = runs first) */
  readonly priority: number;
  
  /** Check if this validator applies to the given context */
  appliesTo(bonusType: BonusType): boolean;
  
  /** Validate eligibility */
  validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult>;
}

// ═══════════════════════════════════════════════════════════════════
// Calculator Interface (Strategy Pattern)
// ═══════════════════════════════════════════════════════════════════

/**
 * Interface for bonus value calculators.
 * Different calculation strategies for different value types.
 */
export interface IBonusCalculator {
  /** The value type this calculator handles */
  readonly valueType: string;
  
  /** Calculate bonus value */
  calculate(
    template: BonusTemplate,
    context: BonusContext
  ): number;
}

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

export interface DepositEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  tenantId: string;
  amount: number;
  currency: string;
  isFirstDeposit?: boolean;
}

export interface ActivityEvent {
  userId: string;
  tenantId: string;
  amount: number;
  currency: string;
  category?: string;
  transactionId: string;
}

export interface WithdrawalEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  tenantId: string;
  amount: number;
  currency: string;
}

// ═══════════════════════════════════════════════════════════════════
// Registry Types
// ═══════════════════════════════════════════════════════════════════

export type HandlerMap = Map<BonusType, IBonusHandler>;
export type ValidatorList = IEligibilityValidator[];
export type CalculatorMap = Map<string, IBonusCalculator>;

