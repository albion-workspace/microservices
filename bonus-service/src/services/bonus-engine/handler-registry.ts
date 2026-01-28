/**
 * Bonus Handler Registry (Registry + Factory Pattern)
 * 
 * Manages registration and creation of bonus handlers.
 * Supports dynamic registration for extensibility.
 * 
 * All 33 bonus types are registered here.
 */

import { logger } from 'core-service';
import type { BonusType } from '../../types.js';
import type { IBonusHandler, HandlerMap } from './types.js';

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

  /**
   * Initialize registry with all handlers.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Onboarding & Deposit handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new WelcomeHandler());
    this.register(new FirstDepositHandler());
    this.register(new FirstPurchaseHandler());
    this.register(new FirstActionHandler());
    this.register(new ReloadHandler());
    this.register(new TopUpHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Referral handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new ReferralHandler());
    this.register(new RefereeHandler());
    this.register(new CommissionHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Activity handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new ActivityHandler());
    this.register(new StreakHandler());
    this.register(new WinbackHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Loyalty & Time-based handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new CashbackHandler());
    this.register(new ConsolationHandler());
    this.register(new LoyaltyHandler());
    this.register(new LoyaltyPointsHandler());
    this.register(new VipHandler());
    this.register(new TierUpgradeHandler());
    this.register(new BirthdayHandler());
    this.register(new AnniversaryHandler());
    this.register(new SeasonalHandler());
    this.register(new DailyLoginHandler());
    this.register(new FlashHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Achievement handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new AchievementHandler());
    this.register(new MilestoneHandler());
    this.register(new TaskCompletionHandler());
    this.register(new ChallengeHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Competition handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new TournamentHandler());
    this.register(new LeaderboardHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Promotional handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new PromoCodeHandler());
    this.register(new SpecialEventHandler());
    this.register(new CustomHandler());

    // ═══════════════════════════════════════════════════════════════════
    // Credit & Bundle handlers
    // ═══════════════════════════════════════════════════════════════════
    this.register(new FreeCreditHandler());
    this.register(new TrialHandler());
    this.register(new SelectionHandler());
    this.register(new ComboHandler());
    this.register(new BundleHandler());

    this.initialized = true;
    logger.info('Bonus handler registry initialized', {
      handlers: Array.from(this.handlers.keys()),
      count: this.handlers.size,
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
 */
export function getHandler(type: BonusType): IBonusHandler | undefined {
  handlerRegistry.initialize();
  return handlerRegistry.getHandler(type);
}

/**
 * Factory function to create/get a handler instance.
 * Uses registry pattern - eliminates need for large switch statement.
 * 
 * Note: Handlers are singletons from the registry. If you need a fresh instance,
 * you can extend the registry to support cloning, but typically singleton is sufficient.
 */
export function createHandler(type: BonusType): IBonusHandler | null {
  handlerRegistry.initialize();
  const handler = handlerRegistry.getHandler(type);
  
  if (!handler) {
    logger.warn('No handler available for bonus type', { type });
    return null;
  }
  
  // Return handler from registry (singleton pattern)
  // If fresh instances are needed in the future, implement cloning here
  return handler;
}
