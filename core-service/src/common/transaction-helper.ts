/**
 * Generic Transaction Helper - Transaction Creation Utilities
 * 
 * This module provides:
 * 1. Generic transaction creation utilities (for single transactions, not transfers)
 * 2. Wallet helpers (shared across services)
 * 
 * Use cases:
 * - Single transactions: purchases, refunds, adjustments (not transfers)
 * - Wallet operations: get or create wallets atomically
 * 
 * For transfers (user-to-user), use `transfer-helper.ts` instead.
 * For transaction state management, use `transaction-state.ts`.
 */

// External packages
import type { ClientSession, Db, MongoClient } from 'mongodb';

// Local imports
import { logger } from './logger.js';
import { generateId, generateMongoId } from '../index.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';
import {
  type Wallet,
  type BalanceType,
  getWalletId,
  getWalletBalance,
  getWalletAllowNegative,
  getWalletCreditLimit,
  validateBalanceForDebit,
  resolveDatabaseConnection,
  getBalanceFieldName,
  buildWalletActivityUpdate,
  withTransaction,
  getWalletsCollection,
  getTransactionsCollection,
  DEFAULT_TRANSACTION_OPTIONS,
} from './wallet-types.js';

// Re-export transaction state types from transaction-state.ts
export type { TransactionState } from './transaction-state.js';
export { getTransactionStateManager, TransactionStateManager } from './transaction-state.js';

// ═══════════════════════════════════════════════════════════════════
// Wallet Helpers (Re-exported from transfer-helper for consistency)
// ═══════════════════════════════════════════════════════════════════

// Import wallet helpers from transfer-helper (for internal use)
import { getOrCreateWallet as getOrCreateWalletHelper } from './transfer-helper.js';

// Re-export wallet helpers from transfer-helper (for external use)
export { createNewWallet, getOrCreateWallet, startSession, endSession } from './transfer-helper.js';

// ═══════════════════════════════════════════════════════════════════
// Transaction Types
// ═══════════════════════════════════════════════════════════════════

export interface Transaction {
  id: string;
  tenantId: string;
  userId: string;
  amount: number;
  balance: number;  // Balance after this transaction
  objectId?: string;  // Polymorphic reference (bonusId, betId, etc.)
  objectModel?: string;  // 'bonus', 'bet', 'game', 'purchase', etc.
  charge: 'debit' | 'credit';
  meta: Record<string, unknown>;
  createdAt: Date;
  externalRef?: string;
  status?: string;
}

export interface CreateTransactionParams {
  userId: string;
  amount: number;
  currency: string;
  tenantId?: string;
  charge: 'debit' | 'credit';
  balanceType?: 'real' | 'bonus' | 'locked';  // Default: 'real'
  objectId?: string;      // Optional: reference to bonus, bet, game, etc.
  objectModel?: string;   // Optional: 'bonus', 'bet', 'game', 'purchase', etc.
  externalRef?: string;   // For idempotency
  description?: string;
  feeAmount?: number;
  status?: string;        // Optional: transaction status (e.g., 'processing', 'completed')
  // Additional metadata
  [key: string]: unknown;
}

export interface CreateTransactionResult {
  transaction: Transaction;
  wallet: any;  // Updated wallet
}


// ═══════════════════════════════════════════════════════════════════
// Transaction Document Creation (Shared Helper)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a transaction document (without wallet update)
 * 
 * This is a low-level helper used by both createTransaction and createTransferWithTransactions.
 * It only creates the transaction document - wallet updates are handled by the caller.
 * 
 * @param params - Transaction parameters
 * @param wallet - Wallet document (must already be fetched/created)
 * @param currentBalance - Current balance for the transaction
 * @returns Transaction document ready to be inserted
 */
export function createTransactionDocument(
  params: CreateTransactionParams,
  wallet: any,
  currentBalance: number
): Transaction {
  const {
    userId,
    amount,
    currency,
    tenantId: tenantIdParam,
    charge,
    balanceType: balanceTypeParam,
    objectId,
    objectModel,
    externalRef,
    description,
    feeAmount: feeAmountParam,
    status: statusParam,
    ...rest
  } = params;
  
  const tenantId = tenantIdParam || 'default';
  const balanceType = balanceTypeParam || 'real';
  const feeAmount = feeAmountParam || 0;
  const netAmount = amount - feeAmount;
  
  // Calculate balance after transaction
  const balanceAfter = charge === 'credit' 
    ? currentBalance + netAmount  // Credit increases balance
    : currentBalance - amount;     // Debit decreases balance
  
  // Create transaction document
  const transactionId = generateId();
  const transaction: Transaction = {
    id: transactionId,
    tenantId,
    userId,
    amount: charge === 'credit' ? netAmount : amount,  // Credit uses netAmount, debit uses gross amount
    balance: balanceAfter,
    objectId,
    objectModel,
    charge,
    meta: {
      ...rest,
      feeAmount,
      netAmount: charge === 'credit' ? netAmount : undefined,
      currency,
      externalRef,
      description: description || (charge === 'credit' ? 'Credit' : 'Debit'), // Always set description, never null/undefined
      walletId: getWalletId(wallet),
      balanceType,
    },
    createdAt: new Date(),
    externalRef,
  };
  
  // Add status if provided (for approval workflows)
  if (statusParam) {
    transaction.status = statusParam;
  }
  
  return transaction;
}

// ═══════════════════════════════════════════════════════════════════
// Generic Transaction Creation (Single Transaction)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a single transaction and update wallet atomically
 * 
 * Use this for operations that are NOT transfers (purchases, refunds, adjustments, etc.)
 * For transfers (user-to-user), use `createTransferWithTransactions` from `transfer-helper.ts`
 * 
 * @param params - Transaction parameters
 * @param session - Optional MongoDB session. If provided, operation runs within that session.
 *                  If not provided, a new session is created and managed internally.
 * @returns Created transaction and updated wallet
 * 
 * @example
 * ```typescript
 * // Standalone usage (manages session internally)
 * const result = await createTransaction(params);
 * 
 * // With external session (for multi-operation transactions)
 * const session = startSession();
 * try {
 *   await session.withTransaction(async () => {
 *     await createOrder(...);
 *     await createTransaction(params, session);
 *     await createTransferWithTransactions(...);
 *   });
 * } finally {
 *   await endSession(session);
 * }
 * ```
 */
export async function createTransaction(
  params: CreateTransactionParams,
  options?: {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    context?: DatabaseContext;
    session?: ClientSession;
  }
): Promise<CreateTransactionResult> {
  const { db, client } = await resolveDatabaseConnection(options || {}, 'createTransaction');
  
  const transactionsCollection = getTransactionsCollection(db);
  const session = options?.session;
  
  const {
    userId,
    amount,
    currency,
    tenantId: tenantIdParam,
    charge,
    balanceType: balanceTypeParam,
    objectId,
    objectModel,
    externalRef,
    description,
    feeAmount: feeAmountParam,
    ...rest
  } = params;
  
  const tenantId = tenantIdParam || 'default';
  const balanceType = balanceTypeParam || 'real';
  const feeAmount = feeAmountParam || 0;
  const netAmount = amount - feeAmount;
  
  // Get balance field based on balance type
  const balanceField = getBalanceFieldName(balanceType);
  
  // Core transaction logic (reusable with or without external session)
  const executeTransaction = async (txSession: ClientSession): Promise<CreateTransactionResult> => {
      // Get or create wallet (within transaction)
      const wallet = await getOrCreateWalletHelper(userId, currency, tenantId, {
        database: db,
        session: txSession,
      });
      
      // Get current balance using wallet utility
      const currentBalance = getWalletBalance(wallet, balanceType);
      
      // Validate balance before debiting using shared helper
      if (charge === 'debit') {
        const validation = validateBalanceForDebit({
          wallet,
          amount,
          balanceType,
          isSystemUser: getWalletAllowNegative(wallet), // If allowNegative is set, treat as system user
        });
        
        if (!validation.valid) {
          throw new Error(validation.error);
        }
      }
      
      // Create transaction document using shared helper
      const transaction = createTransactionDocument(params, wallet, currentBalance);
      
      // Insert transaction (within transaction)
      await transactionsCollection.insertOne(transaction, { session: txSession });
      
      // Update wallet atomically (within transaction)
      const walletsCollection = getWalletsCollection(db);
      const update: Record<string, any> = {
        $inc: { [balanceField]: charge === 'credit' ? netAmount : -amount },
        ...buildWalletActivityUpdate()
      };
      
      // Update lifetime stats for real balance credits
      if (charge === 'credit' && balanceType === 'real') {
        update.$inc!.lifetimeDeposits = amount;
        if (feeAmount > 0) {
          update.$inc!.lifetimeFees = feeAmount;
        }
      }
      
      // Update lifetime stats for real balance debits
      if (charge === 'debit' && balanceType === 'real') {
        update.$inc!.lifetimeWithdrawals = amount;
        if (feeAmount > 0) {
          update.$inc!.lifetimeFees = feeAmount;
        }
      }
      
      await walletsCollection.updateOne(
        { userId, currency, tenantId },
        update,
        { session: txSession }
      );
      
      return { transaction, wallet };
    };
  
  // If session provided, use it directly (caller manages transaction)
  if (session) {
    return await executeTransaction(session);
  }
  
  // Otherwise, create and manage session internally
  const internalSession = client.startSession();
  try {
    return await internalSession.withTransaction(async () => {
      return await executeTransaction(internalSession);
    }, DEFAULT_TRANSACTION_OPTIONS);
  } catch (error) {
    logger.error('Failed to create transaction', {
      error,
      userId,
      amount,
      currency,
      charge,
    });
    throw error;
  } finally {
    await internalSession.endSession();
  }
}

/**
 * Create multiple transactions atomically
 * Useful for complex operations that need multiple transactions in one atomic operation
 * 
 * @param transactions - Array of transaction parameters
 * @returns Created transactions and updated wallets
 */
/**
 * Create multiple transactions atomically
 * 
 * @param transactions - Array of transaction parameters
 * @param session - Optional MongoDB session. If provided, operation runs within that session.
 *                  If not provided, a new session is created and managed internally.
 * @returns Array of created transactions and updated wallets
 */
export async function createTransactions(
  transactions: CreateTransactionParams[],
  options?: {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    context?: DatabaseContext;
    session?: ClientSession;
  }
): Promise<CreateTransactionResult[]> {
  const { db, client } = await resolveDatabaseConnection(options || {}, 'createTransactions');
  
  const transactionsCollection = getTransactionsCollection(db);
  const session = options?.session;
  
  // Core transaction logic (reusable with or without external session)
  const executeTransactions = async (txSession: ClientSession): Promise<CreateTransactionResult[]> => {
      const results: CreateTransactionResult[] = [];
      const walletUpdates = new Map<string, { wallet: any; updates: Record<string, any> }>();
      
      // First pass: get/create wallets and prepare transactions
      for (const params of transactions) {
        const {
          userId,
          amount,
          currency,
          tenantId: tenantIdParam,
          charge,
          balanceType: balanceTypeParam,
          objectId,
          objectModel,
          externalRef,
          description,
          feeAmount: feeAmountParam,
          ...rest
        } = params;
        
        const tenantId = tenantIdParam || 'default';
        const balanceType = balanceTypeParam || 'real';
        const feeAmount = feeAmountParam || 0;
        const netAmount = amount - feeAmount;
        const balanceField = getBalanceFieldName(balanceType);
        
        // Get or create wallet
        const wallet = await getOrCreateWalletHelper(userId, currency, tenantId, {
          database: db,
          session: txSession,
        });
        
        // Track wallet updates
        const walletKey = `${userId}:${currency}:${tenantId}`;
        if (!walletUpdates.has(walletKey)) {
          walletUpdates.set(walletKey, { wallet, updates: buildWalletActivityUpdate() });
        }
        
        const walletData = walletUpdates.get(walletKey)!;
        const currentBalance = getWalletBalance(walletData.wallet, balanceType);
        
        // Create transaction document using shared helper
        const transaction = createTransactionDocument(params, walletData.wallet, currentBalance);
        
        // Prepare wallet update
        if (!walletData.updates.$inc) {
          walletData.updates.$inc = {};
        }
        
        walletData.updates.$inc[balanceField] = charge === 'credit' ? netAmount : -amount;
        
        // Update lifetime stats
        if (charge === 'credit' && balanceType === 'real') {
          walletData.updates.$inc.lifetimeDeposits = (walletData.updates.$inc.lifetimeDeposits || 0) + amount;
          if (feeAmount > 0) {
            walletData.updates.$inc.lifetimeFees = (walletData.updates.$inc.lifetimeFees || 0) + feeAmount;
          }
        }
        
        if (charge === 'debit' && balanceType === 'real') {
          walletData.updates.$inc.lifetimeWithdrawals = (walletData.updates.$inc.lifetimeWithdrawals || 0) + amount;
          if (feeAmount > 0) {
            walletData.updates.$inc.lifetimeFees = (walletData.updates.$inc.lifetimeFees || 0) + feeAmount;
          }
        }
        
        results.push({ transaction, wallet: walletData.wallet });
      }
      
      // Insert all transactions
      if (results.length > 0) {
        await transactionsCollection.insertMany(
          results.map(r => r.transaction),
          { session: txSession }
        );
      }
      
      // Update all wallets
      const walletsCollection = getWalletsCollection(db);
      for (const [walletKey, { wallet, updates }] of walletUpdates) {
        await walletsCollection.updateOne(
          { userId: wallet.userId, currency: wallet.currency, tenantId: wallet.tenantId },
          updates,
          { session: txSession }
        );
      }
      
      return results;
    };
  
  // If session provided, use it directly (caller manages transaction)
  if (session) {
    return await executeTransactions(session);
  }
  
  // Otherwise, create and manage session internally
  const internalSession = client.startSession();
  try {
    return await internalSession.withTransaction(async () => {
      return await executeTransactions(internalSession);
    }, DEFAULT_TRANSACTION_OPTIONS);
  } catch (error) {
    logger.error('Failed to create transactions', {
      error,
      transactionCount: transactions.length,
    });
    throw error;
  } finally {
    await internalSession.endSession();
  }
}
