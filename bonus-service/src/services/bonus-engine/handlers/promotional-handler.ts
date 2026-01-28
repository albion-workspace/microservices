/**
 * Promotional & Credit Bonus Handlers
 * 
 * Handles: free_credit, trial, selection, combo, bundle bonuses
 */

import { logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler, type BaseHandlerOptions } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Free Credit Handler
// ═══════════════════════════════════════════════════════════════════

export class FreeCreditHandler extends BaseBonusHandler {
  readonly type: BonusType = 'free_credit';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

    // Check cooldown (free credits may have daily/weekly limits)
    const cooldownHours = (template as any).cooldownHours || 24;
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const recent = await userBonuses.findOne({
      userId: context.userId,
      templateId: template.id,
      claimedAt: { $gte: cutoff },
    });

    if (recent) {
      return {
        eligible: false,
        reason: 'Free credit already claimed recently',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Free credits usually have no turnover requirement or very low.
   */
  protected calculateTurnover(
    template: BonusTemplate,
    bonusValue: number,
    context: BonusContext
  ): number {
    // Free credits often have 1x turnover (just use it once)
    return template.turnoverMultiplier > 0
      ? bonusValue * template.turnoverMultiplier
      : bonusValue; // Default 1x
  }
}

// ═══════════════════════════════════════════════════════════════════
// Trial Handler (trial/sample credits)
// ═══════════════════════════════════════════════════════════════════

export class TrialHandler extends BaseBonusHandler {
  readonly type: BonusType = 'trial';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

    // Trial bonus is one-time only
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'trial',
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Trial bonus already used',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Trial usually has short expiration.
   */
  protected calculateExpiration(template: BonusTemplate, context: BonusContext): Date {
    const expiresAt = new Date();
    const expirationDays = (template as any).expirationDays || 7; // Default 7 days for trial
    expiresAt.setDate(expiresAt.getDate() + expirationDays);
    return expiresAt;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Selection Handler (user-selected bonus offer)
// ═══════════════════════════════════════════════════════════════════

export class SelectionHandler extends BaseBonusHandler {
  readonly type: BonusType = 'selection';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

    // Selection bonuses are typically one per offer period
    const selectionId = context.metadata?.selectionId as string;
    
    if (!selectionId) {
      return {
        eligible: false,
        reason: 'Selection ID required',
      };
    }

    // Check if this selection was already made
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'selection',
      'metadata.selectionId': selectionId,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Selection already made for this offer',
      };
    }

    return { eligible: true, template };
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      selectionId: context.metadata?.selectionId,
      selectionName: context.metadata?.selectionName,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Combo Handler (multi-action/combo bonus)
// ═══════════════════════════════════════════════════════════════════

export class ComboHandler extends BaseBonusHandler {
  readonly type: BonusType = 'combo';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Combo bonuses require multiple qualifying actions
    const comboActions = context.metadata?.comboActions as string[];
    const requiredActions = (template as any).requiredActions as string[] || [];
    
    if (!comboActions || comboActions.length === 0) {
      return {
        eligible: false,
        reason: 'Combo actions required',
      };
    }

    // Check all required actions are present
    const missingActions = requiredActions.filter(a => !comboActions.includes(a));
    if (missingActions.length > 0) {
      return {
        eligible: false,
        reason: `Missing actions: ${missingActions.join(', ')}`,
      };
    }

    return { eligible: true, template };
  }

  /**
   * Combo bonus value can scale with number of actions.
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const comboActions = (context.metadata?.comboActions as string[]) || [];
    const baseValue = template.value;
    
    // Multiplier based on combo length
    const comboMultiplier = (template as any).comboMultipliers as Record<number, number> || {
      2: 1.0,
      3: 1.5,
      4: 2.0,
      5: 3.0,
    };
    
    const multiplier = comboMultiplier[comboActions.length] || 1;
    return Math.floor(baseValue * multiplier);
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      comboActions: context.metadata?.comboActions,
      comboLength: (context.metadata?.comboActions as string[])?.length || 0,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Bundle Handler (bundle purchase bonus)
// ═══════════════════════════════════════════════════════════════════

export class BundleHandler extends BaseBonusHandler {
  readonly type: BonusType = 'bundle';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const bundleId = context.metadata?.bundleId as string;
    
    if (!bundleId) {
      return {
        eligible: false,
        reason: 'Bundle ID required',
      };
    }

    // Check if bundle purchase amount meets minimum
    const bundleAmount = (context.metadata?.bundleAmount as number) || context.depositAmount || 0;
    const minBundleAmount = (template as any).minBundleAmount || template.minDeposit || 0;
    
    if (bundleAmount < minBundleAmount) {
      return {
        eligible: false,
        reason: `Minimum bundle purchase of ${minBundleAmount} required`,
      };
    }

    return { eligible: true, template };
  }

  /**
   * Bundle bonus calculated as percentage of bundle value.
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const bundleAmount = (context.metadata?.bundleAmount as number) || context.depositAmount || 0;
    
    if (template.valueType === 'percentage') {
      let value = Math.floor(bundleAmount * (template.value / 100));
      return template.maxValue ? Math.min(value, template.maxValue) : value;
    }
    
    return template.value;
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      bundleId: context.metadata?.bundleId,
      bundleName: context.metadata?.bundleName,
      bundleAmount: context.metadata?.bundleAmount,
    };
    return bonus;
  }
}

