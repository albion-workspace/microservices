/**
 * Bonus Service Types
 * 
 * Supports multiple domains: betting, crypto, social, gaming, etc.
 * 
 * Integration with Payment Service:
 * - Uses shared types from core-service
 * - Links to wallets via walletId
 * - Publishes events for bonus credit/convert/forfeit
 */

// Import shared types from service-core (single source of truth)
import type { 
  Currency as SharedCurrency,
  Domain as SharedDomain,
  Category as SharedCategory,
  VerificationLevel,
  TriggeredBy,
  ValueType as SharedValueType,
  StatusHistoryEntry,
} from 'core-service';

// Re-export for consumers
export type Currency = SharedCurrency;

// Use shared Domain type as BonusDomain
export type BonusDomain = SharedDomain;

// ═══════════════════════════════════════════════════════════════════
// Bonus Types
// ═══════════════════════════════════════════════════════════════════

export type BonusType = 
  // Onboarding
  | 'welcome'           // First-time signup bonus
  | 'first_deposit'     // First deposit match bonus
  | 'first_purchase'    // First purchase bonus (ecommerce)
  | 'first_action'      // First action/activity bonus
  
  // Recurring deposits/purchases
  | 'reload'            // Subsequent deposit/purchase bonus
  | 'top_up'            // Balance top-up bonus
  
  // Referrals
  | 'referral'          // Referral program bonus (referrer)
  | 'referee'           // Bonus for referred user
  | 'commission'        // Commission from referral activity
  
  // Activity-based
  | 'activity'          // Activity/turnover bonus (generic wagering)
  | 'milestone'         // Reaching activity milestones
  | 'streak'            // Consecutive activity streak
  
  // Recovery & retention
  | 'cashback'          // Loss/spend recovery bonus
  | 'consolation'       // Next action bonus (after loss/failed transaction)
  | 'winback'           // Re-engagement bonus for inactive users
  
  // Credits
  | 'free_credit'       // Free credit/tokens (games, services, products)
  | 'trial'             // Trial/sample credits
  
  // Loyalty & VIP
  | 'loyalty'           // Loyalty tier bonus
  | 'loyalty_points'    // Loyalty points accumulation
  | 'vip'               // VIP exclusive bonus
  | 'tier_upgrade'      // Bonus for upgrading tier
  
  // Time-based
  | 'birthday'          // Birthday bonus
  | 'anniversary'       // Account anniversary bonus
  | 'seasonal'          // Holiday/event bonus
  | 'daily_login'       // Daily login streak bonus
  | 'flash'             // Limited-time flash bonus
  
  // Achievement
  | 'achievement'       // Achievement unlock bonus
  | 'task_completion'   // Task/mission completion
  | 'challenge'         // Challenge completion bonus
  
  // Competition
  | 'tournament'        // Tournament/competition prize
  | 'leaderboard'       // Leaderboard position bonus
  
  // Selection & combo
  | 'selection'         // User-selected bonus offer
  | 'combo'             // Multi-action/combo bonus
  | 'bundle'            // Bundle purchase bonus
  
  // Promotional
  | 'special_event'     // Special event bonus
  | 'promo_code'        // Promotional code bonus
  
  // Custom
  | 'custom';           // Custom/promotional

// BonusDomain is now imported from service-core as Domain
// See import statement at top of file

/**
 * Status of a user's bonus
 */
export type BonusStatus = 
  | 'pending'           // Created, awaiting activation
  | 'active'            // Currently usable
  | 'in_progress'       // Requirements in progress (e.g., turnover)
  | 'requirements_met'  // Requirements completed, ready to convert
  | 'converted'         // Converted to real balance
  | 'claimed'           // Fully claimed/used
  | 'expired'           // Time limit exceeded
  | 'cancelled'         // Manually cancelled by user/admin
  | 'forfeited'         // Lost due to rule violation
  | 'locked';           // Temporarily locked (e.g., pending review)

/**
 * How the bonus value is calculated
 * Extended from shared ValueType
 */
export type BonusValueType = SharedValueType;

// ═══════════════════════════════════════════════════════════════════
// Core Entities
// ═══════════════════════════════════════════════════════════════════

export interface BonusTemplate {
  id: string;
  name: string;
  code: string;                    // Promo code
  type: BonusType;
  domain: BonusDomain;
  description?: string;
  
  // Value configuration
  valueType: BonusValueType;
  value: number;                   // Amount or percentage
  currency: Currency;              // Currency for fixed amounts (USD, EUR, etc.)
  supportedCurrencies?: Currency[];// If empty, bonus available in all currencies
  maxValue?: number;               // Cap for percentage bonuses
  minDeposit?: number;             // Minimum deposit required
  
  // ═══════════════════════════════════════════════════════════════════
  // Turnover/Activity Requirements
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Turnover multiplier requirement
   * e.g., 30x means user must transact 30x the bonus amount
   * 
   * Examples by domain:
   * - Casino: 30x wagering on games
   * - Ecommerce: 5x purchase amount
   * - Trading: 10x trading volume
   * - SaaS: N/A (usually no turnover requirement)
   */
  turnoverMultiplier: number;
  
  /**
   * Contribution rates for different activity categories
   * Value is the contribution percentage (0-100)
   * 
   * Examples by domain:
   * - Casino: { 'slots': 100, 'table_games': 50, 'live_casino': 10 }
   * - Ecommerce: { 'electronics': 100, 'fashion': 80, 'sale_items': 0 }
   * - Trading: { 'stocks': 100, 'crypto': 50, 'forex': 100 }
   * - Subscription: { 'monthly': 100, 'annual': 150 }
   */
  activityContributions?: Record<string, number>;
  
  // Validity
  validFrom: Date;
  validUntil: Date;
  claimDeadlineDays?: number;      // Days to claim after qualifying
  usageDeadlineDays?: number;      // Days to use after claiming
  
  // Limits
  maxUsesTotal?: number;           // Total redemptions allowed
  maxUsesPerUser?: number;         // Per user limit
  currentUsesTotal: number;
  
  // Eligibility
  eligibleTiers?: string[];        // VIP tiers
  eligibleCountries?: string[];
  excludedCountries?: string[];
  minAccountAgeDays?: number;
  requiresDeposit?: boolean;
  requiresVerification?: boolean;
  
  // Stacking rules
  stackable: boolean;              // Can combine with other bonuses
  excludedBonusTypes?: BonusType[];
  
  // ═══════════════════════════════════════════════════════════════════
  // Selection/Combo requirements (for type: 'combo' | 'bundle' | 'selection')
  // ═══════════════════════════════════════════════════════════════════
  
  /** Minimum number of selections required */
  minSelections?: number;
  
  /** Maximum number of selections allowed */
  maxSelections?: number;
  
  /** Minimum value per selection (e.g., min odds, min price) */
  min?: number;
  
  /** Maximum value per selection (e.g., max odds, max price) */
  max?: number;
  
  /** Minimum combined total value (product for combo, sum for bundle) */
  minTotal?: number;
  
  /** Maximum combined total value (product for combo, sum for bundle) */
  maxTotal?: number;
  
  // ═══════════════════════════════════════════════════════════════════
  // Referral-specific config (for type: 'referral' | 'referee' | 'commission')
  // ═══════════════════════════════════════════════════════════════════
  referralConfig?: ReferralBonusConfig;
  
  // Metadata
  tags?: string[];
  priority: number;                // For selection ordering
  isActive: boolean;
  
  // Approval
  requiresApproval?: boolean;     // Requires admin approval before awarding
  approvalThreshold?: number;     // Minimum value requiring approval (if requiresApproval is true)
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserBonus {
  id: string;
  userId: string;
  tenantId: string;
  templateId: string;
  templateCode: string;
  type: BonusType;
  domain: BonusDomain;
  status: BonusStatus;
  
  // Values (all in the same currency)
  currency: Currency;              // Currency of the bonus
  originalValue: number;           // Initial bonus amount
  currentValue: number;            // Remaining balance
  
  // Turnover/activity requirements
  turnoverRequired: number;        // Total turnover needed (in currency units)
  turnoverProgress: number;        // Current turnover completed
  
  // ═══════════════════════════════════════════════════════════════════
  // Payment Gateway Integration
  // ═══════════════════════════════════════════════════════════════════
  
  /** 
   * Wallet ID in payment-gateway where bonus is credited
   * Used to sync bonus balance with wallet.bonusBalance
   */
  walletId?: string;
  
  /**
   * Wallet category (e.g., 'casino', 'sports')
   * Determines which product wallet receives the bonus
   */
  walletCategory?: string;
  
  /**
   * Payment transaction ID that triggered this bonus
   * For deposit bonuses, links to the qualifying deposit
   */
  triggerTransactionId?: string;
  referrerId?: string;             // For referral bonuses
  refereeId?: string;              // For referee bonuses
  
  // Dates
  qualifiedAt: Date;               // When user qualified
  claimedAt?: Date;                // When claimed
  activatedAt?: Date;              // When started using
  completedAt?: Date;              // When wagering completed
  convertedAt?: Date;              // When converted to real balance
  forfeitedAt?: Date;              // When forfeited
  expiresAt: Date;                 // Expiration date
  
  // Audit trail
  history: BonusHistoryEntry[];
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * History entry for bonus status changes
 * Extends shared StatusHistoryEntry
 */
export interface BonusHistoryEntry extends StatusHistoryEntry<BonusStatus> {
  action: string;
  amount?: number;
  turnoverAmount?: number;
}

export interface BonusTransaction {
  id: string;
  userBonusId: string;
  userId: string;
  tenantId: string;
  
  /**
   * Transaction type:
   * - credit: Bonus credited to user
   * - debit: Bonus used/spent
   * - turnover: Activity counted toward turnover requirement
   * - conversion: Bonus converted to real balance
   * - forfeit: Bonus forfeited
   * - adjustment: Manual adjustment by admin
   */
  type: 'credit' | 'debit' | 'turnover' | 'conversion' | 'forfeit' | 'adjustment';
  
  // Amounts (in bonus currency)
  currency: Currency;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  
  // For cross-currency activity
  originalCurrency?: Currency;     // If activity in different currency
  originalAmount?: number;
  exchangeRate?: number;
  
  // Turnover tracking
  turnoverBefore?: number;
  turnoverAfter?: number;
  turnoverContribution?: number;   // Actual contribution (after % applied)
  
  // Linking
  relatedTransactionId?: string;   // External transaction ID (order, trade, etc.)
  activityCategory?: string;       // Category for contribution calculation
  description?: string;
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Referral Tracking (Integrated into Bonus System)
// ═══════════════════════════════════════════════════════════════════
// 
// Referrals are handled through BonusTemplate (type: 'referral' or 'referee')
// and UserBonus (with referrerId/refereeId fields).
// 
// To create a referral program:
// 1. Create BonusTemplate with type='referral' for referrer rewards
// 2. Create BonusTemplate with type='referee' for referee rewards
// 3. When referee qualifies, award both bonuses with linked IDs
//
// The referral relationship is tracked via:
// - UserBonus.referrerId: who referred this user (for referee bonuses)
// - UserBonus.refereeId: who was referred (for referrer bonuses)
// ═══════════════════════════════════════════════════════════════════

/**
 * Extended BonusTemplate fields for referral-type bonuses
 * Add these to BonusTemplate when type is 'referral' or 'referee'
 */
export interface ReferralBonusConfig {
  /** Minimum deposit by referee to qualify */
  minRefereeDeposit?: number;
  /** Maximum referrals per user (for referrer bonuses) */
  maxReferralsPerUser?: number;
  /** Maximum total reward per user (for referrer bonuses) */
  maxRewardPerUser?: number;
  /** Whether referee must complete deposit to qualify */
  requireRefereeDeposit?: boolean;
  /** Reward type for referrer */
  referralRewardType?: 'one_time' | 'recurring' | 'tiered';
  /** Tiered rewards based on referral count */
  referralTiers?: Array<{
    referralsRequired: number;
    bonusMultiplier: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// API Types
// ═══════════════════════════════════════════════════════════════════

export interface ClaimBonusInput {
  templateId?: string;
  code?: string;
  transactionId?: string;          // Transaction ID that triggered the bonus claim
  depositCurrency?: Currency;       // Currency of the qualifying deposit
  depositAmount?: number;           // Amount in deposit currency
  referralCode?: string;
}

/**
 * Input for recording activity toward bonus turnover requirement
 * Use this when user performs qualifying activity (purchase, trade, play, etc.)
 */
export interface RecordActivityInput {
  userBonusId: string;
  amount: number;                  // Activity amount (purchase, wager, trade volume)
  currency: Currency;              // Currency of the activity
  transactionId: string;           // External transaction ID
  /**
   * Activity category for contribution calculation
   * Examples: 'slots', 'electronics', 'stocks', 'monthly_subscription'
   */
  activityCategory?: string;
}

/**
 * Result of checking user eligibility for bonuses
 * Note: This is different from BonusEligibility class in shared-validators
 */
export interface BonusEligibilityResult {
  eligible: boolean;
  reason?: string;
  availableBonuses: BonusTemplate[];
}

/**
 * Summary of referral relationships for a user
 */
export interface ReferralSummary {
  userId: string;
  referralCode: string;
  totalReferrals: number;
  qualifiedReferrals: number;
  totalEarnings: number;
  currency: Currency;
  referees: Array<{
    refereeId: string;
    status: 'pending' | 'qualified' | 'rewarded';
    bonusId?: string;
    earnedAmount?: number;
    qualifiedAt?: Date;
  }>;
}

