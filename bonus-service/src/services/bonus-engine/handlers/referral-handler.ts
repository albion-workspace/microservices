/**
 * Referral Bonus Handlers
 * 
 * Handles: referral (for referrer), referee (for new user), commission
 * 
 * Referrals are tracked via UserBonus fields:
 * - UserBonus.refereeId: who was referred (for referrer bonuses)
 * - UserBonus.referrerId: who referred this user (for referee bonuses)
 */

import { getDatabase, logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';
import { userBonusPersistence } from '../persistence.js';

// ═══════════════════════════════════════════════════════════════════
// Referral Handler (for the referrer)
// ═══════════════════════════════════════════════════════════════════

export class ReferralHandler extends BaseBonusHandler {
  readonly type: BonusType = 'referral';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Must have a referee (the person who was referred)
    if (!context.refereeId) {
      return {
        eligible: false,
        reason: 'Referee ID required',
      };
    }

    // Check max referrals limit from template config
    const config = template.referralConfig;
    if (config?.maxReferralsPerUser) {
      const referralCount = await userBonusPersistence.countReferralsByUser(context.userId);
      if (referralCount >= config.maxReferralsPerUser) {
        return {
          eligible: false,
          reason: `Maximum referrals (${config.maxReferralsPerUser}) reached`,
        };
      }
    }

    // Check if already claimed for this specific referee
    const existingBonuses = await userBonusPersistence.findByUserId(context.userId, {
      type: 'referral',
      refereeId: context.refereeId,
    });

    if (existingBonuses.length > 0) {
      return {
        eligible: false,
        reason: 'Referral bonus already claimed for this user',
      };
    }

    // Check if referee meets minimum deposit requirement
    if (config?.requireRefereeDeposit && config?.minRefereeDeposit) {
      const depositAmount = context.depositAmount || 0;
      if (depositAmount < config.minRefereeDeposit) {
        return {
          eligible: false,
          reason: `Referee must deposit at least ${config.minRefereeDeposit}`,
        };
      }
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
    // Store the referee ID for tracking
    bonus.refereeId = context.refereeId;
    return bonus;
  }

  /**
   * Calculate value based on tiered rewards if configured
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const config = template.referralConfig;
    
    // Check for tiered rewards
    if (config?.referralTiers && config.referralTiers.length > 0) {
      // Get current referral count
      // Note: This is synchronous, so we use the count from context if available
      const referralCount = context.referralCount || 0;
      
      // Find applicable tier (highest tier that user qualifies for)
      let multiplier = 1;
      for (const tier of config.referralTiers.sort((a, b) => b.referralsRequired - a.referralsRequired)) {
        if (referralCount >= tier.referralsRequired) {
          multiplier = tier.bonusMultiplier;
          break;
        }
      }
      
      return Math.floor(template.value * multiplier);
    }
    
    // Default calculation
    return super.calculateValue(template, context);
  }

  protected async onAwarded(bonus: UserBonus, context: BonusContext): Promise<void> {
    logger.info('Referral bonus awarded to referrer', {
      referrerId: context.userId,
      refereeId: context.refereeId,
      bonusValue: bonus.currentValue,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Referee Handler (for the new user who was referred)
// ═══════════════════════════════════════════════════════════════════

export class RefereeHandler extends BaseBonusHandler {
  readonly type: BonusType = 'referee';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Must have been referred by someone
    if (!context.referrerId) {
      return {
        eligible: false,
        reason: 'User was not referred',
      };
    }

    // Check if already claimed (can only be referred once)
    const isReferred = await userBonusPersistence.isUserReferred(context.userId);
    if (isReferred) {
      return {
        eligible: false,
        reason: 'Referee bonus already claimed',
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
    // Store the referrer ID for tracking
    bonus.referrerId = context.referrerId;
    return bonus;
  }

  protected async onAwarded(bonus: UserBonus, context: BonusContext): Promise<void> {
    logger.info('Referee bonus awarded', {
      refereeId: context.userId,
      referrerId: context.referrerId,
      bonusValue: bonus.currentValue,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Commission Handler (recurring referral commissions)
// ═══════════════════════════════════════════════════════════════════

export class CommissionHandler extends BaseBonusHandler {
  readonly type: BonusType = 'commission';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Commission requires activity from referred users
    if (!context.activityAmount || context.activityAmount <= 0) {
      return {
        eligible: false,
        reason: 'No referral activity to commission',
      };
    }

    // Must have referred the user whose activity triggered this
    if (!context.refereeId) {
      return {
        eligible: false,
        reason: 'Referee ID required for commission',
      };
    }

    // Verify this user actually referred the referee
    const referralBonuses = await userBonusPersistence.findByUserId(context.userId, {
      type: 'referral',
      refereeId: context.refereeId,
    });

    if (referralBonuses.length === 0) {
      return {
        eligible: false,
        reason: 'User did not refer this referee',
      };
    }

    // Check max reward limit
    const config = template.referralConfig;
    if (config?.maxRewardPerUser) {
      const existingCommissions = await userBonusPersistence.findByUserId(context.userId, {
        type: 'commission',
      });
      const totalEarned = existingCommissions.reduce((sum, b) => sum + b.originalValue, 0);
      
      if (totalEarned >= config.maxRewardPerUser) {
        return {
          eligible: false,
          reason: 'Maximum commission reward reached',
        };
      }
    }

    return { eligible: true, template };
  }

  /**
   * Commission is calculated as percentage of referee's activity
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const activityAmount = context.activityAmount || 0;
    const commissionRate = template.value / 100; // e.g., 5% commission
    
    let commission = Math.floor(activityAmount * commissionRate);
    
    // Apply max value cap
    if (template.maxValue && commission > template.maxValue) {
      commission = template.maxValue;
    }
    
    // Check max reward per user
    const config = template.referralConfig;
    if (config?.maxRewardPerUser) {
      // This would need context.totalCommissionsEarned to be accurate
      // For now, just apply the per-transaction cap
    }
    
    return commission;
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    bonus.refereeId = context.refereeId;
    return bonus;
  }

  protected async onAwarded(bonus: UserBonus, context: BonusContext): Promise<void> {
    logger.info('Commission bonus awarded', {
      referrerId: context.userId,
      refereeId: context.refereeId,
      activityAmount: context.activityAmount,
      commission: bonus.currentValue,
    });
  }
}
