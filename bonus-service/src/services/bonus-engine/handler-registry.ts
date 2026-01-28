/**
 * Bonus Handler Registry (Registry + Factory Pattern)
 * 
 * Manages registration and creation of bonus handlers.
 * Supports dynamic registration for extensibility.
 * 
 * All 33 bonus types are registered here.
 */

import { logger, type DatabaseResolutionOptions } from 'core-service';
import type { BonusType } from '../../types.js';
import type { IBonusHandler, HandlerMap } from './types.js';
import type { BaseHandlerOptions } from './base-handler.js';

// Import all handlers
import { 
  FirstDepositHandler, 
  ReloadHandler, 
  WelcomeHandler,
  FirstPurchaseHandler,
  FirstActionHandler,
  TopUpHandler,
} from './handlers/deposit-handler.js';

import { 
  DailyLoginHandler, 
  BirthdayHandler, 
  CashbackHandler, 
  TierUpgradeHandler,
  LoyaltyPointsHandler,
  LoyaltyHandler,
  VipHandler,
  AnniversaryHandler,
  SeasonalHandler,
  FlashHandler,
} from './handlers/loyalty-handler.js';

import { 
  ReferralHandler, 
  RefereeHandler, 
  CommissionHandler,
} from './handlers/referral-handler.js';

import {
  AchievementHandler,
  MilestoneHandler,
  SpecialEventHandler,
  PromoCodeHandler,
  ConsolationHandler,
  TaskCompletionHandler,
  ChallengeHandler,
} from './handlers/achievement-handler.js';

import {
  ActivityHandler,
  StreakHandler,
  WinbackHandler,
} from './handlers/activity-handler.js';

import {
  TournamentHandler,
  LeaderboardHandler,
  CustomHandler,
} from './handlers/competition-handler.js';

import {
  FreeCreditHandler,
  TrialHandler,
  SelectionHandler,
  ComboHandler,
  BundleHandler,
} from './handlers/promotional-handler.js';

// ═══════════════════════════════════════════════════════════════════
// Handler Registry
// ═══════════════════════════════════════════════════════════════════

class BonusHandlerRegistry {
  private handlers: HandlerMap = new Map();
  private initialized = false;
  private handlerOptions: BaseHandlerOptions | undefined;

  /**
   * Initialize registry with all handlers.
   * @param options - Database strategy options to pass to all handlers
   */
  initialize(options?: BaseHandlerOptions): void {
    if (this.initialized && !options) {
      return;
    }

    // Store options for handler creation
    this.handlerOptions = options;

    // Clear existing handlers if reinitializing with new options
    if (this.initialized && options) {
      this.handlers.clear();
      this.initialized = false;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Onboarding & Deposit handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new WelcomeHandler(options));
    this.register(new FirstDepositHandler(options));
    this.register(new FirstPurchaseHandler(options));
    this.register(new FirstActionHandler(options));
    this.register(new ReloadHandler(options));
    this.register(new TopUpHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Referral handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new ReferralHandler(options));
    this.register(new RefereeHandler(options));
    this.register(new CommissionHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Activity handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new ActivityHandler(options));
    this.register(new StreakHandler(options));
    this.register(new WinbackHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Loyalty & Time-based handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new CashbackHandler(options));
    this.register(new ConsolationHandler(options));
    this.register(new LoyaltyHandler(options));
    this.register(new LoyaltyPointsHandler(options));
    this.register(new VipHandler(options));
    this.register(new TierUpgradeHandler(options));
    this.register(new BirthdayHandler(options));
    this.register(new AnniversaryHandler(options));
    this.register(new SeasonalHandler(options));
    this.register(new DailyLoginHandler(options));
    this.register(new FlashHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Achievement handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new AchievementHandler(options));
    this.register(new MilestoneHandler(options));
    this.register(new TaskCompletionHandler(options));
    this.register(new ChallengeHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Competition handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new TournamentHandler(options));
    this.register(new LeaderboardHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Promotional handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new PromoCodeHandler(options));
    this.register(new SpecialEventHandler(options));
    this.register(new CustomHandler(options));

    // ═══════════════════════════════════════════════════════════════════
    // Credit & Bundle handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new FreeCreditHandler(options));
    this.register(new TrialHandler(options));
    this.register(new SelectionHandler(options));
    this.register(new ComboHandler(options));
    this.register(new BundleHandler(options));

    this.initialized = true;
    logger.info('Bonus handler registry initialized', {
      handlers: Array.from(this.handlers.keys()),
      count: this.handlers.size,
      hasDatabaseStrategy: !!options?.databaseStrategy,
    });
  }

  /**
   * Register a new handler.
   * Can be used to add custom handlers at runtime.
   */
  register(handler: IBonusHandler): void {
    if (this.handlers.has(handler.type)) {
      logger.warn('Overwriting existing handler', { type: handler.type });
    }
    this.handlers.set(handler.type, handler);
    logger.debug('Handler registered', { type: handler.type });
  }

  /**
   * Unregister a handler.
   */
  unregister(type: BonusType): boolean {
    return this.handlers.delete(type);
  }

  /**
   * Get handler for a specific bonus type.
   */
  getHandler(type: BonusType): IBonusHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Check if handler exists for a type.
   */
  hasHandler(type: BonusType): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get all registered handler types.
   */
  getRegisteredTypes(): BonusType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get all handlers.
   */
  getAllHandlers(): IBonusHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get handlers by category.
   */
  getHandlersByCategory(category: string): IBonusHandler[] {
    const categories: Record<string, BonusType[]> = {
      onboarding: ['welcome', 'first_deposit', 'first_purchase', 'first_action'],
      recurring: ['reload', 'top_up'],
      referral: ['referral', 'referee', 'commission'],
      activity: ['activity', 'milestone', 'streak'],
      recovery: ['cashback', 'consolation', 'winback'],
      credits: ['free_credit', 'trial'],
      loyalty: ['loyalty', 'loyalty_points', 'vip', 'tier_upgrade'],
      time_based: ['birthday', 'anniversary', 'seasonal', 'daily_login', 'flash'],
      achievement: ['achievement', 'task_completion', 'challenge'],
      competition: ['tournament', 'leaderboard'],
      selection: ['selection', 'combo', 'bundle'],
      promotional: ['promo_code', 'special_event', 'custom'],
    };

    const types = categories[category] || [];
    return types
      .map(type => this.handlers.get(type))
      .filter((h): h is IBonusHandler => h !== undefined);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Singleton Export
// ═══════════════════════════════════════════════════════════════════

export const handlerRegistry = new BonusHandlerRegistry();

// ═══════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════

/**
 * Factory function to create/get a handler for a bonus type.
 * Ensures registry is initialized.
 * @param options - Optional database strategy options (only used on first initialization)
 */
export function getHandler(type: BonusType, options?: BaseHandlerOptions): IBonusHandler | undefined {
  handlerRegistry.initialize(options);
  return handlerRegistry.getHandler(type);
}

/**
 * Factory function to create/get a handler instance.
 * Uses registry pattern - eliminates need for large switch statement.
 * 
 * Note: Handlers are singletons from the registry. If you need a fresh instance,
 * you can extend the registry to support cloning, but typically singleton is sufficient.
 * @param options - Optional database strategy options (only used on first initialization)
 */
export function createHandler(type: BonusType, options?: BaseHandlerOptions): IBonusHandler | null {
  handlerRegistry.initialize(options);
  const handler = handlerRegistry.getHandler(type);
  
  if (!handler) {
    logger.warn('No handler available for bonus type', { type });
    return null;
  }
  
  // Return handler from registry (singleton pattern)
  // If fresh instances are needed in the future, implement cloning here
  return handler;
}
