/**
 * Wallet Types and Utilities
 * 
 * Provides type-safe wallet access patterns to eliminate `as any` casts.
 * Includes:
 * - Wallet interface definition
 * - Type-safe accessor functions
 * - Balance validation utilities
 * - Database resolution helpers
 */

import type { Db, MongoClient, ClientSession, Collection, Document } from 'mongodb';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';

// ═══════════════════════════════════════════════════════════════════
// Collection Names (Single source of truth)
// ═══════════════════════════════════════════════════════════════════

export const COLLECTION_NAMES = {
  WALLETS: 'wallets',
  TRANSFERS: 'transfers',
  TRANSACTIONS: 'transactions',
} as const;

export type CollectionName = typeof COLLECTION_NAMES[keyof typeof COLLECTION_NAMES];

// ═══════════════════════════════════════════════════════════════════
// Transaction Options (Single source of truth)
// ═══════════════════════════════════════════════════════════════════

/**
 * Default transaction options for MongoDB transactions
 * Ensures consistency across all transactional operations
 */
export const DEFAULT_TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
  writeConcern: { w: 'majority' as const },
  readPreference: 'primary' as const,
};

// ═══════════════════════════════════════════════════════════════════
// Collection Getters (Centralized collection access)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the wallets collection from a database
 */
export function getWalletsCollection<T extends Document = Document>(db: Db): Collection<T> {
  return db.collection<T>(COLLECTION_NAMES.WALLETS);
}

/**
 * Get the transfers collection from a database
 */
export function getTransfersCollection<T extends Document = Document>(db: Db): Collection<T> {
  return db.collection<T>(COLLECTION_NAMES.TRANSFERS);
}

/**
 * Get the transactions collection from a database
 */
export function getTransactionsCollection<T extends Document = Document>(db: Db): Collection<T> {
  return db.collection<T>(COLLECTION_NAMES.TRANSACTIONS);
}

// ═══════════════════════════════════════════════════════════════════
// Wallet Type Definition
// ═══════════════════════════════════════════════════════════════════

/**
 * Wallet document structure
 * Used for type-safe access to wallet properties
 */
export interface Wallet {
  _id?: unknown;
  id: string;
  userId: string;
  tenantId: string;
  currency: string;
  category: string;
  balance: number;
  bonusBalance: number;
  lockedBalance: number;
  status: 'active' | 'suspended' | 'closed';
  isVerified: boolean;
  verificationLevel: string;
  allowNegative: boolean;
  creditLimit?: number;
  lifetimeDeposits: number;
  lifetimeWithdrawals: number;
  lifetimeFees: number;
  dailyWithdrawalUsed: number;
  monthlyWithdrawalUsed: number;
  lastWithdrawalReset: Date;
  lastMonthlyReset: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Balance type for wallet operations
 */
export type BalanceType = 'real' | 'bonus' | 'locked';

// ═══════════════════════════════════════════════════════════════════
// Type-Safe Wallet Accessors
// ═══════════════════════════════════════════════════════════════════

/**
 * Get wallet ID safely
 */
export function getWalletId(wallet: Wallet | unknown): string {
  if (!wallet || typeof wallet !== 'object') return '';
  const w = wallet as Record<string, unknown>;
  return (w.id as string) || (w._id?.toString?.() ?? '');
}

/**
 * Get wallet balance for a specific balance type
 */
export function getWalletBalance(wallet: Wallet | unknown, balanceType: BalanceType = 'real'): number {
  if (!wallet || typeof wallet !== 'object') return 0;
  const w = wallet as Record<string, unknown>;
  
  switch (balanceType) {
    case 'bonus':
      return (w.bonusBalance as number) || 0;
    case 'locked':
      return (w.lockedBalance as number) || 0;
    default:
      return (w.balance as number) || 0;
  }
}

/**
 * Check if wallet allows negative balance
 */
export function getWalletAllowNegative(wallet: Wallet | unknown): boolean {
  if (!wallet || typeof wallet !== 'object') return false;
  return (wallet as Record<string, unknown>).allowNegative === true;
}

/**
 * Get wallet credit limit (returns undefined if not set)
 */
export function getWalletCreditLimit(wallet: Wallet | unknown): number | undefined {
  if (!wallet || typeof wallet !== 'object') return undefined;
  const limit = (wallet as Record<string, unknown>).creditLimit;
  return typeof limit === 'number' ? limit : undefined;
}

/**
 * Get wallet user ID
 */
export function getWalletUserId(wallet: Wallet | unknown): string {
  if (!wallet || typeof wallet !== 'object') return '';
  return ((wallet as Record<string, unknown>).userId as string) || '';
}

/**
 * Get wallet tenant ID
 */
export function getWalletTenantId(wallet: Wallet | unknown): string {
  if (!wallet || typeof wallet !== 'object') return '';
  return ((wallet as Record<string, unknown>).tenantId as string) || '';
}

/**
 * Get wallet currency
 */
export function getWalletCurrency(wallet: Wallet | unknown): string {
  if (!wallet || typeof wallet !== 'object') return '';
  return ((wallet as Record<string, unknown>).currency as string) || '';
}

// ═══════════════════════════════════════════════════════════════════
// Balance Validation
// ═══════════════════════════════════════════════════════════════════

export interface BalanceValidationOptions {
  wallet: Wallet | unknown;
  amount: number;
  balanceType?: BalanceType;
  isSystemUser?: boolean;
}

export interface BalanceValidationResult {
  valid: boolean;
  error?: string;
  currentBalance: number;
  newBalance: number;
}

/**
 * Validate balance for a debit operation
 * 
 * Checks:
 * 1. Sufficient balance (unless allowNegative)
 * 2. Credit limit (if allowNegative and creditLimit set)
 * 
 * @returns Validation result with error message if invalid
 */
export function validateBalanceForDebit(options: BalanceValidationOptions): BalanceValidationResult {
  const { wallet, amount, balanceType = 'real', isSystemUser = false } = options;
  
  const currentBalance = getWalletBalance(wallet, balanceType);
  const newBalance = currentBalance - amount;
  const allowNegative = getWalletAllowNegative(wallet);
  const creditLimit = getWalletCreditLimit(wallet);
  
  // Check if user can go negative
  const canGoNegative = isSystemUser && allowNegative;
  
  // Check sufficient balance
  if (!canGoNegative && currentBalance < amount) {
    return {
      valid: false,
      error: `Insufficient balance. Required: ${amount}, Available: ${currentBalance}. Wallet does not allow negative balance.`,
      currentBalance,
      newBalance,
    };
  }
  
  // Check credit limit if applicable
  if (canGoNegative && creditLimit != null && newBalance < -creditLimit) {
    return {
      valid: false,
      error: `Would exceed credit limit. New balance: ${newBalance}, Credit limit: -${creditLimit}`,
      currentBalance,
      newBalance,
    };
  }
  
  return {
    valid: true,
    currentBalance,
    newBalance,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Database Resolution Helper
// ═══════════════════════════════════════════════════════════════════

export interface DatabaseOptions {
  database?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
  context?: DatabaseContext;
  client?: MongoClient;
}

export interface ResolvedDatabase {
  db: Db;
  client: MongoClient;
}

/**
 * Resolve database and client from various option formats
 * 
 * Supports:
 * - Direct database instance
 * - Database strategy with context
 * - Direct client (requires database)
 * 
 * @throws Error if required options are missing
 */
export async function resolveDatabaseConnection(
  options: DatabaseOptions,
  operationName: string = 'operation'
): Promise<ResolvedDatabase> {
  if (options.database) {
    return {
      db: options.database,
      client: options.client || options.database.client,
    };
  }
  
  if (options.databaseStrategy && options.context) {
    const db = await options.databaseStrategy.resolve(options.context);
    return {
      db,
      client: db.client,
    };
  }
  
  throw new Error(`${operationName} requires either database or databaseStrategy with context`);
}

// ═══════════════════════════════════════════════════════════════════
// Transaction Wrapper
// ═══════════════════════════════════════════════════════════════════

export interface TransactionOptions {
  session?: ClientSession;
  client: MongoClient;
}

/**
 * Execute operation with transaction management
 * 
 * If session is provided, uses it directly (caller manages transaction).
 * Otherwise, creates and manages session internally.
 * 
 * @param options - Transaction options with optional session and required client
 * @param fn - Function to execute within the transaction
 * @returns Result of the function
 */
export async function withTransaction<T>(
  options: TransactionOptions,
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  // If session provided, use it directly (caller manages transaction)
  if (options.session) {
    return fn(options.session);
  }
  
  // Otherwise, create and manage session internally
  const session = options.client.startSession();
  try {
    return await session.withTransaction(
      () => fn(session),
      DEFAULT_TRANSACTION_OPTIONS
    );
  } finally {
    await session.endSession();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Wallet Update Builders
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the MongoDB field name for a balance type
 */
export function getBalanceFieldName(balanceType: BalanceType): string {
  switch (balanceType) {
    case 'bonus':
      return 'bonusBalance';
    case 'locked':
      return 'lockedBalance';
    default:
      return 'balance';
  }
}

export interface WalletUpdateOptions {
  balanceField: string;
  amount: number;
  charge: 'credit' | 'debit';
  balanceType: BalanceType;
  feeAmount?: number;
}

/**
 * Build MongoDB update document for wallet balance change
 */
export function buildWalletUpdate(options: WalletUpdateOptions): Record<string, unknown> {
  const { balanceField, amount, charge, balanceType, feeAmount = 0 } = options;
  const netAmount = amount - feeAmount;
  
  const update: Record<string, unknown> = {
    $inc: {
      [balanceField]: charge === 'credit' ? netAmount : -amount,
    },
    $set: {
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    },
  };
  
  const $inc = update.$inc as Record<string, number>;
  
  // Update lifetime stats for real balance operations
  if (balanceType === 'real') {
    if (charge === 'credit') {
      $inc.lifetimeDeposits = amount;
      if (feeAmount > 0) {
        $inc.lifetimeFees = feeAmount;
      }
    } else {
      $inc.lifetimeWithdrawals = amount;
      if (feeAmount > 0) {
        $inc.lifetimeFees = feeAmount;
      }
    }
  }
  
  return update;
}
