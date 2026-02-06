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
  DefaultServiceConfig,
} from 'core-service';

// Re-export for consumers
export type Currency = SharedCurrency;

// Use shared types
export type VerificationLevel = SharedVerificationLevel;
export type TriggeredBy = SharedTriggeredBy;
export type BalanceType = SharedBalanceType;

// ═══════════════════════════════════════════════════════════════════
// Service Configuration (single config type, aligned with service generator)
// ═══════════════════════════════════════════════════════════════════

/** Payment service config: extends DefaultServiceConfig, adds only payment-specific properties. */
export interface PaymentConfig extends DefaultServiceConfig {
  exchangeRateDefaultSource: string;
  exchangeRateCacheTtl: number;
  exchangeRateAutoUpdateInterval: number;
  transactionMinAmount: number;
  transactionMaxAmount: number;
  allowNegativeBalance: boolean;
  defaultCurrency: string;
  supportedCurrencies: string[];
  transferRequireApproval: boolean;
  maxPendingTransfers: number;
  approvalTimeout: number;
}

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

/**
 * Transaction - Ultra-minimal schema (based on Mongoose pattern)
 * 
 * Each transaction represents a single credit or debit for one user.
 * Transfers create 2 transactions (debit + credit).
 */
export interface Transaction {
  id: string;
  tenantId: string;
  
  // User reference (required)
  userId: string;                  // Reference to auth.users._id (ObjectId)
  
  // Amounts (MINIMAL)
  amount: number;                   // Transaction amount (cents) - ALWAYS POSITIVE
  balance: number;                 // Wallet balance AFTER this transaction (cents)
  
  // Polymorphic reference (replaces refId/refType pattern)
  objectId?: string;                // Reference to bonus, bet, game, transfer, etc. (ObjectId)
  objectModel?: string;             // Model type: 'bonus', 'bet', 'game', 'transfer', 'deposit', 'withdrawal', etc.
  
  // Transaction type
  charge: 'credit' | 'debit';      // Credit (money in) or Debit (money out)
  
  // Metadata (flexible - GENERIC only, no payment-specific fields)
  meta?: {
    // Fee details
    feeAmount?: number;             // Fee amount (cents)
    netAmount?: number;             // Net amount after fee (calculate: amount - feeAmount)
    
    // Currency (if different from wallet currency)
    currency?: string;               // Currency code
    exchangeRate?: number;           // Exchange rate used
    
    // Wallet context
    walletId?: string;              // Wallet ID (for fast lookups)
    balanceType?: 'real' | 'bonus' | 'locked';  // Which balance affected
    
    // External reference (for idempotency)
    externalRef?: string;            // External reference (for idempotency)
    
    // Any other generic data
    description?: string;
    [key: string]: unknown;
  };
  
  // Timestamps (immutable - only createdAt)
  createdAt: Date;                 // Auto-managed by repository
  // NO updatedAt - transactions are immutable
}

/**
 * Transfer - User-to-user transfer record
 * 
 * Creates 2 transactions (debit for fromUser, credit for toUser).
 */
export interface Transfer {
  id: string;
  tenantId: string;
  
  // User references (required)
  fromUserId: string;              // Source user (ObjectId reference)
  toUserId: string;                 // Destination user (ObjectId reference)
  
  // Amount
  amount: number;                  // Transfer amount (cents) - ALWAYS POSITIVE
  
  // Status
  status: 'pending' | 'active' | 'approved' | 'canceled' | 'used' | 'expired';
  
  // Transaction type
  charge: 'credit' | 'debit';      // Usually 'credit' for transfers
  
  // Metadata (flexible - generic for any payment method)
  meta?: {
    // External reference (for idempotency)
    externalRef?: string;           // External reference (for idempotency)
    externalTransactionId?: string;
    
    // Payment method (determines which fields below are used)
    method?: string;                // Payment method: 'card', 'bank', 'crypto', 'mobile_money', etc.
    
    // Payment details (flexible - depends on payment method)
    // For cards:
    cardLast4?: string;             // Last 4 digits of card
    cardBrand?: string;              // Card brand: 'visa', 'mastercard', etc.
    
    // For bank transfers:
    bankName?: string;               // Bank name
    accountNumber?: string;          // Bank account number
    bankAccount?: string;           // Alias for accountNumber
    
    // For crypto:
    walletAddress?: string;          // Crypto wallet address
    blockchain?: string;             // Blockchain: 'bitcoin', 'ethereum', etc.
    
    // For mobile money:
    phoneNumber?: string;           // Mobile money phone number
    provider?: string;               // Mobile money provider: 'mpesa', 'mtn', etc.
    
    // Fee details
    feeAmount?: number;             // Fee amount (cents)
    netAmount?: number;             // Net amount after fee
    
    // Currency
    currency?: string;               // Currency code
    exchangeRate?: number;           // Exchange rate used
    
    // Transaction references (created by this transfer)
    fromTransactionId?: string;     // Debit transaction ID
    toTransactionId?: string;       // Credit transaction ID
    
    // Wallet context
    fromWalletId?: string;
    toWalletId?: string;
    balanceType?: 'real' | 'bonus' | 'locked';
    
    // Any other data
    description?: string;
    [key: string]: unknown;  // Flexible for any payment method-specific fields
  };
  
  // Timestamps
  createdAt: Date;                 // Auto-managed
  updatedAt?: Date;                 // Updated on status changes
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
  // Wallet Permissions
  // ═══════════════════════════════════════════════════════════════════
  
  /** Allow wallet to go negative balance (wallet-level permission) */
  allowNegative?: boolean;
  
  /** Credit limit for negative balances (in smallest unit: cents, satoshi, wei) */
  creditLimit?: number;
  
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
  /** Total lifetime fees paid (for reconciliation and reporting) */
  lifetimeFees: number;
  
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

// WalletTransaction removed - replaced by Transaction with objectModel pattern

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
  /** Allow wallet to go negative balance (wallet-level permission) */
  allowNegative?: boolean;
  /** Credit limit for negative balances (in smallest unit: cents, satoshi, wei) */
  creditLimit?: number;
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

