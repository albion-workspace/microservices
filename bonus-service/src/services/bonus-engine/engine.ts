/**
 * Bonus Engine (Facade Pattern)
 * 
 * Main entry point that orchestrates handlers, validators, and actions.
 * Provides a clean API while hiding internal complexity.
 * 
 * Uses persistence layer for data access, allowing integration
 * with both direct queries and saga-based services.
 */

import { logger } from 'core-service';
import type { 
  BonusTemplate, 
  UserBonus, 
  BonusType, 
  BonusStatus,
  BonusHistoryEntry,
} from '../../types.js';
import type { 
  BonusContext, 
  EligibilityResult, 
  AwardResult,
  DepositEvent,
  PurchaseEvent,
  ActionEvent,
  ActivityEvent,
  WithdrawalEvent,
} from './types.js';
import { handlerRegistry, getHandler, createHandler } from './handler-registry.js';
import { validatorChain } from './validators.js';
import { 
  templatePersistence, 
  userBonusPersistence, 
  transactionPersistence,
} from './persistence.js';
import { emitBonusEvent } from '../../event-dispatcher.js';
import { 
  recordBonusConversionTransfer,
  recordBonusForfeitTransfer,
} from '../bonus.js';

// ═══════════════════════════════════════════════════════════════════
// Bonus Engine Facade
// ═══════════════════════════════════════════════════════════════════

export class BonusEngine {
  constructor() {
    // Initialize the handler registry
    handlerRegistry.initialize();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Core Operations
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check eligibility for a specific bonus type.
   */
  async checkEligibility(
    bonusType: BonusType,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const handler = getHandler(bonusType);
    
    if (!handler) {
      return {
        eligible: false,
        reason: `No handler for bonus type: ${bonusType}`,
      };
    }

    return handler.checkEligibility(context);
  }

  /**
   * Award a bonus to a user.
   */
  async award(bonusType: BonusType, context: BonusContext): Promise<AwardResult> {
    const handler = getHandler(bonusType);
    
    if (!handler) {
      return {
        success: false,
        error: `No handler for bonus type: ${bonusType}`,
      };
    }

    // Check eligibility first
    const eligibility = await handler.checkEligibility(context);
    
    if (!eligibility.eligible || !eligibility.template) {
      return {
        success: false,
        error: eligibility.reason || 'Not eligible',
      };
    }

    // Award the bonus
    return handler.award(eligibility.template, context);
  }

  /**
   * Find all bonuses user is eligible for.
   * Uses persistence layer for data access.
   */
  async findEligibleBonuses(context: BonusContext): Promise<BonusTemplate[]> {
    // Use persistence layer for queries
    const allTemplates = await templatePersistence.findActive();

    const eligible: BonusTemplate[] = [];

    for (const template of allTemplates) {
      const handler = getHandler(template.type);
      if (!handler) continue;

      const result = await handler.checkEligibility(context);
      if (result.eligible) {
        eligible.push(template);
      }
    }

    // Sort by priority
    return eligible.sort((a, b) => b.priority - a.priority);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Event Handlers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle deposit event - check and award eligible bonuses.
   */
  async handleDeposit(event: DepositEvent): Promise<UserBonus[]> {
    const awarded: UserBonus[] = [];
    const context: BonusContext = {
      userId: event.userId,
      tenantId: event.tenantId,
      depositAmount: event.amount,
      depositId: event.transactionId,
      walletId: event.walletId,
      currency: event.currency,
    };

    // Try first deposit bonus
    if (event.isFirstDeposit !== false) {
      const result = await this.award('first_deposit', context);
      if (result.success && result.bonus) {
        awarded.push(result.bonus);
      }
    }

    // Try reload bonus
    const reloadResult = await this.award('reload', context);
    if (reloadResult.success && reloadResult.bonus) {
      awarded.push(reloadResult.bonus);
    }

    logger.info('Deposit bonuses processed', {
      userId: event.userId,
      depositId: event.transactionId,
      awarded: awarded.map(b => ({ id: b.id, type: b.type, value: b.currentValue })),
    });

    return awarded;
  }

  /**
   * Handle purchase event - check and award eligible bonuses (e.g., first_purchase).
   */
  async handlePurchase(event: PurchaseEvent): Promise<UserBonus[]> {
    const awarded: UserBonus[] = [];
    const context: BonusContext = {
      userId: event.userId,
      tenantId: event.tenantId,
      depositAmount: event.amount, // Reuse depositAmount field for purchase amount
      transactionId: event.transactionId,
      walletId: event.walletId,
      currency: event.currency,
      isFirstPurchase: event.isFirstPurchase,
    };

    // Try first purchase bonus
    // Note: Metadata check happens in FirstPurchaseHandler.validateSpecific
    const result = await this.award('first_purchase', context);
    if (result.success && result.bonus) {
      awarded.push(result.bonus);
    }

    logger.info('Purchase bonuses processed', {
      userId: event.userId,
      transactionId: event.transactionId,
      awarded: awarded.map(b => ({ id: b.id, type: b.type, value: b.currentValue })),
    });

    return awarded;
  }

  /**
   * Handle action event - check and award eligible bonuses (e.g., first_action).
   */
  async handleAction(event: ActionEvent): Promise<UserBonus[]> {
    const awarded: UserBonus[] = [];
    const context: BonusContext = {
      userId: event.userId,
      tenantId: event.tenantId,
      activityAmount: event.amount, // Use activityAmount for action amount
      transactionId: event.transactionId,
      walletId: event.walletId,
      currency: event.currency,
    };

    // Try first action bonus
    // Note: Metadata check happens in FirstActionHandler.validateSpecific
    const result = await this.award('first_action', context);
    if (result.success && result.bonus) {
      awarded.push(result.bonus);
    }

    logger.info('Action bonuses processed', {
      userId: event.userId,
      transactionId: event.transactionId,
      awarded: awarded.map(b => ({ id: b.id, type: b.type, value: b.currentValue })),
    });

    return awarded;
  }

  /**
   * Handle activity event - update turnover progress.
   * Uses persistence layer for data operations.
   */
  async handleActivity(event: ActivityEvent): Promise<void> {
    // Find active bonuses with turnover requirements using persistence
    const activeBonuses = await userBonusPersistence.findByUserId(event.userId, {
      status: { $in: ['active', 'in_progress'] },
      turnoverRequired: { $gt: 0 },
    });

    for (const bonus of activeBonuses) {
      let contribution = event.amount;
      
      // Get category contribution rate using persistence
      const template = await templatePersistence.findById(bonus.templateId);

      if (template?.activityContributions && event.category) {
        const rate = template.activityContributions[event.category] ?? 100;
        contribution = Math.floor(event.amount * (rate / 100));
      }

      if (contribution <= 0) continue;

      const newProgress = bonus.turnoverProgress + contribution;
      const newStatus: BonusStatus = newProgress >= bonus.turnoverRequired
        ? 'requirements_met'
        : 'in_progress';

      // Record transaction using persistence layer
      // MongoDB will automatically create _id, which will be normalized to id when reading
      await transactionPersistence.create({
        userBonusId: bonus.id,
        userId: event.userId,
        tenantId: event.tenantId,
        type: 'turnover',
        currency: event.currency as any,
        amount: contribution,
        balanceBefore: bonus.currentValue,
        balanceAfter: bonus.currentValue,
        turnoverBefore: bonus.turnoverProgress,
        turnoverAfter: newProgress,
        turnoverContribution: contribution,
        relatedTransactionId: event.transactionId,
        activityCategory: event.category,
      });

      // Update bonus using persistence layer
      const historyEntry: BonusHistoryEntry = {
        timestamp: new Date(),
        action: 'turnover_recorded',
        newStatus,
        turnoverAmount: contribution,
        triggeredBy: 'system',
      };

      await userBonusPersistence.updateTurnover(
        bonus.id,
        newProgress,
        newStatus,
        historyEntry
      );

      // Emit event if requirements met (unified: internal + webhooks)
      if (newStatus === 'requirements_met') {
        try {
          await emitBonusEvent('bonus.requirements_met', event.tenantId, event.userId, {
            bonusId: bonus.id,
            type: bonus.type,
            value: bonus.currentValue,
            currency: bonus.currency,
          });
        } catch (err) {
          logger.warn('Failed to emit bonus.requirements_met', { error: err });
        }
      }

      logger.debug('Turnover recorded', {
        bonusId: bonus.id,
        contribution,
        newProgress,
        required: bonus.turnoverRequired,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Bonus Actions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Convert bonus to real balance.
   * Uses persistence layer for data operations.
   */
  async convert(bonusId: string, userId: string): Promise<UserBonus | null> {
    // Find bonus using persistence
    const allBonuses = await userBonusPersistence.findByUserId(userId, {
      id: bonusId,
      status: 'requirements_met',
    });
    const bonus = allBonuses.find(b => b.id === bonusId) || null;

    if (!bonus) {
      logger.warn('Bonus not found or not ready for conversion', { bonusId, userId });
      return null;
    }

    // Record conversion in ledger FIRST
    try {
      await recordBonusConversionTransfer(
        userId,
        bonus.currentValue,
        bonus.currency,
        bonus.tenantId,
        bonus.id,
        `Bonus converted: ${bonus.type}`
      );
    } catch (ledgerError) {
      logger.error('Failed to record bonus conversion in ledger', { error: ledgerError, bonusId });
      throw new Error('Failed to record bonus conversion in ledger');
    }

    const now = new Date();
    const historyEntry: BonusHistoryEntry = {
      timestamp: now,
      action: 'converted',
      newStatus: 'converted',
      amount: bonus.currentValue,
      triggeredBy: 'user',
    };

    // Update using persistence layer
    await userBonusPersistence.updateStatus(bonusId, 'converted', historyEntry, {
      convertedAt: now,
    });

    // Emit for payment gateway + webhooks (unified)
    try {
      await emitBonusEvent('bonus.converted', bonus.tenantId, userId, {
        bonusId: bonus.id,
        walletId: bonus.walletId,
        amount: bonus.currentValue,
        currency: bonus.currency,
      });
    } catch (err) {
      logger.warn('Failed to emit bonus.converted', { error: err });
    }

    logger.info('Bonus converted', { bonusId, value: bonus.currentValue });
    return { ...bonus, status: 'converted', convertedAt: now };
  }

  /**
   * Forfeit a bonus.
   * Uses persistence layer for data operations.
   */
  async forfeit(bonusId: string, userId: string, reason: string): Promise<UserBonus | null> {
    // Find bonus using persistence
    const allBonuses = await userBonusPersistence.findByUserId(userId, {
      status: { $in: ['active', 'in_progress', 'requirements_met'] },
    });
    const bonus = allBonuses.find(b => b.id === bonusId) || null;

    if (!bonus) return null;

    // Record forfeiture in ledger FIRST
    try {
      await recordBonusForfeitTransfer(
        userId,
        bonus.currentValue,
        bonus.currency,
        bonus.tenantId,
        bonus.id,
        reason,
        `Bonus forfeited: ${reason}`
      );
    } catch (ledgerError) {
      logger.error('Failed to record bonus forfeiture in ledger', { error: ledgerError, bonusId });
      throw new Error('Failed to record bonus forfeiture in ledger');
    }

    const now = new Date();
    const historyEntry: BonusHistoryEntry = {
      timestamp: now,
      action: 'forfeited',
      newStatus: 'forfeited',
      amount: bonus.currentValue,
      triggeredBy: 'system',
    };

    // Update using persistence layer
    await userBonusPersistence.updateStatus(bonusId, 'forfeited', historyEntry, {
      currentValue: 0,
      forfeitedAt: now,
    });

    // Emit for payment gateway + webhooks (unified)
    try {
      await emitBonusEvent('bonus.forfeited', bonus.tenantId, userId, {
        bonusId: bonus.id,
        walletId: bonus.walletId, // For payment-gateway to debit the wallet
        forfeitedValue: bonus.currentValue,
        currency: bonus.currency,
        reason,
      });
    } catch (err) {
      logger.warn('Failed to emit bonus.forfeited', { error: err });
    }

    logger.info('Bonus forfeited', { bonusId, reason });
    return { ...bonus, status: 'forfeited', currentValue: 0 };
  }

  /**
   * Cancel a bonus (before usage).
   * Uses persistence layer for data operations.
   */
  async cancel(bonusId: string, userId: string): Promise<UserBonus | null> {
    // Find bonus using persistence
    const allBonuses = await userBonusPersistence.findByUserId(userId, {
      status: { $in: ['pending', 'active'] },
      turnoverProgress: 0,
    });
    const bonus = allBonuses.find(b => b.id === bonusId) || null;

    if (!bonus) return null;

    const now = new Date();
    const historyEntry: BonusHistoryEntry = {
      timestamp: now,
      action: 'cancelled',
      newStatus: 'cancelled',
      triggeredBy: 'user',
    };

    // Update using persistence layer
    await userBonusPersistence.updateStatus(bonusId, 'cancelled', historyEntry, {
      currentValue: 0,
    });

    logger.info('Bonus cancelled', { bonusId });
    return { ...bonus, status: 'cancelled', currentValue: 0 };
  }

  /**
   * Expire old bonuses (call from cron job).
   * Uses persistence layer for data operations.
   */
  async expireOldBonuses(): Promise<number> {
    const now = new Date();
    
    // Find expiring bonuses using persistence
    const expiredBonuses = await userBonusPersistence.findExpiring();

    for (const bonus of expiredBonuses) {
      // Record expiration in ledger FIRST (same as forfeiture)
      try {
      await recordBonusForfeitTransfer(
          bonus.userId,
          bonus.currentValue,
          bonus.currency,
          bonus.tenantId,
          bonus.id,
          'Bonus expired',
          `Bonus expired: ${bonus.type}`
        );
      } catch (ledgerError) {
        logger.error('Failed to record bonus expiration in ledger', { error: ledgerError, bonusId: bonus.id });
        // Continue - don't block expiration
      }

      const historyEntry: BonusHistoryEntry = {
        timestamp: now,
        action: 'expired',
        newStatus: 'expired',
        amount: bonus.currentValue,
        triggeredBy: 'system',
      };

      // Update using persistence layer
      await userBonusPersistence.updateStatus(bonus.id, 'expired', historyEntry, {
        currentValue: 0,
      });

      // Emit for payment gateway + webhooks (unified)
      try {
        await emitBonusEvent('bonus.expired', bonus.tenantId, bonus.userId, {
          bonusId: bonus.id,
          walletId: bonus.walletId, // For payment-gateway to debit the wallet
          forfeitedValue: bonus.currentValue, // Use same field name as forfeited
          currency: bonus.currency,
          type: bonus.type,
          reason: 'Bonus expired',
        });
      } catch (err) {
        logger.warn('Failed to emit bonus.expired', { error: err });
      }
    }

    if (expiredBonuses.length > 0) {
      logger.info(`Expired ${expiredBonuses.length} bonuses`);
    }

    return expiredBonuses.length;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Registry Access
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get all registered bonus types.
   */
  getSupportedTypes(): BonusType[] {
    return handlerRegistry.getRegisteredTypes();
  }

  /**
   * Register a custom handler.
   */
  registerHandler(handler: any): void {
    handlerRegistry.register(handler);
  }

  /**
   * Add a custom validator.
   */
  addValidator(validator: any): void {
    validatorChain.add(validator);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Default Export
// ═══════════════════════════════════════════════════════════════════

export const bonusEngine = new BonusEngine();
export default BonusEngine;

