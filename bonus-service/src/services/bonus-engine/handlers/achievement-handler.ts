/**
 * Achievement & Special Event Bonus Handlers
 * 
 * Handles: achievement, milestone, special_event, promo_code, consolation,
 *          task_completion, challenge
 */

import { getDatabase, logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Achievement Handler
// ═══════════════════════════════════════════════════════════════════

export class AchievementHandler extends BaseBonusHandler {
  readonly type: BonusType = 'achievement';

  async checkEligibility(context: BonusContext): Promise<EligibilityResult> {
    const db = getDatabase();
    const templates = db.collection('bonus_templates');
    const userBonuses = db.collection('user_bonuses');

    // Find template by achievement code
    if (!context.achievementCode) {
      return { eligible: false, reason: 'Achievement code required' };
    }

    const template = await templates.findOne({
      type: 'achievement',
      isActive: true,
      tags: context.achievementCode,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    }) as BonusTemplate | null;

    if (!template) {
      return { eligible: false, reason: 'No bonus for this achievement' };
    }

    // Check if already claimed
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'achievement',
      'metadata.achievementCode': context.achievementCode,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Achievement bonus already claimed',
      };
    }

    const commonResult = await this.runCommonValidators(template, context);
    if (!commonResult.eligible) {
      return commonResult;
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
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      achievementCode: context.achievementCode,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Milestone Handler
// ═══════════════════════════════════════════════════════════════════

export class MilestoneHandler extends BaseBonusHandler {
  readonly type: BonusType = 'milestone';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check milestone thresholds from context metadata
    const milestoneType = context.metadata?.milestoneType as string;
    const milestoneValue = context.metadata?.milestoneValue as number;

    if (!milestoneType || milestoneValue === undefined) {
      return {
        eligible: false,
        reason: 'Milestone type and value required',
      };
    }

    // Check if this milestone was already claimed
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'milestone',
      'metadata.milestoneType': milestoneType,
      'metadata.milestoneValue': milestoneValue,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Milestone bonus already claimed',
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
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      milestoneType: context.metadata?.milestoneType,
      milestoneValue: context.metadata?.milestoneValue,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Special Event Handler
// ═══════════════════════════════════════════════════════════════════

export class SpecialEventHandler extends BaseBonusHandler {
  readonly type: BonusType = 'special_event';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Special events typically have specific date ranges
    const now = new Date();
    
    if (template.validFrom > now || template.validUntil < now) {
      return {
        eligible: false,
        reason: 'Special event is not active',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Promo Code Handler
// ═══════════════════════════════════════════════════════════════════

export class PromoCodeHandler extends BaseBonusHandler {
  readonly type: BonusType = 'promo_code';

  async checkEligibility(context: BonusContext): Promise<EligibilityResult> {
    const db = getDatabase();
    const templates = db.collection('bonus_templates');
    const userBonuses = db.collection('user_bonuses');

    const promoCode = context.metadata?.promoCode as string;
    
    if (!promoCode) {
      return { eligible: false, reason: 'Promo code required' };
    }

    // Find template by promo code
    const template = await templates.findOne({
      type: 'promo_code',
      code: promoCode.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    }) as BonusTemplate | null;

    if (!template) {
      return { eligible: false, reason: 'Invalid or expired promo code' };
    }

    // Check if already used
    const existing = await userBonuses.findOne({
      userId: context.userId,
      templateCode: promoCode.toUpperCase(),
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Promo code already used',
      };
    }

    const commonResult = await this.runCommonValidators(template, context);
    if (!commonResult.eligible) {
      return commonResult;
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Consolation Handler (next round bonus after loss)
// ═══════════════════════════════════════════════════════════════════

export class ConsolationHandler extends BaseBonusHandler {
  readonly type: BonusType = 'consolation';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Consolation requires a loss
    if (!context.lossAmount || context.lossAmount <= 0) {
      return {
        eligible: false,
        reason: 'No loss to console',
      };
    }

    // Check minimum loss for consolation
    const minLoss = (template as any).minLoss || 0;
    if (context.lossAmount < minLoss) {
      return {
        eligible: false,
        reason: `Minimum loss of ${minLoss} required`,
      };
    }

    // Check cooldown (prevent spam)
    const cooldownHours = (template as any).cooldownHours || 24;
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const recent = await userBonuses.findOne({
      userId: context.userId,
      type: 'consolation',
      claimedAt: { $gte: cutoff },
    });

    if (recent) {
      return {
        eligible: false,
        reason: 'Consolation bonus on cooldown',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Consolation value based on loss amount.
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
// Task Completion Handler
// ═══════════════════════════════════════════════════════════════════

export class TaskCompletionHandler extends BaseBonusHandler {
  readonly type: BonusType = 'task_completion';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    const taskId = context.metadata?.taskId as string;
    
    if (!taskId) {
      return {
        eligible: false,
        reason: 'Task ID required',
      };
    }

    // Check if task bonus already claimed
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'task_completion',
      'metadata.taskId': taskId,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Task completion bonus already claimed',
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
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      taskId: context.metadata?.taskId,
      taskName: context.metadata?.taskName,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Challenge Handler
// ═══════════════════════════════════════════════════════════════════

export class ChallengeHandler extends BaseBonusHandler {
  readonly type: BonusType = 'challenge';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    const challengeId = context.metadata?.challengeId as string;
    
    if (!challengeId) {
      return {
        eligible: false,
        reason: 'Challenge ID required',
      };
    }

    // Check if challenge bonus already claimed
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'challenge',
      'metadata.challengeId': challengeId,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Challenge bonus already claimed',
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
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      challengeId: context.metadata?.challengeId,
      challengeName: context.metadata?.challengeName,
    };
    return bonus;
  }
}

