/**
 * Activity-Based Bonus Handlers
 * 
 * Handles: activity, streak, winback bonuses
 */

import { logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler, type BaseHandlerOptions } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Activity Handler (turnover-based bonus)
// ═══════════════════════════════════════════════════════════════════

export class ActivityHandler extends BaseBonusHandler {
  readonly type: BonusType = 'activity';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Activity bonus requires some activity amount
    if (!context.activityAmount || context.activityAmount <= 0) {
      return {
        eligible: false,
        reason: 'Activity amount required',
      };
    }

    return { eligible: true, template };
  }

  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    // Activity bonus is percentage of activity volume
    const activityAmount = context.activityAmount || 0;
    
    if (template.valueType === 'percentage') {
      let value = Math.floor(activityAmount * (template.value / 100));
      return template.maxValue ? Math.min(value, template.maxValue) : value;
    }
    
    return template.value;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Streak Handler (consecutive activity bonus)
// ═══════════════════════════════════════════════════════════════════

export class StreakHandler extends BaseBonusHandler {
  readonly type: BonusType = 'streak';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Streak requires consecutive days count
    if (!context.consecutiveDays || context.consecutiveDays < 1) {
      return {
        eligible: false,
        reason: 'Streak data required',
      };
    }

    // Check minimum streak requirement (from template metadata)
    const minStreak = (template as any).minStreakDays || 3;
    if (context.consecutiveDays < minStreak) {
      return {
        eligible: false,
        reason: `Minimum ${minStreak} day streak required`,
      };
    }

    return { eligible: true, template };
  }

  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    // Streak bonus can scale with streak length
    const streakDays = context.consecutiveDays || 1;
    const baseValue = template.value;
    
    // Multiplier based on streak (e.g., 7 days = 1.5x, 30 days = 2x)
    let multiplier = 1;
    if (streakDays >= 30) multiplier = 2.0;
    else if (streakDays >= 14) multiplier = 1.5;
    else if (streakDays >= 7) multiplier = 1.25;
    
    const value = Math.floor(baseValue * multiplier);
    return template.maxValue ? Math.min(value, template.maxValue) : value;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Winback Handler (re-engagement bonus for inactive users)
// ═══════════════════════════════════════════════════════════════════

export class WinbackHandler extends BaseBonusHandler {
  readonly type: BonusType = 'winback';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

    // Check if user already received winback recently
    const recentWinback = await userBonuses.findOne({
      userId: context.userId,
      type: 'winback',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // 30 days
    });

    if (recentWinback) {
      return {
        eligible: false,
        reason: 'Winback bonus recently claimed',
      };
    }

    // Verify user was inactive (would be passed in context or checked against activity)
    // For now, assume context.metadata.daysInactive is provided
    const daysInactive = (context.metadata?.daysInactive as number) || 0;
    const minInactiveDays = (template as any).minInactiveDays || 14;
    
    if (daysInactive < minInactiveDays) {
      return {
        eligible: false,
        reason: `User must be inactive for at least ${minInactiveDays} days`,
      };
    }

    return { eligible: true, template };
  }

  protected async onAwarded(bonus: UserBonus, context: BonusContext): Promise<void> {
    logger.info('Winback bonus awarded', {
      userId: context.userId,
      bonusValue: bonus.currentValue,
      daysInactive: context.metadata?.daysInactive,
    });
  }
}

