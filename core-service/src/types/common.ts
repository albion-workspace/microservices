/**
 * Common Types - Shared across all microservices
 * 
 * These types are used by both bonus-service and payment-gateway
 */

// ═══════════════════════════════════════════════════════════════════
// Base Entity Fields
// ═══════════════════════════════════════════════════════════════════

/**
 * Common fields for all entities
 */
export interface BaseEntity {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entity with user association
 */
export interface UserEntity extends BaseEntity {
  userId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Verification Level
// ═══════════════════════════════════════════════════════════════════

/**
 * KYC/Verification levels - used across services
 * - none: No verification
 * - basic: Email/phone verified
 * - enhanced: ID document verified
 * - full: Full KYC (address proof, source of funds)
 */
export type VerificationLevel = 'none' | 'basic' | 'enhanced' | 'full';

// ═══════════════════════════════════════════════════════════════════
// Triggered By
// ═══════════════════════════════════════════════════════════════════

/**
 * Who/what triggered an action
 */
export type TriggeredBy = 
  | 'user'              // User action
  | 'system'            // Automated/scheduled
  | 'admin'             // Admin action
  | 'provider'          // External provider (payment, etc.)
  | 'api'               // API call
  | 'webhook';          // Webhook callback

// ═══════════════════════════════════════════════════════════════════
// Status Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Basic status values common across services
 */
export type BasicStatus = 
  | 'pending'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed';

/**
 * Extended status for transactions/operations
 */
export type OperationStatus = BasicStatus
  | 'processing'
  | 'in_progress'
  | 'on_hold'
  | 'locked'
  | 'frozen';

// ═══════════════════════════════════════════════════════════════════
// History/Audit Entry
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic status history entry for audit trails
 */
export interface StatusHistoryEntry<TStatus = string> {
  timestamp: Date;
  previousStatus?: TStatus;
  newStatus: TStatus;
  reason?: string;
  triggeredBy: TriggeredBy;
  details?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Domain / Industry
// ═══════════════════════════════════════════════════════════════════

/**
 * Domain/industry categories - shared between services
 * Used for: BonusDomain, WalletCategory, etc.
 */
export type Domain = 
  // Gaming & Entertainment
  | 'casino'            // Casino/slots
  | 'sports'            // Sports betting
  | 'esports'           // Esports betting
  | 'poker'             // Poker
  | 'lottery'           // Lottery/numbers
  | 'fantasy'           // Daily fantasy sports
  | 'bingo'             // Bingo
  | 'gaming'            // Video games/mobile games
  
  // Financial
  | 'crypto'            // Cryptocurrency/exchange
  | 'trading'           // Stock/forex trading
  | 'fintech'           // Banking/payments
  | 'lending'           // Lending/credit
  
  // Commerce
  | 'ecommerce'         // Online retail
  | 'marketplace'       // Multi-vendor marketplace
  | 'subscription'      // Subscription services
  | 'saas'              // Software as a service
  
  // Social & Content
  | 'social'            // Social platforms
  | 'content'           // Content/media platforms
  | 'creator'           // Creator economy
  
  // Other
  | 'travel'            // Travel/hospitality
  | 'food'              // Food delivery/restaurants
  | 'ride'              // Ride-sharing
  | 'universal'         // Applies to all
  | 'main';             // Default/main

/**
 * Domain configuration
 */
export interface DomainConfig {
  code: Domain;
  name: string;
  description?: string;
  /** Default turnover multiplier for this domain */
  defaultTurnoverMultiplier?: number;
  /** Whether this domain typically requires ring-fenced funds */
  requiresRingFencing?: boolean;
  /** Parent domain (for hierarchies) */
  parentDomain?: Domain;
}

// ═══════════════════════════════════════════════════════════════════
// Category (for ring-fencing, grouping)
// ═══════════════════════════════════════════════════════════════════

/**
 * Categories for ring-fenced funds/bonuses
 * Can be used for WalletCategory, BonusCategory, etc.
 */
export type Category = 
  // Domains (from Domain type)
  | Domain
  // Promotional categories
  | 'bonus'             // Bonus/promotional
  | 'free_credit'       // Free credits
  | 'rewards'           // Loyalty rewards
  | 'cashback'          // Cashback
  // Financial categories
  | 'savings'           // Savings
  | 'escrow'            // Escrow
  | 'staking'           // Staking (crypto)
  | 'yield';            // Yield/interest

/**
 * Standard category configurations
 */
export const CATEGORIES = {
  // Standard (most platforms)
  MAIN: 'main',
  CASINO: 'casino',
  SPORTS: 'sports',
  POKER: 'poker',
  BONUS: 'bonus',
  
  // Gaming
  ESPORTS: 'esports',
  FANTASY: 'fantasy',
  LOTTERY: 'lottery',
  BINGO: 'bingo',
  
  // Promotional
  FREE_CREDIT: 'free_credit',
  REWARDS: 'rewards',
  CASHBACK: 'cashback',
  
  // Financial
  TRADING: 'trading',
  CRYPTO: 'crypto',
  SAVINGS: 'savings',
  STAKING: 'staking',
} as const;

// ═══════════════════════════════════════════════════════════════════
// Value/Amount Types
// ═══════════════════════════════════════════════════════════════════

/**
 * How a value is calculated
 */
export type ValueType = 
  | 'fixed'             // Fixed amount
  | 'percentage'        // Percentage of base amount
  | 'multiplier'        // Multiplier on base
  | 'credit'            // Free credits/tokens
  | 'points'            // Loyalty points
  | 'item';             // Physical/digital item

// ═══════════════════════════════════════════════════════════════════
// Balance Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Types of balance in a wallet
 */
export type BalanceType = 
  | 'real'              // Real/withdrawable balance
  | 'bonus'             // Bonus balance (non-withdrawable)
  | 'locked'            // Locked/held balance
  | 'pending';          // Pending balance (awaiting confirmation)

// ═══════════════════════════════════════════════════════════════════
// Transaction Direction
// ═══════════════════════════════════════════════════════════════════

/**
 * Direction of a transaction
 */
export type TransactionDirection = 'credit' | 'debit';

// ═══════════════════════════════════════════════════════════════════
// Time Period
// ═══════════════════════════════════════════════════════════════════

/**
 * Common time periods for limits, reports, etc.
 */
export type TimePeriod = 
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'lifetime'
  | 'custom';

/**
 * Time period configuration
 */
export interface TimePeriodConfig {
  period: TimePeriod;
  customDays?: number;  // For 'custom' period
  resetHour?: number;   // Hour of day to reset (0-23)
  resetDayOfWeek?: number; // Day of week to reset (0-6, 0=Sunday)
  resetDayOfMonth?: number; // Day of month to reset (1-31)
}

// ═══════════════════════════════════════════════════════════════════
// Limits
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic limit configuration
 */
export interface LimitConfig {
  /** Maximum amount allowed */
  maxAmount?: number;
  /** Minimum amount required */
  minAmount?: number;
  /** Period for the limit */
  period?: TimePeriod;
  /** Amount used in current period */
  used?: number;
  /** When the limit resets */
  resetAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard page info for pagination
 */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
  totalCount?: number;
}

/**
 * Generic paginated connection
 */
export interface Connection<T> {
  nodes: T[];
  edges: Array<{ node: T; cursor: string }>;
  pageInfo: PageInfo;
  totalCount: number;
}

