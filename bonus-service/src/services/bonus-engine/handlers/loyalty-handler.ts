/**
 * Loyalty & Engagement Bonus Handlers
 * 
 * Handles: daily_login, birthday, cashback, tier_upgrade, loyalty_points,
 *          loyalty, vip, anniversary, seasonal, flash
 */

import { getDatabase, logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Daily Login Handler
// ═══════════════════════════════════════════════════════════════════

export class DailyLoginHandler extends BaseBonusHandler {
  readonly type: BonusType = 'daily_login';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if already claimed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'daily_login',
      claimedAt: { $gte: todayStart },
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Daily login bonus already claimed today',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Calculate value based on consecutive login streak.
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    let baseValue = super.calculateValue(template, context);
    
    // Apply streak multiplier if applicable
    if (context.consecutiveDays && (template as any).streakMultipliers) {
      const streakMultipliers = (template as any).streakMultipliers as Record<number, number>;
      const multiplier = streakMultipliers[context.consecutiveDays] || 1;
      baseValue = Math.floor(baseValue * multiplier);
    }

    return baseValue;
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): UserBonus {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).streakDay = context.consecutiveDays || 1;
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Birthday Handler
// ═══════════════════════════════════════════════════════════════════

export class BirthdayHandler extends BaseBonusHandler {
  readonly type: BonusType = 'birthday';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if already claimed this year
    const thisYearStart = new Date();
    thisYearStart.setMonth(0, 1);
    thisYearStart.setHours(0, 0, 0, 0);

    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'birthday',
      claimedAt: { $gte: thisYearStart },
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Birthday bonus already claimed this year',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Cashback Handler
// ═══════════════════════════════════════════════════════════════════

export class CashbackHandler extends BaseBonusHandler {
  readonly type: BonusType = 'cashback';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Cashback requires a loss amount
    if (!context.lossAmount || context.lossAmount <= 0) {
      return {
        eligible: false,
        reason: 'No losses to cashback',
      };
    }

    // Check minimum loss threshold
    if (template.minDeposit && context.lossAmount < template.minDeposit) {
      return {
        eligible: false,
        reason: `Minimum loss of ${template.minDeposit} required for cashback`,
      };
    }

    return { eligible: true, template };
  }

  /**
   * Calculate cashback based on loss amount.
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const lossAmount = context.lossAmount || 0;
    
    if (template.valueType === 'percentage') {
      let value = Math.floor(lossAmount * (template.value / 100));
      if (template.maxValue && value > template.maxValue) {
        value = template.maxValue;
      }
      return value;
    }
    
    return super.calculateValue(template, context);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tier Upgrade Handler
// ═══════════════════════════════════════════════════════════════════

export class TierUpgradeHandler extends BaseBonusHandler {
  readonly type: BonusType = 'tier_upgrade';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Must have a new tier specified
    if (!context.newTier) {
      return {
        eligible: false,
        reason: 'New tier not specified',
      };
    }

    // Check if template is for this tier
    if (
      template.eligibleTiers &&
      !template.eligibleTiers.includes(context.newTier)
    ) {
      return {
        eligible: false,
        reason: `Bonus not available for tier: ${context.newTier}`,
      };
    }

    return { eligible: true, template };
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): UserBonus {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).upgradedToTier = context.newTier;
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Loyalty Points Handler
// ═══════════════════════════════════════════════════════════════════

export class LoyaltyPointsHandler extends BaseBonusHandler {
  readonly type: BonusType = 'loyalty_points';

  /**
   * Loyalty points typically don't expire.
   */
  protected calculateExpiration(template: BonusTemplate, context: BonusContext): Date {
    const expiresAt = new Date();
    const expirationDays = (template as any).expirationDays || 365; // Default 1 year
    expiresAt.setDate(expiresAt.getDate() + expirationDays);
    return expiresAt;
  }

  /**
   * Loyalty points usually don't have turnover requirements.
   */
  protected calculateTurnover(
    template: BonusTemplate,
    bonusValue: number,
    context: BonusContext
  ): number {
    return template.turnoverMultiplier > 0
      ? bonusValue * template.turnoverMultiplier
      : 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Loyalty Handler (tier-based ongoing bonus)
// ═══════════════════════════════════════════════════════════════════

export class LoyaltyHandler extends BaseBonusHandler {
  readonly type: BonusType = 'loyalty';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Check if user's tier is eligible
    if (template.eligibleTiers && template.eligibleTiers.length > 0) {
      if (!context.userTier || !template.eligibleTiers.includes(context.userTier)) {
        return {
          eligible: false,
          reason: `Tier ${context.userTier || 'none'} not eligible for this loyalty bonus`,
        };
      }
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// VIP Handler (exclusive VIP bonuses)
// ═══════════════════════════════════════════════════════════════════

export class VipHandler extends BaseBonusHandler {
  readonly type: BonusType = 'vip';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // VIP bonuses require VIP status
    const vipTiers = template.eligibleTiers || ['vip', 'platinum', 'diamond', 'elite'];
    
    if (!context.userTier || !vipTiers.includes(context.userTier.toLowerCase())) {
      return {
        eligible: false,
        reason: 'VIP status required',
      };
    }

    return { eligible: true, template };
  }

  /**
   * VIP bonuses often have enhanced values
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    let baseValue = super.calculateValue(template, context);
    
    // VIP tier multipliers
    const tierMultipliers: Record<string, number> = {
      vip: 1.0,
      platinum: 1.25,
      diamond: 1.5,
      elite: 2.0,
    };
    
    const multiplier = tierMultipliers[(context.userTier || '').toLowerCase()] || 1;
    return Math.floor(baseValue * multiplier);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Anniversary Handler (account anniversary bonus)
// ═══════════════════════════════════════════════════════════════════

export class AnniversaryHandler extends BaseBonusHandler {
  readonly type: BonusType = 'anniversary';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if already claimed this year
    const thisYearStart = new Date();
    thisYearStart.setMonth(0, 1);
    thisYearStart.setHours(0, 0, 0, 0);

    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'anniversary',
      claimedAt: { $gte: thisYearStart },
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Anniversary bonus already claimed this year',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Anniversary bonus can scale with account age
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    let baseValue = super.calculateValue(template, context);
    
    // If years is provided in metadata, scale bonus
    const years = (context.metadata?.accountYears as number) || 1;
    const multiplier = Math.min(years, 5); // Cap at 5x
    
    return Math.floor(baseValue * multiplier);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Seasonal Handler (holiday/event bonuses)
// ═══════════════════════════════════════════════════════════════════

export class SeasonalHandler extends BaseBonusHandler {
  readonly type: BonusType = 'seasonal';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if already claimed this seasonal period (by template code)
    const existing = await userBonuses.findOne({
      userId: context.userId,
      templateCode: template.code,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Seasonal bonus already claimed',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Flash Handler (limited-time bonuses)
// ═══════════════════════════════════════════════════════════════════

export class FlashHandler extends BaseBonusHandler {
  readonly type: BonusType = 'flash';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Flash bonuses have strict time windows
    const now = new Date();
    
    if (now < template.validFrom || now > template.validUntil) {
      return {
        eligible: false,
        reason: 'Flash bonus window has passed',
      };
    }

    // Check total usage limits (flash bonuses often have low limits)
    if (template.maxUsesTotal && template.currentUsesTotal >= template.maxUsesTotal) {
      return {
        eligible: false,
        reason: 'Flash bonus sold out',
      };
    }

    return { eligible: true, template };
  }
}

