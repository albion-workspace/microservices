/**
 * Server-Side Eligibility Validators
 * 
 * This module extends the client-safe BonusEligibility class with
 * server-only validators that require database access.
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  CLIENT (shared-validators/BonusEligibility) - IMPORTED        │
 * │  ─────────────────────────────────────────────────────────────  │
 * │  • Date range     • Currency       • Min deposit               │
 * │  • User tier      • Country        • Selection count           │
 * │  • Verification   • Account age    • Activity category         │
 * │  • Total uses     • First deposit  • First purchase            │
 * └─────────────────────────────────────────────────────────────────┘
 *                              ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SERVER (this file)                                            │
 * │  ─────────────────────────────────────────────────────────────  │
 * │  • Max uses per user (query user_bonuses)                      │
 * │  • Cooldown period (query recent claims)                       │
 * │  • Already claimed check                                        │
 * │  • Stacking rules (query active bonuses)                       │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { resolveDatabase, type DatabaseResolutionOptions, type Collection, type Db } from 'core-service';
import { BonusEligibility } from 'shared-validators';
import type { BonusTemplate, BonusType } from '../../types.js';
import type { 
  BonusContext, 
  ValidatorResult, 
  IEligibilityValidator,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Validator Options
// ═══════════════════════════════════════════════════════════════════

export interface ValidatorOptions extends DatabaseResolutionOptions {
  // Can extend with validator-specific options if needed
}

// Helper to resolve database (requires database strategy - no fallback per coding standards)
async function resolveValidatorDatabase(options: ValidatorOptions, tenantId?: string): Promise<Db> {
  if (!options.databaseStrategy && !options.database) {
    throw new Error('Validator requires database or databaseStrategy in options. Ensure validator is called with proper database configuration.');
  }
  return await resolveDatabase(options, 'bonus-service', tenantId);
}

// Helper to get user bonuses collection
async function getUserBonusesCollection(options: ValidatorOptions, tenantId?: string): Promise<Collection> {
  const db = await resolveValidatorDatabase(options, tenantId);
  return db.collection('user_bonuses');
}


// ═══════════════════════════════════════════════════════════════════
// SERVER-ONLY VALIDATORS (Require Database Access)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validates max uses per user limit (requires DB query).
 */
export class MaxUsesPerUserValidator implements IEligibilityValidator {
  readonly name = 'max_uses_per_user';
  readonly priority = 30;
  
  constructor(private options: ValidatorOptions) {}

  appliesTo(_bonusType: BonusType): boolean {
    return true;
  }

  async validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult> {
    if (template.maxUsesPerUser) {
      const userBonuses = await getUserBonusesCollection(this.options, context.tenantId);
      
      const count = await userBonuses.countDocuments({
        userId: context.userId,
        templateId: template.id,
      });

      if (count >= template.maxUsesPerUser) {
        return {
          validator: this.name,
          passed: false,
          reason: 'Maximum bonus claims reached',
        };
      }
    }
    return { validator: this.name, passed: true };
  }
}

/**
 * Validates cooldown period between bonus claims (requires DB query).
 */
export class CooldownValidator implements IEligibilityValidator {
  readonly name = 'cooldown';
  readonly priority = 60;
  
  constructor(private options: ValidatorOptions) {}

  appliesTo(bonusType: BonusType): boolean {
    return ['reload', 'daily_login', 'cashback', 'consolation', 'free_credit'].includes(bonusType);
  }

  async validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult> {
    const cooldownHours = (template as any).cooldownHours;
    
    if (cooldownHours) {
      const userBonuses = await getUserBonusesCollection(this.options, context.tenantId);
      const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

      const recent = await userBonuses.findOne({
        userId: context.userId,
        templateId: template.id,
        claimedAt: { $gte: cutoff },
      });

      if (recent) {
        return {
          validator: this.name,
          passed: false,
          reason: `Bonus available again in ${cooldownHours} hours`,
        };
      }
    }

    return { validator: this.name, passed: true };
  }
}

/**
 * Validates user hasn't already claimed this bonus (requires DB query).
 */
export class AlreadyClaimedValidator implements IEligibilityValidator {
  readonly name = 'already_claimed';
  readonly priority = 25;
  
  constructor(private options: ValidatorOptions) {}

  appliesTo(bonusType: BonusType): boolean {
    // Only applies to one-time bonuses
    return ['welcome', 'first_deposit', 'first_purchase', 'first_action', 'referee'].includes(bonusType);
  }

  async validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult> {
    const userBonuses = await getUserBonusesCollection(this.options, context.tenantId);
    
    const existing = await userBonuses.findOne({
      userId: context.userId,
      templateId: template.id,
      status: { $nin: ['cancelled', 'forfeited'] },
    });

    if (existing) {
      return {
        validator: this.name,
        passed: false,
        reason: 'Bonus already claimed',
      };
    }

    return { validator: this.name, passed: true };
  }
}

/**
 * Validates stacking rules (requires DB query for active bonuses).
 */
export class StackingValidator implements IEligibilityValidator {
  readonly name = 'stacking';
  readonly priority = 70;
  
  constructor(private options: ValidatorOptions) {}

  appliesTo(_bonusType: BonusType): boolean {
    return true;
  }

  async validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult> {
    const userBonuses = await getUserBonusesCollection(this.options, context.tenantId);
    
    if (template.stackable === false) {
      // Check for any active bonus
      const activeBonus = await userBonuses.findOne({
        userId: context.userId,
        status: { $in: ['active', 'in_progress'] },
      });

      if (activeBonus) {
        return {
          validator: this.name,
          passed: false,
          reason: 'Cannot stack with active bonus',
        };
      }
    }

    // Check excluded bonus types
    if (template.excludedBonusTypes?.length) {
      const conflicting = await userBonuses.findOne({
        userId: context.userId,
        type: { $in: template.excludedBonusTypes },
        status: { $in: ['active', 'in_progress'] },
      });

      if (conflicting) {
        return {
          validator: this.name,
          passed: false,
          reason: `Cannot combine with ${(conflicting as any).type} bonus`,
        };
      }
    }

    return { validator: this.name, passed: true };
  }
}

/**
 * Validates referral-specific rules (requires DB query).
 */
export class ReferralValidator implements IEligibilityValidator {
  readonly name = 'referral';
  readonly priority = 80;
  
  constructor(private options: ValidatorOptions) {}

  appliesTo(bonusType: BonusType): boolean {
    return ['referral', 'referee', 'commission'].includes(bonusType);
  }

  async validate(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<ValidatorResult> {
    const config = template.referralConfig;
    
    if (!config) {
      return { validator: this.name, passed: true };
    }

    // For referrer bonuses, check max referrals
    if (template.type === 'referral' && config.maxReferralsPerUser && context.referralCount) {
      if (context.referralCount >= config.maxReferralsPerUser) {
        return {
          validator: this.name,
          passed: false,
          reason: `Maximum referrals (${config.maxReferralsPerUser}) reached`,
        };
      }
    }

    // For referee bonuses, check if referee deposit required
    if (template.type === 'referee' && config.requireRefereeDeposit) {
      if (!context.depositAmount || (config.minRefereeDeposit && context.depositAmount < config.minRefereeDeposit)) {
        return {
          validator: this.name,
          passed: false,
          reason: `Minimum deposit of ${config.minRefereeDeposit} required`,
        };
      }
    }

    return { validator: this.name, passed: true };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT-SAFE VALIDATORS
// ═══════════════════════════════════════════════════════════════════
// All client-safe validators are handled by BonusEligibility from
// shared-validators. The ValidatorChain uses BonusEligibility.check()
// which includes validation for:
// • Date range, Currency, Min deposit, Max uses total, User tier
// • Country, Selection count/values, First deposit/purchase checks
// • Account age, Verification level, Activity category, KYC tier
//
// See: shared-validators/src/BonusEligibility.ts for source of truth.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// VALIDATOR CHAIN (Server-Side with DB Access)
// ═══════════════════════════════════════════════════════════════════

/**
 * Server-side validator chain that uses BonusEligibility for client-safe
 * rules and adds server-only validators that require database access.
 */
export class ValidatorChain {
  private serverValidators: IEligibilityValidator[] = [];

  constructor(private options?: ValidatorOptions) {
    // Server-only validators (require DB access)
    // Client-safe validators are handled by BonusEligibility from shared-validators
    if (!options?.databaseStrategy) {
      throw new Error('ValidatorChain requires databaseStrategy in options');
    }
    this.add(new AlreadyClaimedValidator(options));
    this.add(new MaxUsesPerUserValidator(options));
    this.add(new CooldownValidator(options));
    this.add(new StackingValidator(options));
    this.add(new ReferralValidator(options));
  }

  add(validator: IEligibilityValidator): void {
    this.serverValidators.push(validator);
    this.serverValidators.sort((a, b) => a.priority - b.priority);
  }

  remove(name: string): void {
    this.serverValidators = this.serverValidators.filter(v => v.name !== name);
  }

  /**
   * Converts BonusTemplate to the format expected by BonusEligibility.
   */
  private toClientTemplate(template: BonusTemplate): any {
    return {
      id: template.id,
      name: template.name,
      code: template.code,
      type: template.type,
      domain: template.domain,
      valueType: template.valueType,
      value: template.value,
      currency: template.currency,
      supportedCurrencies: template.supportedCurrencies,
      maxValue: template.maxValue,
      minDeposit: template.minDeposit,
      turnoverMultiplier: template.turnoverMultiplier,
      validFrom: template.validFrom,
      validUntil: template.validUntil,
      maxUsesTotal: template.maxUsesTotal,
      currentUsesTotal: template.currentUsesTotal,
      eligibleTiers: template.eligibleTiers,
      eligibleCountries: template.eligibleCountries,
      excludedCountries: template.excludedCountries,
      minSelections: template.minSelections,
      maxSelections: template.maxSelections,
      min: template.min,
      max: template.max,
      minTotal: template.minTotal,
      maxTotal: template.maxTotal,
      isActive: template.isActive,
    };
  }

  /**
   * Converts BonusContext to the format expected by BonusEligibility.
   */
  private toClientContext(context: BonusContext): any {
    return {
      userId: context.userId,
      currency: context.currency,
      depositAmount: context.depositAmount,
      isFirstDeposit: context.isFirstDeposit,
      isFirstPurchase: context.isFirstPurchase,
      userTier: context.userTier || context.metadata?.userTier,
      country: context.country || context.metadata?.country,
      selectionCount: context.selectionCount,
      selections: context.selections,
      activityType: context.activityType,
      activityCategory: context.activityCategory,
    };
  }

  async validate(
    bonusType: BonusType,
    template: BonusTemplate,
    context: BonusContext,
    stopOnFailure = true
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];
    
    // Step 1: Run client-safe validators using BonusEligibility
    const clientTemplate = this.toClientTemplate(template);
    const clientContext = this.toClientContext(context);
    const clientResult = BonusEligibility.check(clientTemplate, clientContext);
    
    if (!clientResult.eligible) {
      // Convert client reasons to ValidatorResults
      for (const reason of clientResult.reasons) {
        results.push({
          validator: 'client_eligibility',
          passed: false,
          reason,
        });
        if (stopOnFailure) {
          return results;
        }
      }
    } else {
      results.push({
        validator: 'client_eligibility',
        passed: true,
      });
    }
    
    // Step 2: Run server-only validators (require DB)
    const applicableValidators = this.serverValidators.filter(v => 
      v.appliesTo(bonusType)
    );

    for (const validator of applicableValidators) {
      const result = await validator.validate(template, context);
      results.push(result);
      
      if (!result.passed && stopOnFailure) {
        break;
      }
    }

    return results;
  }

  async isEligible(
    bonusType: BonusType,
    template: BonusTemplate,
    context: BonusContext
  ): Promise<{ eligible: boolean; reason?: string; results: ValidatorResult[] }> {
    const results = await this.validate(bonusType, template, context);
    const failedValidator = results.find(r => !r.passed);
    
    return {
      eligible: !failedValidator,
      reason: failedValidator?.reason,
      results,
    };
  }
}

// Factory function to create validator chain with database strategy
export function createValidatorChain(options: ValidatorOptions): ValidatorChain {
  return new ValidatorChain(options);
}
