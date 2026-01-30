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
 * │  - getInitializedPersistence() → persistence.template           │
 * │  - getInitializedPersistence() → persistence.userBonus          │
 * │  - getInitializedPersistence() → persistence.transaction        │
 * │  (Uses centralized database strategy from persistence-singleton)│
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
 * import { createBonusEngine } from './services/bonus-engine';
 * 
 * // Create engine with database strategy
 * const engine = createBonusEngine({
 *   databaseStrategy: myStrategy,
 *   defaultContext: { service: 'bonus-service' }
 * });
 * 
 * // Check eligibility
 * const result = await engine.checkEligibility('first_deposit', {
 *   userId: 'user-123',
 *   tenantId: 'tenant-1',
 *   depositAmount: 100,
 *   currency: 'USD',
 * });
 * 
 * // Award bonus (uses persistence layer internally)
 * const award = await engine.award('first_deposit', context);
 * 
 * // Handle deposit event (event-driven auto-awarding)
 * const bonuses = await engine.handleDeposit(depositEvent);
 * ```
 */

// Core
export { BonusEngine, createBonusEngine, type BonusEngineOptions } from './engine.js';
export { BaseBonusHandler } from './base-handler.js';

// Persistence Layer
export { 
  createBonusPersistence,
  createTemplatePersistence,
  createUserBonusPersistence,
  createTransactionPersistence,
  type BonusPersistenceOptions,
} from './persistence.js';

// Persistence Singleton (use this in services)
export { getInitializedPersistence, initializeDatabaseLayer } from './persistence-singleton.js';

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
  PurchaseEvent,
  ActionEvent,
  ActivityEvent,
  WithdrawalEvent,
} from './types.js';

// Registry & Factory
export { 
  handlerRegistry, 
  getHandler, 
  createHandler,
} from './handler-registry.js';

// Validators (server-only, client-safe validators are in shared-validators)
export { 
  createValidatorChain,
  ValidatorChain,
  // Server-only validators (require DB access)
  MaxUsesPerUserValidator,
  CooldownValidator,
  AlreadyClaimedValidator,
  StackingValidator,
  ReferralValidator,
} from './validators.js';

// Re-export BonusEligibility for convenience
export { BonusEligibility } from 'shared-validators';

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

