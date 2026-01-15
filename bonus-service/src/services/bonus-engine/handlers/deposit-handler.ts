/**
 * Deposit/Onboarding Bonus Handlers
 * 
 * Handles: first_deposit, reload, welcome, first_purchase, first_action, top_up
 */

import { getDatabase } from 'core-service';
import type { BonusTemplate, BonusType } from '../../../types.js';
import { BaseBonusHandler } from '../base-handler.js';
import type { BonusContext, EligibilityResult } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// First Deposit Handler
// ═══════════════════════════════════════════════════════════════════

export class FirstDepositHandler extends BaseBonusHandler {
  readonly type: BonusType = 'first_deposit';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if user already has a first deposit bonus
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: { $in: ['first_deposit', 'welcome'] },
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'First deposit bonus already claimed',
      };
    }

    // Verify this is actually the first deposit
    const transactions = db.collection('transactions');
    const depositCount = await transactions.countDocuments({
      userId: context.userId,
      type: 'deposit',
      status: 'completed',
    });

    if (depositCount > 1) {
      return {
        eligible: false,
        reason: 'Not a first deposit',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Reload Bonus Handler
// ═══════════════════════════════════════════════════════════════════

export class ReloadHandler extends BaseBonusHandler {
  readonly type: BonusType = 'reload';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Reload bonuses are available after first deposit
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check cooldown period (if template has one)
    const lastReload = await userBonuses
      .find({
        userId: context.userId,
        type: 'reload',
      })
      .sort({ claimedAt: -1 })
      .limit(1)
      .toArray();

    if (lastReload.length > 0 && (template as any).cooldownHours) {
      const hoursSinceLast =
        (Date.now() - new Date(lastReload[0].claimedAt as any).getTime()) /
        (1000 * 60 * 60);
      
      if (hoursSinceLast < (template as any).cooldownHours) {
        return {
          eligible: false,
          reason: `Reload bonus available in ${Math.ceil((template as any).cooldownHours - hoursSinceLast)} hours`,
        };
      }
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Welcome Bonus Handler
// ═══════════════════════════════════════════════════════════════════

export class WelcomeHandler extends BaseBonusHandler {
  readonly type: BonusType = 'welcome';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Welcome bonus can only be claimed once
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: { $in: ['welcome', 'first_deposit'] },
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Welcome bonus already claimed',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// First Purchase Handler (ecommerce)
// ═══════════════════════════════════════════════════════════════════

export class FirstPurchaseHandler extends BaseBonusHandler {
  readonly type: BonusType = 'first_purchase';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if user already has a first purchase bonus
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'first_purchase',
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'First purchase bonus already claimed',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// First Action Handler (generic first activity)
// ═══════════════════════════════════════════════════════════════════

export class FirstActionHandler extends BaseBonusHandler {
  readonly type: BonusType = 'first_action';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check if user already has a first action bonus
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'first_action',
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'First action bonus already claimed',
      };
    }

    return { eligible: true, template };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Top Up Handler (balance top-up bonus)
// ═══════════════════════════════════════════════════════════════════

export class TopUpHandler extends BaseBonusHandler {
  readonly type: BonusType = 'top_up';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Similar to reload, but for balance top-ups
    if (!context.depositAmount || context.depositAmount <= 0) {
      return {
        eligible: false,
        reason: 'Top-up amount required',
      };
    }

    return { eligible: true, template };
  }
}

