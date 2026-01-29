/**
 * Deposit/Onboarding Bonus Handlers
 * 
 * Handles: first_deposit, reload, welcome, first_purchase, first_action, top_up
 */

import { resolveDatabase, type DatabaseResolutionOptions, type Collection } from 'core-service';
import type { BonusTemplate, BonusType } from '../../../types.js';
import { BaseBonusHandler, type BaseHandlerOptions } from '../base-handler.js';
import type { BonusContext, EligibilityResult } from '../types.js';
import { createUserStatusFunctions } from '../user-status.js';

// ═══════════════════════════════════════════════════════════════════
// First Deposit Handler
// ═══════════════════════════════════════════════════════════════════

export class FirstDepositHandler extends BaseBonusHandler {
  readonly type: BonusType = 'first_deposit';
  private userStatus: ReturnType<typeof createUserStatusFunctions>;

  constructor(options?: BaseHandlerOptions) {
    super(options);
    this.userStatus = createUserStatusFunctions(options || {});
  }

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

    // Check if user already has a first deposit bonus (primary check)
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

    // Performance-optimized check: Use user status flag instead of querying transactions
    // This avoids scanning the large transactions table
    const hasDeposited = await this.userStatus.hasMadeFirstDeposit(context.userId, context.tenantId);
    
    if (hasDeposited) {
      return {
        eligible: false,
        reason: 'User has already made their first deposit',
      };
    }

    return { eligible: true, template };
  }
  
  /**
   * Note: User metadata updates are handled by auth-service.
   * Auth-service listens to wallet.deposit.completed events and updates
   * user.metadata.hasMadeFirstDeposit automatically.
   * No need to update here - bonus-service only queries metadata.
   */
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
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

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
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

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
  private userStatus: ReturnType<typeof createUserStatusFunctions>;

  constructor(options?: BaseHandlerOptions) {
    super(options);
    this.userStatus = createUserStatusFunctions(options || {});
  }

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

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

    // Performance-optimized check: Use user status flag
    const hasPurchased = await this.userStatus.hasMadeFirstPurchase(context.userId, context.tenantId);
    
    if (hasPurchased) {
      return {
        eligible: false,
        reason: 'User has already made their first purchase',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Note: User metadata updates are handled by auth-service via event listeners.
   * Bonus-service only queries user metadata (read-only access).
   */
}

// ═══════════════════════════════════════════════════════════════════
// First Action Handler (generic first activity)
// ═══════════════════════════════════════════════════════════════════

export class FirstActionHandler extends BaseBonusHandler {
  readonly type: BonusType = 'first_action';
  private userStatus: ReturnType<typeof createUserStatusFunctions>;

  constructor(options?: BaseHandlerOptions) {
    super(options);
    this.userStatus = createUserStatusFunctions(options || {});
  }

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const userBonuses = await this.getUserBonusesCollection(context.tenantId);

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

    // Performance-optimized check: Use user status flag
    const hasAction = await this.userStatus.hasCompletedFirstAction(context.userId, context.tenantId);
    
    if (hasAction) {
      return {
        eligible: false,
        reason: 'User has already completed their first action',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Note: User metadata updates are handled by auth-service via event listeners.
   * Bonus-service only queries user metadata (read-only access).
   */
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

