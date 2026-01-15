/**
 * Payment Service Types
 * 
 * Multi-provider payment processing with transaction management
 * 
 * Integration with Bonus Service:
 * - Uses shared types from core-service
 * - Wallet.bonusBalance syncs with bonus-service
 * - Listens to bonus events via Redis pub/sub
 */

// Import shared types from service-core (single source of truth)
import type { 
  Currency as SharedCurrency,
  Category as SharedCategory,
  VerificationLevel as SharedVerificationLevel,
  TriggeredBy as SharedTriggeredBy,
  StatusHistoryEntry,
  ValueType,
  BalanceType as SharedBalanceType,
} from 'core-service';

// Re-export for consumers
export type Currency = SharedCurrency;

// Use shared types
export type VerificationLevel = SharedVerificationLevel;
export type TriggeredBy = SharedTriggeredBy;
export type BalanceType = SharedBalanceType;

// ═══════════════════════════════════════════════════════════════════
// Provider Types
// ═══════════════════════════════════════════════════════════════════

export type PaymentProvider = 
  | 'stripe'
  | 'paypal'
  | 'adyen'
  | 'worldpay'
  | 'braintree'
  | 'square'
  | 'mollie'
  | 'checkout'
  | 'wise'
  | 'skrill'
  | 'neteller'
  | 'paysafe'
  | 'trustly'
  | 'klarna'
  | 'ideal'
  | 'sofort'
  | 'giropay'
  | 'bancontact'
  | 'pix'
  | 'boleto'
  | 'crypto_btc'
  | 'crypto_eth'
  | 'crypto_usdt'
  | 'bank_transfer'
  | 'manual';

export type PaymentMethod = 
  | 'card'
  | 'bank_transfer'
  | 'e_wallet'
  | 'crypto'
  | 'pix'
  | 'boleto'
  | 'ideal'
  | 'sofort'
  | 'klarna'
  | 'apple_pay'
  | 'google_pay'
  | 'manual';

export type TransactionType = 
  | 'deposit'
  | 'withdrawal'
  | 'refund'
  | 'chargeback'
  | 'fee'
  | 'adjustment'
  | 'transfer'
  | 'payout';

export type TransactionStatus = 
  | 'pending'           // Created, awaiting processing
  | 'processing'        // Being processed by provider
  | 'awaiting_confirmation' // Crypto: waiting for confirmations
  | 'authorized'        // Authorized but not captured
  | 'completed'         // Successfully completed
  | 'failed'            // Failed permanently
  | 'cancelled'         // Cancelled by user or system
  | 'expired'           // Timed out
  | 'refunded'          // Fully refunded
  | 'partially_refunded' // Partially refunded
  | 'disputed'          // Chargeback/dispute opened
  | 'on_hold';          // Held for review

// Currency is imported from core-service (see top of file)

// ═══════════════════════════════════════════════════════════════════
// Core Entities
// ═══════════════════════════════════════════════════════════════════

export interface ProviderConfig {
  id: string;
  tenantId: string;
  provider: PaymentProvider;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  
  // Configuration (encrypted in production)
  credentials: {
    apiKey?: string;
    secretKey?: string;
    merchantId?: string;
    webhookSecret?: string;
    [key: string]: string | undefined;
  };
  
  // Supported features
  supportedMethods: PaymentMethod[];
  supportedCurrencies: Currency[];
  supportedCountries?: string[];
  
  // Limits
  minAmount?: number;
  maxAmount?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  
  // Fees
  feeType: 'fixed' | 'percentage' | 'mixed';
  feeFixed?: number;
  feePercentage?: number;
  
  // Settings
  autoCapture: boolean;
  supportRefund: boolean;
  supportPartialRefund: boolean;
  webhookUrl?: string;
  
  priority: number;  // For routing
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Transaction {
  id: string;
  tenantId: string;
  userId: string;
  
  // Transaction details
  type: TransactionType;
  status: TransactionStatus;
  method: PaymentMethod;
  
  // Amount
  amount: number;
  currency: Currency;
  amountInBaseCurrency?: number;
  baseCurrency?: Currency;
  exchangeRate?: number;
  
  // Fees
  feeAmount: number;
  feeCurrency: Currency;
  netAmount: number;
  
  // Provider
  providerId: string;
  providerName: PaymentProvider;
  providerTransactionId?: string;
  providerResponse?: Record<string, unknown>;
  
  // Payment details
  paymentDetails?: {
    cardLast4?: string;
    cardBrand?: string;
    bankName?: string;
    walletAddress?: string;
    accountNumber?: string;
    [key: string]: unknown;
  };
  
  // References
  orderId?: string;
  referenceId?: string;
  parentTransactionId?: string;  // For refunds
  
  // Metadata
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  
  // Timestamps
  initiatedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  
  // Failure info
  failureCode?: string;
  failureMessage?: string;
  
  // Audit
  statusHistory: TransactionStatusEntry[];
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Transaction status history entry
 * Extends shared StatusHistoryEntry
 */
export interface TransactionStatusEntry extends StatusHistoryEntry<TransactionStatus> {
  providerResponse?: Record<string, unknown>;
}

export interface PaymentSession {
  id: string;
  tenantId: string;
  userId: string;
  transactionId?: string;
  
  // Session details
  type: TransactionType;
  amount: number;
  currency: Currency;
  
  // Provider
  providerId: string;
  providerSessionId?: string;
  
  // Checkout
  checkoutUrl?: string;
  returnUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  
  // Status
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  expiresAt: Date;
  
  // Metadata
  metadata?: Record<string, unknown>;
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Wallet - One per user per currency
 * 
 * Architecture: Multi-Currency Wallets (Industry Standard)
 * - User can have multiple wallets (one per currency)
 * - Each wallet tracks: real balance, bonus balance, locked amounts
 * - Optional category support for ring-fenced funds (regulatory)
 * 
 * Example:
 *   User "john" has:
 *   - USD Wallet: $500 real + $100 bonus
 *   - EUR Wallet: €200 real + €50 bonus
 *   - BTC Wallet: 0.05 BTC real
 */
export interface Wallet {
  id: string;
  tenantId: string;
  userId: string;
  currency: Currency;
  
  /**
   * Optional category for ring-fenced funds (regulatory compliance)
   * Examples: 'main', 'casino', 'sports', 'poker'
   * If null, this is the user's main wallet for this currency
   */
  category?: WalletCategory;
  
  // ═══════════════════════════════════════════════════════════════════
  // Balances (all in smallest unit: cents, satoshi, wei)
  // ═══════════════════════════════════════════════════════════════════
  
  /** Real/withdrawable balance */
  balance: number;
  
  /** Bonus balance (from promotions, cannot be withdrawn directly) */
  bonusBalance: number;
  
  /** 
   * Locked balance (pending withdrawals, open bets, holds)
   * This amount is part of 'balance' but cannot be used
   */
  lockedBalance: number;
  
  /**
   * Available balance = balance - lockedBalance + bonusBalance (for play)
   * Withdrawable = balance - lockedBalance (real money only)
   */
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Service Integration
  // ═══════════════════════════════════════════════════════════════════
  
  /** IDs of active bonuses from bonus-service */
  activeBonusIds?: string[];
  
  /** Total wagering requirement pending (sum of all active bonuses) */
  pendingWageringRequired?: number;
  
  /** Total wagering completed so far */
  totalWageringProgress?: number;
  
  /** Has active bonus that blocks withdrawal */
  hasActiveBonus?: boolean;
  
  // ═══════════════════════════════════════════════════════════════════
  // Limits
  // ═══════════════════════════════════════════════════════════════════
  
  /** Daily withdrawal limit (in wallet currency) */
  dailyWithdrawalLimit?: number;
  /** Amount already withdrawn today */
  dailyWithdrawalUsed: number;
  /** When daily limit resets */
  lastWithdrawalReset: Date;
  
  /** Monthly withdrawal limit */
  monthlyWithdrawalLimit?: number;
  monthlyWithdrawalUsed: number;
  lastMonthlyReset: Date;
  
  /** Minimum balance required (for some regulatory jurisdictions) */
  minimumBalance?: number;
  
  // ═══════════════════════════════════════════════════════════════════
  // Status & Verification
  // ═══════════════════════════════════════════════════════════════════
  
  status: 'active' | 'frozen' | 'closed' | 'pending_verification';
  frozenReason?: string;
  frozenAt?: Date;
  frozenBy?: string;
  
  /** KYC verification level affects limits */
  isVerified: boolean;
  verificationLevel: VerificationLevel;
  
  // ═══════════════════════════════════════════════════════════════════
  // Metadata
  // ═══════════════════════════════════════════════════════════════════
  
  /** Last activity timestamp */
  lastActivityAt: Date;
  
  /** Total lifetime deposits */
  lifetimeDeposits: number;
  /** Total lifetime withdrawals */
  lifetimeWithdrawals: number;
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

/** 
 * Wallet categories for ring-fenced funds
 * 
 * Use cases:
 * 1. Regulatory compliance: Ring-fence funds by product (UK UKGC requirement)
 * 2. Multi-product platforms: Separate balances for different games/products
 * 3. Promotional: Dedicated bonus wallets that can't be mixed with real funds
 * 
 * Example: User can have USD/casino + USD/sports + USD/poker wallets
 */
export type WalletCategory = 
  // Default
  | 'main'              // General purpose wallet (default)
  
  // Gaming verticals
  | 'casino'            // Casino/slots funds
  | 'sports'            // Sports betting funds
  | 'poker'             // Poker funds
  | 'esports'           // Esports betting
  | 'fantasy'           // Daily fantasy sports
  | 'lottery'           // Lottery/numbers games
  | 'bingo'             // Bingo funds
  
  // Promotional
  | 'bonus'             // Dedicated bonus wallet (non-withdrawable until wagered)
  | 'free_bet'          // Free bet credits
  | 'free_spin'         // Free spin credits
  | 'rewards'           // Loyalty/VIP rewards
  | 'cashback'          // Cashback balance
  
  // Financial
  | 'savings'           // Savings/locked funds
  | 'escrow'            // Escrow (for P2P)
  | 'merchant'          // Merchant account balance
  
  // Crypto
  | 'trading'           // Trading wallet (exchange)
  | 'staking'           // Staked/locked crypto
  | 'yield'             // Yield/interest earnings
  
  // Custom (for extensibility)
  | string;

/**
 * Common wallet category configurations
 * Use these to ensure consistency across your platform
 */
export const WALLET_CATEGORIES = {
  // Standard categories (most platforms)
  MAIN: 'main',
  CASINO: 'casino',
  SPORTS: 'sports',
  POKER: 'poker',
  BONUS: 'bonus',
  
  // Extended categories
  ESPORTS: 'esports',
  FANTASY: 'fantasy',
  FREE_BET: 'free_bet',
  CASHBACK: 'cashback',
  REWARDS: 'rewards',
  
  // Financial
  SAVINGS: 'savings',
  TRADING: 'trading',
  STAKING: 'staking',
} as const;

/**
 * Wallet Transaction (OPTIMIZED FOR SCALE)
 * 
 * Optimizations:
 * 1. Removed balanceBefore: Can calculate from (balance - amount) for credits
 *    or (balance + amount) for debits. Saves 8 bytes per transaction.
 * 2. Generic references (refId/refType): Extensible for any entity type
 *    instead of hardcoded bonusId, betId, gameRoundId, etc.
 * 3. Immutable: No updatedAt field, only createdAt (managed by repository)
 * 4. Use MongoDB TTL indexes to auto-archive old transactions
 */
export interface WalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  tenantId: string;

  /** Transaction type */
  type: WalletTransactionType;

  /** Which balance is affected */
  balanceType: 'real' | 'bonus' | 'locked';

  amount: number;         // Amount in cents (always positive)
  currency: Currency;

  /**
   * Wallet balance after this transaction
   * 
   * To calculate balance before transaction:
   * - For credits (deposit): balanceBefore = balance - amount
   * - For debits (withdrawal): balanceBefore = balance + amount
   */
  balance: number;

  // For bonus transactions, track wagering contribution
  wageringContribution?: number;

  /**
   * Generic reference pattern (extensible)
   * Instead of bonusId, betId, gameRoundId, transactionId, etc.
   * Examples:
   * - refType: 'bonus', refId: 'bonus-uuid'
   * - refType: 'bet', refId: 'bet-uuid'
   * - refType: 'game', refId: 'game-round-uuid'
   * - refType: 'transaction', refId: 'payment-tx-uuid'
   * - refType: 'promo', refId: 'promo-uuid'
   */
  refId?: string;
  refType?: string;       // Entity type: 'bonus', 'bet', 'game', 'transaction', 'promo', etc.

  // Metadata
  description?: string;
  category?: string;      // What category of activity
  metadata?: Record<string, unknown>;
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
}

export type WalletTransactionType = 
  | 'deposit'           // Money in from payment
  | 'withdrawal'        // Money out to payment
  | 'bet'               // Debit for placing bet
  | 'win'               // Credit from winning
  | 'refund'            // Bet cancelled/refunded
  | 'bonus_credit'      // Bonus added
  | 'bonus_convert'     // Bonus converted to real (wagering complete)
  | 'bonus_forfeit'     // Bonus removed/expired
  | 'transfer_in'       // Transfer from another wallet
  | 'transfer_out'      // Transfer to another wallet
  | 'adjustment'        // Manual adjustment
  | 'fee'               // Fee deduction
  | 'hold'              // Lock funds
  | 'release';          // Release locked funds

// ═══════════════════════════════════════════════════════════════════
// Wallet Strategy Configuration (Platform-Level)
// ═══════════════════════════════════════════════════════════════════

/**
 * Configure how wallets work on your platform
 * Set this at application startup
 */
export interface WalletStrategyConfig {
  /**
   * Wallet creation mode:
   * - 'single': One wallet per user per currency (simple)
   * - 'multi_category': One wallet per user per currency per category (ring-fenced)
   */
  mode: 'single' | 'multi_category';
  
  /** Default currency for new users */
  defaultCurrency: Currency;
  
  /** If multi_category, which categories are enabled */
  enabledCategories?: WalletCategory[];
  
  /** 
   * Auto-create wallets for these currencies when user registers
   * Example: ['USD', 'EUR'] 
   */
  autoCreateCurrencies?: Currency[];
  
  /**
   * If multi_category, auto-create wallets for these categories
   * Example: ['main', 'casino', 'sports']
   */
  autoCreateCategories?: WalletCategory[];
  
  /**
   * Allow transfers between user's own wallets
   * Example: USD/casino → USD/sports
   */
  allowInternalTransfers: boolean;
  
  /**
   * Allow transfers between different currencies
   * Requires exchange rate provider
   */
  allowCurrencyExchange: boolean;
  
  /**
   * Minimum verification level required for withdrawals
   */
  minWithdrawalVerification: VerificationLevel;
}

/**
 * Example configurations for different platform types
 */
export const WALLET_STRATEGIES = {
  /**
   * Simple e-wallet (PayPal-style)
   * One wallet per currency, no categories
   */
  SIMPLE_EWALLET: {
    mode: 'single',
    defaultCurrency: 'USD',
    autoCreateCurrencies: ['USD'],
    allowInternalTransfers: true,
    allowCurrencyExchange: true,
    minWithdrawalVerification: 'basic',
  } as WalletStrategyConfig,
  
  /**
   * Multi-currency exchange (Binance-style)
   * One wallet per currency for trading
   */
  CRYPTO_EXCHANGE: {
    mode: 'single',
    defaultCurrency: 'USDT',
    autoCreateCurrencies: ['USDT', 'BTC', 'ETH'],
    allowInternalTransfers: true,
    allowCurrencyExchange: true,
    minWithdrawalVerification: 'enhanced',
  } as WalletStrategyConfig,
  
  /**
   * UK-licensed betting (UKGC compliant)
   * Ring-fenced funds by product category
   */
  UK_BETTING_PLATFORM: {
    mode: 'multi_category',
    defaultCurrency: 'GBP',
    autoCreateCurrencies: ['GBP'],
    enabledCategories: ['main', 'casino', 'sports', 'poker', 'bingo'],
    autoCreateCategories: ['main'], // Others created on first use
    allowInternalTransfers: true,
    allowCurrencyExchange: false, // GBP only for UK
    minWithdrawalVerification: 'full', // UKGC requirement
  } as WalletStrategyConfig,
  
  /**
   * International casino
   * Multi-currency with product ring-fencing
   */
  INTERNATIONAL_CASINO: {
    mode: 'multi_category',
    defaultCurrency: 'EUR',
    autoCreateCurrencies: ['EUR', 'USD', 'GBP'],
    enabledCategories: ['main', 'casino', 'sports', 'bonus'],
    autoCreateCategories: ['main'],
    allowInternalTransfers: true,
    allowCurrencyExchange: true,
    minWithdrawalVerification: 'basic',
  } as WalletStrategyConfig,
  
  /**
   * Social/gaming platform
   * Simple with bonus wallet
   */
  GAMING_PLATFORM: {
    mode: 'multi_category',
    defaultCurrency: 'USD',
    autoCreateCurrencies: ['USD'],
    enabledCategories: ['main', 'bonus', 'rewards'],
    autoCreateCategories: ['main', 'rewards'],
    allowInternalTransfers: false, // Can't move bonus to main
    allowCurrencyExchange: false,
    minWithdrawalVerification: 'none',
  } as WalletStrategyConfig,
};

// ═══════════════════════════════════════════════════════════════════
// Wallet Summary & Aggregation (for UI display)
// ═══════════════════════════════════════════════════════════════════

/**
 * Summary of a single wallet's balances
 * Use for displaying wallet info in UI
 */
export interface WalletBalance {
  walletId: string;
  currency: Currency;
  category?: WalletCategory;
  
  /** Real money balance (withdrawable - locked) */
  realBalance: number;
  /** Bonus balance */
  bonusBalance: number;
  /** Locked/held balance */
  lockedBalance: number;
  
  /** Total available for play = realBalance + bonusBalance */
  availableBalance: number;
  /** Total withdrawable = realBalance (locked already subtracted) */
  withdrawableBalance: number;
}

/**
 * Summary of all user's wallets across currencies and categories
 * Use for displaying total portfolio value
 */
export interface UserWalletSummary {
  userId: string;
  tenantId: string;
  
  /** All wallets the user has (flat list) */
  wallets: WalletBalance[];
  
  /** 
   * Wallets grouped by currency
   * Example: { USD: [main, casino, sports], EUR: [main] }
   */
  walletsByCurrency: Record<Currency, WalletBalance[]>;
  
  /**
   * Wallets grouped by category
   * Example: { main: [USD, EUR], casino: [USD] }
   */
  walletsByCategory: Record<WalletCategory, WalletBalance[]>;
  
  /**
   * Total balance per currency (all categories combined)
   * Example: { USD: 1500, EUR: 200 }
   */
  totalByCurrency: Record<Currency, {
    realBalance: number;
    bonusBalance: number;
    lockedBalance: number;
    availableBalance: number;
  }>;
  
  /** 
   * Total value in base currency (for display only)
   * Calculated using current exchange rates
   */
  totalValueInBaseCurrency?: number;
  baseCurrency?: Currency;
  
  /** Primary/default wallet */
  primaryWalletId?: string;
  
  /** Wallet count by category */
  walletCounts: {
    total: number;
    byCurrency: Record<Currency, number>;
    byCategory: Record<WalletCategory, number>;
  };
}

/**
 * Transfer between user's own wallets (same user, different currencies/categories)
 */
export interface WalletTransfer {
  id: string;
  userId: string;
  tenantId: string;
  
  /** Source wallet */
  fromWalletId: string;
  fromCurrency: Currency;
  fromAmount: number;
  
  /** Destination wallet */
  toWalletId: string;
  toCurrency: Currency;
  toAmount: number;
  
  /** Exchange rate used (if cross-currency) */
  exchangeRate?: number;
  exchangeRateSource?: string;
  
  /** Fee charged for transfer */
  feeAmount: number;
  feeCurrency: Currency;
  
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  
  // Timestamps (auto-managed by repository)
  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// API Types
// ═══════════════════════════════════════════════════════════════════

export interface InitiateDepositInput {
  amount: number;
  currency: Currency;
  method?: PaymentMethod;
  providerId?: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiateWithdrawalInput {
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  providerId?: string;
  paymentDetails: {
    bankAccount?: string;
    walletAddress?: string;
    [key: string]: unknown;
  };
}

export interface ProcessRefundInput {
  transactionId: string;
  amount?: number;  // Partial refund
  reason?: string;
}

export interface CreateWalletInput {
  currency: Currency;
  category?: WalletCategory;
}

export interface TransferBetweenWalletsInput {
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  /** If cross-currency, provide exchange rate or let system use current rate */
  exchangeRate?: number;
}

export interface WebhookPayload {
  provider: PaymentProvider;
  eventType: string;
  transactionId?: string;
  providerTransactionId?: string;
  status?: TransactionStatus;
  data: Record<string, unknown>;
  signature?: string;
}

export interface ProviderDriver {
  name: PaymentProvider;
  
  // Core operations
  initiateDeposit(config: ProviderConfig, input: InitiateDepositInput): Promise<{
    sessionId: string;
    checkoutUrl?: string;
    providerTransactionId?: string;
  }>;
  
  capturePayment(config: ProviderConfig, transactionId: string): Promise<{
    success: boolean;
    providerTransactionId: string;
  }>;
  
  initiateWithdrawal(config: ProviderConfig, input: InitiateWithdrawalInput): Promise<{
    providerTransactionId: string;
    status: TransactionStatus;
  }>;
  
  processRefund(config: ProviderConfig, input: ProcessRefundInput): Promise<{
    success: boolean;
    providerRefundId: string;
  }>;
  
  getTransactionStatus(config: ProviderConfig, providerTransactionId: string): Promise<{
    status: TransactionStatus;
    data: Record<string, unknown>;
  }>;
  
  validateWebhook(config: ProviderConfig, payload: WebhookPayload): Promise<boolean>;
}

