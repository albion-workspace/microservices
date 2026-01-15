/**
 * Bonus Engine Module
 * 
 * This module provides the business logic layer for bonus management,
 * separate from the data persistence layer (saga services in bonus.ts).
 * 
 * ARCHITECTURE:
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                       GraphQL API                               │
 * │  Mutations → Saga Services (bonus.ts)                          │
 * │  Queries → Direct Repository access                            │
 * └────────────────────────────┬────────────────────────────────────┘
 *                              │
 * ┌────────────────────────────┴────────────────────────────────────┐
 * │                 Bonus Engine (Business Logic)                   │
 * │  Uses: Strategy, Template Method, Factory, Chain of Resp.       │
 * │  For: Eligibility, Calculation, Event-driven auto-awarding      │
 * └────────────────────────────┬────────────────────────────────────┘
 *                              │
 * ┌────────────────────────────┴────────────────────────────────────┐
 * │                  Persistence Layer                              │
 * │  - templatePersistence (read templates)                         │
 * │  - userBonusPersistence (read/write user bonuses, referrals)    │
 * │  - transactionPersistence (record transactions)                 │
 * └────────────────────────────┬────────────────────────────────────┘
 *                              │
 * ┌────────────────────────────┴────────────────────────────────────┐
 * │                Saga Services (Transactional CRUD)               │
 * │  - bonusTemplateService (createService pattern)                 │
 * │  - userBonusService (createService pattern)                     │
 * │  - bonusTransactionService (createService pattern)              │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * REFERRAL TRACKING:
 * 
 * Referrals are handled as bonuses with type 'referral' or 'referee':
 * - Create BonusTemplate with type='referral' for referrer rewards
 * - Create BonusTemplate with type='referee' for referee rewards
 * - UserBonus.refereeId tracks who was referred (for referrer)
 * - UserBonus.referrerId tracks who referred (for referee)
 * 
 * Design Patterns Used:
 * 
 * 1. Strategy Pattern - Different handlers for different bonus types
 * 2. Template Method - Base handler defines algorithm skeleton
 * 3. Factory Pattern - Handler creation and retrieval
 * 4. Registry Pattern - Dynamic handler registration
 * 5. Chain of Responsibility - Validator chain for eligibility
 * 6. Facade Pattern - BonusEngine provides clean API
 * 
 * WHEN TO USE WHAT:
 * 
 * - Saga Services (bonus.ts): For API mutations that need transactions
 *   e.g., createUserBonus, createBonusTransaction
 * 
 * - Bonus Engine: For business logic that spans multiple operations
 *   e.g., check eligibility, calculate value, auto-award on events
 * 
 * - Persistence Layer: For simple reads and writes without saga
 *   e.g., find templates, update turnover progress
 * 
 * Usage:
 * 
 * ```typescript
 * import { bonusEngine } from './services/bonus-engine';
 * 
 * // Check eligibility
 * const result = await bonusEngine.checkEligibility('first_deposit', {
 *   userId: 'user-123',
 *   tenantId: 'tenant-1',
 *   depositAmount: 100,
 *   currency: 'USD',
 * });
 * 
 * // Award bonus (uses persistence layer internally)
 * const award = await bonusEngine.award('first_deposit', context);
 * 
 * // Handle deposit event (event-driven auto-awarding)
 * const bonuses = await bonusEngine.handleDeposit(depositEvent);
 * 
 * // Register custom handler
 * bonusEngine.registerHandler(new MyCustomHandler());
 * 
 * // Add custom validator
 * bonusEngine.addValidator(new MyCustomValidator());
 * ```
 */

// Core
export { BonusEngine, bonusEngine } from './engine.js';
export { BaseBonusHandler } from './base-handler.js';

// Persistence Layer
export { 
  persistence,
  templatePersistence, 
  userBonusPersistence, 
  transactionPersistence,
} from './persistence.js';

// Types
export type {
  BonusContext,
  EligibilityResult,
  ValidatorResult,
  BonusCalculation,
  AwardResult,
  IBonusHandler,
  IEligibilityValidator,
  IBonusCalculator,
  DepositEvent,
  ActivityEvent,
  WithdrawalEvent,
} from './types.js';

// Registry & Factory
export { 
  handlerRegistry, 
  getHandler, 
  createHandler,
} from './handler-registry.js';

// Validators (server-only, client-safe validators are in bonus-shared)
export { 
  validatorChain,
  ValidatorChain,
  // Server-only validators (require DB access)
  MaxUsesPerUserValidator,
  CooldownValidator,
  AlreadyClaimedValidator,
  StackingValidator,
  ReferralValidator,
} from './validators.js';

// Re-export BonusEligibility for convenience
export { BonusEligibility } from 'bonus-shared';

// Handlers (for extension/customization)
export { 
  FirstDepositHandler, 
  ReloadHandler, 
  WelcomeHandler,
  FirstPurchaseHandler,
  FirstActionHandler,
  TopUpHandler,
} from './handlers/deposit-handler.js';

export { 
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

export { 
  ReferralHandler, 
  RefereeHandler, 
  CommissionHandler,
} from './handlers/referral-handler.js';

export {
  AchievementHandler,
  MilestoneHandler,
  SpecialEventHandler,
  PromoCodeHandler,
  ConsolationHandler,
  TaskCompletionHandler,
  ChallengeHandler,
} from './handlers/achievement-handler.js';

export {
  ActivityHandler,
  StreakHandler,
  WinbackHandler,
} from './handlers/activity-handler.js';

export {
  TournamentHandler,
  LeaderboardHandler,
  CustomHandler,
} from './handlers/competition-handler.js';

export {
  FreeCreditHandler,
  TrialHandler,
  SelectionHandler,
  ComboHandler,
  BundleHandler,
} from './handlers/promotional-handler.js';

