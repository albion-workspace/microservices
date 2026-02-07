/**
 * Abstract Base Handler (Template Method Pattern)
 * 
 * Defines the skeleton algorithm for bonus processing.
 * Subclasses override specific steps.
 * 
 * Uses persistence layer for data access, which can be backed by:
 * - Direct MongoDB queries (for reads)
 * - Saga services (for transactional writes)
 */

import { logger, resolveDatabase, type DatabaseResolutionOptions, type Collection, type Db } from 'core-service';
import type { BonusTemplate, UserBonus, BonusType, BonusHistoryEntry } from '../../types.js';
import type {
  BonusContext,
  EligibilityResult,
  BonusCalculation,
  AwardResult,
  IBonusHandler,
} from './types.js';
import { createBonusPersistence, type BonusPersistenceOptions } from './persistence.js';
import { emitBonusEvent } from '../../event-dispatcher.js';
// Event-driven architecture: bonus service emits events, payment service handles wallet operations
// Note: bonus-approval imports are lazy to avoid circular dependency

export interface BaseHandlerOptions extends DatabaseResolutionOptions {
  // Can extend with handler-specific options if needed
}

export abstract class BaseBonusHandler implements IBonusHandler {
  abstract readonly type: BonusType;
  protected persistence: ReturnType<typeof createBonusPersistence>;
  
  constructor(protected options?: BaseHandlerOptions) {
    // Create persistence with database strategy if provided
    this.persistence = createBonusPersistence(options || {});
  }
  
  // Helper to get user bonuses collection
  protected async getUserBonusesCollection(tenantId?: string): Promise<Collection> {
    if (!this.options?.databaseStrategy && !this.options?.database) {
      throw new Error('BaseBonusHandler requires database or databaseStrategy in options. Ensure handler is initialized via handlerRegistry.initialize() with database strategy.');
    }
    const db = await resolveDatabase(this.options, 'bonus-service', tenantId);
    return db.collection('user_bonuses');
  }

  // ═══════════════════════════════════════════════════════════════════
  // Template Method - Main Algorithm
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Process a bonus request.
   * This is the template method that defines the algorithm skeleton.
   */
  async process(context: BonusContext): Promise<AwardResult> {
    // Step 1: Check eligibility
    const eligibility = await this.checkEligibility(context);
    if (!eligibility.eligible || !eligibility.template) {
      return {
        success: false,
        error: eligibility.reason || 'Not eligible',
      };
    }

    // Step 2: Calculate bonus
    const calculation = this.calculate(eligibility.template, context);
    if (calculation.bonusValue <= 0) {
      return {
        success: false,
        error: 'Calculated bonus value is zero or negative',
      };
    }

    // Step 3: Award bonus
    return this.award(eligibility.template, context);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Eligibility Checking (Hook methods for customization)
  // ═══════════════════════════════════════════════════════════════════

  async checkEligibility(context: BonusContext): Promise<EligibilityResult> {
    // Find active template for this bonus type using persistence layer
    const templates = await this.persistence.template.findByType(this.type, context.tenantId);
    const template = templates[0] || null;

    if (!template) {
      return { eligible: false, reason: 'No active bonus template found' };
    }

    // Run common validators
    const commonResult = await this.runCommonValidators(template, context);
    if (!commonResult.eligible) {
      return commonResult;
    }

    // Run type-specific validators (hook method)
    const specificResult = await this.validateSpecific(template, context);
    if (!specificResult.eligible) {
      return specificResult;
    }

    return { eligible: true, template };
  }

  /**
   * Common validators that apply to all bonus types.
   * Uses persistence layer for data access.
   */
  protected async runCommonValidators(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Check currency support
    if (context.currency && template.supportedCurrencies?.length) {
      if (!template.supportedCurrencies.includes(context.currency as any)) {
        return { eligible: false, reason: `Currency ${context.currency} not supported` };
      }
    }

    // Check minimum deposit
    if (template.minDeposit && context.depositAmount) {
      if (context.depositAmount < template.minDeposit) {
        return {
          eligible: false,
          reason: `Minimum deposit of ${template.minDeposit} required`,
        };
      }
    }

    // Check max uses per user using persistence layer
    if (template.maxUsesPerUser) {
      const userCount = await this.persistence.userBonus.countByTemplate(
        context.userId, 
        template.id
      );
      if (userCount >= template.maxUsesPerUser) {
        return { eligible: false, reason: 'Maximum bonus claims reached' };
      }
    }

    // Check total uses
    if (template.maxUsesTotal && template.currentUsesTotal >= template.maxUsesTotal) {
      return { eligible: false, reason: 'Bonus no longer available' };
    }

    return { eligible: true, template };
  }

  /**
   * Hook method for type-specific validation.
   * Override in subclasses for custom eligibility rules.
   */
  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    return { eligible: true, template };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Bonus Calculation (Hook methods for customization)
  // ═══════════════════════════════════════════════════════════════════

  calculate(template: BonusTemplate, context: BonusContext): BonusCalculation {
    // Calculate base value
    const bonusValue = this.calculateValue(template, context);

    // Calculate turnover requirement
    const turnoverRequired = this.calculateTurnover(template, bonusValue, context);

    // Calculate expiration
    const expiresAt = this.calculateExpiration(template, context);

    return { bonusValue, turnoverRequired, expiresAt };
  }

  /** Strategy map for value calculation by valueType; cap by maxValue applied in calculateValue. */
  private static readonly valueCalculators: Record<string, (template: BonusTemplate, baseAmount: number) => number> = {
    percentage: (t, base) => Math.floor(base * (t.value / 100)),
    fixed: (t) => t.value,
    multiplier: (t, base) => Math.floor(base * t.value),
    credit: (t) => t.value,
    points: (t) => t.value,
  };

  /**
   * Calculate the bonus value.
   * Can be overridden for special calculations.
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const baseAmount = context.depositAmount || context.lossAmount || 0;
    const raw = BaseBonusHandler.valueCalculators[template.valueType]?.(template, baseAmount) ?? template.value;
    return template.maxValue != null && raw > template.maxValue ? template.maxValue : raw;
  }

  /**
   * Calculate turnover requirement.
   * Can be overridden for special multipliers.
   */
  protected calculateTurnover(
    template: BonusTemplate,
    bonusValue: number,
    context: BonusContext
  ): number {
    return bonusValue * template.turnoverMultiplier;
  }

  /**
   * Calculate expiration date.
   * Can be overridden for special expiration rules.
   */
  protected calculateExpiration(template: BonusTemplate, context: BonusContext): Date {
    const expiresAt = new Date();
    const expirationDays = (template as any).expirationDays || 30;
    expiresAt.setDate(expiresAt.getDate() + expirationDays);
    return expiresAt;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Bonus Awarding
  // ═══════════════════════════════════════════════════════════════════

  async award(template: BonusTemplate, context: BonusContext, skipApprovalCheck = false): Promise<AwardResult> {
    const calculation = this.calculate(template, context);

    if (calculation.bonusValue <= 0) {
      logger.warn('Bonus value is zero or negative', {
        userId: context.userId,
        templateId: template.id,
      });
      return { success: false, error: 'Bonus value is zero or negative' };
    }

    // Lazy import to avoid circular dependency
    if (!skipApprovalCheck) {
      const { requiresApproval, createPendingBonus } = await import('../bonus-approval.js');
      if (requiresApproval(template, calculation.bonusValue)) {
        const token = await createPendingBonus(
          template,
          context,
          calculation,
          (context as any).requestedBy,
          (context as any).reason
        );

        logger.info('Bonus requires approval, created pending request', {
          userId: context.userId,
          templateCode: template.code,
          value: calculation.bonusValue,
          token,
        });

        return {
          success: false,
          error: 'Bonus requires approval',
          pendingToken: token,
        };
      }
    }

    const now = new Date();
    const userBonusData = this.buildUserBonus(template, context, calculation, now);

    const createdBonus = await this.persistence.userBonus.create(userBonusData, context.tenantId);

    await this.emitAwardedEvent(createdBonus, calculation);

    await this.persistence.template.incrementUsage(template.id, context.tenantId);

    await this.onAwarded(createdBonus, context);

    logger.info('Bonus awarded', {
      userId: context.userId,
      bonusId: createdBonus.id,
      type: template.type,
      value: calculation.bonusValue,
    });

    return { success: true, bonus: createdBonus };
  }

  /**
   * Build the UserBonus object.
   * Can be overridden to add type-specific fields.
   */
  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    // MongoDB will automatically create _id, which will be normalized to id when reading
    return {
      userId: context.userId,
      tenantId: context.tenantId,
      templateId: template.id,
      templateCode: template.code,
      type: template.type,
      domain: template.domain,
      status: 'active',
      currency: template.currency,
      originalValue: calculation.bonusValue,
      currentValue: calculation.bonusValue,
      turnoverRequired: calculation.turnoverRequired,
      turnoverProgress: 0,
      walletId: context.walletId,
      triggerTransactionId: context.transactionId,
      referrerId: context.referrerId,
      qualifiedAt: now,
      claimedAt: now,
      activatedAt: now,
      expiresAt: calculation.expiresAt,
      history: [{
        timestamp: now,
        action: 'awarded',
        newStatus: 'active',
        amount: calculation.bonusValue,
        triggeredBy: 'system',
      }],
    };
  }

  /**
   * Emit bonus.awarded event via unified dispatcher.
   * 
   * This sends to BOTH:
   * - Internal: Payment-gateway listens to credit the wallet's bonusBalance
   * - External: Third-party webhooks subscribed to bonus.awarded
   */
  protected async emitAwardedEvent(
    bonus: UserBonus,
    calculation: BonusCalculation
  ): Promise<void> {
    try {
      const { eventId, webhookCount } = await emitBonusEvent('bonus.awarded', bonus.tenantId, bonus.userId, {
        bonusId: bonus.id,
        type: bonus.type,
        value: calculation.bonusValue,
        currency: bonus.currency,
        walletId: bonus.walletId, // For payment-gateway to credit the right wallet
        turnoverRequired: calculation.turnoverRequired,
        expiresAt: calculation.expiresAt.toISOString(),
      });
      logger.debug('Emitted bonus.awarded', { eventId, webhookCount });
    } catch (err) {
      logger.warn('Failed to emit bonus.awarded event', { error: err });
    }
  }

  /**
   * Hook method called after bonus is awarded.
   * Override for type-specific post-award logic.
   */
  protected async onAwarded(bonus: UserBonus, context: BonusContext): Promise<void> {
    // Override in subclasses
  }

  // ═══════════════════════════════════════════════════════════════════
  // Event Handling (Optional)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle events specific to this bonus type.
   * Override in subclasses that need event handling.
   */
  async handleEvent?(eventType: string, data: unknown): Promise<void>;
}

