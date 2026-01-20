/**
 * Shared Transfer Helper - Creates transfer + 2 transactions + updates wallets
 * 
 * Generic utility for creating atomic transfers across all services.
 * Uses MongoDB transactions for atomicity.
 * 
 * Architecture: Wallets + Transactions + Transfers (simplified from old ledger system)
 * - Wallets = Single source of truth for balances
 * - Transactions = Individual credit/debit records (the ledger)
 * - Transfers = User-to-user transfer records (creates 2 transactions)
 * 
 * Usage Pattern:
 * ```typescript
 * // Option 1: Standalone (manages session internally)
 * const result = await createTransferWithTransactions(params);
 * 
 * // Option 2: With external session (for multi-operation transactions)
 * const session = startSession();
 * try {
 *   await session.withTransaction(async () => {
 *     await createOrder(...);
 *     await createTransferWithTransactions(params, session);
 *     await createTransaction(...);
 *   });
 * } finally {
 *   await endSession(session);
 * }
 * ```
 */

import { getDatabase, getClient, generateId, generateMongoId, logger, deleteCachePattern } from '../index.js';
import type { ClientSession } from 'mongodb';
import { createTransactionDocument, type CreateTransactionParams, type Transaction } from './transaction-helper.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface Transfer {
  id: string;
  tenantId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  status: 'pending' | 'active' | 'approved' | 'canceled' | 'failed';
  charge: 'credit' | 'debit';
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

// Re-export Transaction type from transaction-helper for consistency
export type { Transaction } from './transaction-helper.js';

export interface CreateTransferParams {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  tenantId?: string;
  feeAmount?: number;
  method?: string;
  externalRef?: string;
  description?: string;
  // Approval mode: 'direct' = immediate approval (default), 'pending' = requires approval
  approvalMode?: 'direct' | 'pending';
  // Balance type support (for bonus operations)
  fromBalanceType?: 'real' | 'bonus' | 'locked';  // Default: 'real'
  toBalanceType?: 'real' | 'bonus' | 'locked';    // Default: 'real'
  // Object reference (for bonus operations - transactions reference bonus, not transfer)
  objectId?: string;      // Optional: custom objectId (defaults to transferId)
  objectModel?: string;   // Optional: custom objectModel (defaults to 'transfer')
  // Payment-specific details (flexible - depends on payment method)
  [key: string]: unknown;  // Allow any additional fields for flexibility
}

export interface CreateTransferResult {
  transfer: Transfer;
  debitTx: Transaction;
  creditTx: Transaction;
}

// ═══════════════════════════════════════════════════════════════════
// Session Management (Generic - can be used by any service)
// ═══════════════════════════════════════════════════════════════════

/**
 * Start a MongoDB session for transaction management
 * 
 * Use this when you need to coordinate multiple operations atomically.
 * 
 * @returns MongoDB ClientSession
 * 
 * @example
 * ```typescript
 * const session = startSession();
 * try {
 *   await session.withTransaction(async () => {
 *     await createOrder(...);
 *     await createTransferWithTransactions(params, session);
 *     await createTransaction(...);
 *   });
 * } finally {
 *   await endSession(session);
 * }
 * ```
 */
export function startSession(): ClientSession {
  const client = getClient();
  return client.startSession();
}

/**
 * End a MongoDB session
 * 
 * Always call this in a finally block to ensure cleanup.
 * 
 * @param session - MongoDB session to end
 */
export async function endSession(session: ClientSession): Promise<void> {
  await session.endSession();
}

// ═══════════════════════════════════════════════════════════════════
// Wallet Helpers (Generic - can be used by any service)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new wallet document
 * Returns a wallet object ready to be inserted
 * 
 * @param userId - User ID
 * @param currency - Currency code
 * @param tenantId - Tenant ID
 * @returns Wallet document ready for insertion
 */
export function createNewWallet(
  userId: string,
  currency: string,
  tenantId: string,
  options?: { allowNegative?: boolean; creditLimit?: number }
): any {
  const { objectId, idString } = generateMongoId();
  return {
    _id: objectId,
    id: idString,
    userId,
    tenantId,
    currency,
    category: 'main',
    balance: 0,
    bonusBalance: 0,
    lockedBalance: 0,
    status: 'active',
    isVerified: false,
    verificationLevel: 'none',
    allowNegative: options?.allowNegative ?? false, // Wallet-level permission (default: false)
    creditLimit: options?.creditLimit, // Optional credit limit for negative balances
    lifetimeDeposits: 0,
    lifetimeWithdrawals: 0,
    lifetimeFees: 0,
    dailyWithdrawalUsed: 0,
    monthlyWithdrawalUsed: 0,
    lastWithdrawalReset: new Date(),
    lastMonthlyReset: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Get or create a wallet
 * 
 * Creates wallet if it doesn't exist, returns existing wallet otherwise.
 * Works with or without MongoDB session.
 * 
 * Security: If user tries to cheat by creating wallet for first time,
 * balance is zero, so transaction will rollback if they try to debit more.
 * 
 * @param userId - User ID
 * @param currency - Currency code
 * @param tenantId - Tenant ID
 * @param session - Optional MongoDB session (for transaction support)
 * @param options - Optional wallet creation options (allowNegative, creditLimit)
 * @returns Wallet document
 */
export async function getOrCreateWallet(
  userId: string,
  currency: string,
  tenantId: string,
  session?: ClientSession,
  options?: { allowNegative?: boolean; creditLimit?: number }
): Promise<any> {
  const db = getDatabase();
  const walletsCollection = db.collection('wallets');
  
  // Try to find existing wallet
  const findOptions = session ? { session } : {};
  let wallet = await walletsCollection.findOne(
    { userId, currency, tenantId },
    findOptions
  );
  
  // Create wallet if it doesn't exist
  if (!wallet) {
    // Check if a wallet exists with different tenantId (for debugging and potential fix)
    const walletWithoutTenant = await walletsCollection.findOne(
      { userId, currency },
      findOptions
    );
    if (walletWithoutTenant) {
      const existingTenantId = (walletWithoutTenant as any).tenantId;
      logger.warn('Wallet exists but with different tenantId - using existing wallet', {
        userId,
        currency,
        requestedTenantId: tenantId,
        existingWalletId: (walletWithoutTenant as any).id,
        existingTenantId,
      });
      // Use the existing wallet instead of creating a new one
      // This prevents creating duplicate wallets with different tenantIds
      wallet = walletWithoutTenant;
      
      // Update tenantId if needed (but only if not in a transaction that might rollback)
      // Note: We don't update tenantId here to avoid breaking multi-tenant isolation
      // The caller should ensure tenantId consistency
    } else {
      const newWallet = createNewWallet(userId, currency, tenantId, options);
      const insertOptions = session ? { session } : {};
      await walletsCollection.insertOne(newWallet, insertOptions);
      wallet = newWallet;
      logger.debug('Created new wallet in getOrCreateWallet', {
        walletId: (wallet as any).id,
        userId,
        currency,
        tenantId,
      });
    }
  } else {
    logger.debug('Found existing wallet in getOrCreateWallet', {
      walletId: (wallet as any).id,
      userId,
      currency,
      tenantId,
      balance: (wallet as any).balance,
    });
  }
  
  return wallet;
}

// ═══════════════════════════════════════════════════════════════════
// Transfer Creation (Generic - can be used by any service)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create transfer with 2 transactions and update wallets atomically
 * 
 * This is a generic helper that can be used by any service (payment, bonus, egg, etc.)
 * 
 * @param params - Transfer parameters
 * @param session - Optional MongoDB session. If provided, operation runs within that session.
 *                  If not provided, a new session is created and managed internally.
 * @returns Created transfer and transactions
 * 
 * @example
 * ```typescript
 * // Standalone usage (manages session internally)
 * const result = await createTransferWithTransactions(params);
 * 
 * // With external session (for multi-operation transactions)
 * const session = startSession();
 * try {
 *   await session.withTransaction(async () => {
 *     await createOrder(...);
 *     await createTransferWithTransactions(params, session);
 *     await createTransaction(...);
 *   });
 * } finally {
 *   await endSession(session);
 * }
 * ```
 */
export async function createTransferWithTransactions(
  params: CreateTransferParams,
  session?: ClientSession
): Promise<CreateTransferResult> {
  const db = getDatabase();
  const client = getClient();
  const transfersCollection = db.collection('transfers');
  const transactionsCollection = db.collection('transactions');
  
  // Destructure params for cleaner code
  const { 
    fromUserId, 
    toUserId, 
    amount, 
    currency, 
    tenantId: tenantIdParam, 
    feeAmount: feeAmountParam, 
    method: methodParam, 
    approvalMode: approvalModeParam,
    fromBalanceType: fromBalanceTypeParam, 
    toBalanceType: toBalanceTypeParam, 
    objectId: customObjectId, 
    objectModel: customObjectModel, 
    externalRef: externalRefParam,
    description: descriptionParam,
    ...rest 
  } = params;
  
  const tenantId = tenantIdParam || 'default';
  const feeAmount = feeAmountParam || 0;
  const netAmount = amount - feeAmount;
  const method = methodParam || 'transfer';
  const externalRef = externalRefParam;
  const description = descriptionParam;
  const approvalMode = approvalModeParam || 'direct';  // Default to 'direct' for backward compatibility
  
  // Derive balance types from method if not explicitly provided
  // Bonus methods: bonus_award, bonus_convert, bonus_forfeit
  let fromBalanceType: 'real' | 'bonus' | 'locked' = fromBalanceTypeParam || 'real';
  let toBalanceType: 'real' | 'bonus' | 'locked' = toBalanceTypeParam || 'real';
  
  if (method.startsWith('bonus_')) {
    if (method === 'bonus_award') {
      // bonus_award: bonus-pool (real) -> user (bonus)
      fromBalanceType = fromBalanceTypeParam || 'real';
      toBalanceType = toBalanceTypeParam || 'bonus';
    } else if (method === 'bonus_convert') {
      // bonus_convert: user (bonus) -> user (real) - same user
      fromBalanceType = fromBalanceTypeParam || 'bonus';
      toBalanceType = toBalanceTypeParam || 'real';
    } else if (method === 'bonus_forfeit') {
      // bonus_forfeit: user (bonus) -> bonus-pool (real)
      fromBalanceType = fromBalanceTypeParam || 'bonus';
      toBalanceType = toBalanceTypeParam || 'real';
    }
  }
  
  // Create transfer ID first (needed for transaction objectId if not custom)
  const transferId = generateId();
  
  // Use custom objectId/objectModel if provided (for bonus operations), otherwise use transferId
  const transactionObjectId = customObjectId || transferId;
  const transactionObjectModel = customObjectModel || 'transfer';
  
  // Core transaction logic (reusable with or without external session)
  const executeTransfer = async (txSession: ClientSession): Promise<CreateTransferResult> => {
    // Get or create wallets (within transaction)
    const fromWallet = await getOrCreateWallet(fromUserId, currency, tenantId, txSession);
    const fromWalletId = (fromWallet as any).id;
    
    // For same-user transfers (e.g., bonus convert), use the same wallet
    const isSameUser = fromUserId === toUserId;
    const toWallet = isSameUser ? fromWallet : await getOrCreateWallet(toUserId, currency, tenantId, txSession);
    const toWalletId = (toWallet as any).id;
    
    // Get balance fields based on balance types
    const fromBalanceField = fromBalanceType === 'bonus' ? 'bonusBalance' : fromBalanceType === 'locked' ? 'lockedBalance' : 'balance';
    const toBalanceField = toBalanceType === 'bonus' ? 'bonusBalance' : toBalanceType === 'locked' ? 'lockedBalance' : 'balance';
    
    // Calculate balances after transaction
    const fromCurrentBalance = (fromWallet as any)?.[fromBalanceField] || 0;
    const toCurrentBalance = (toWallet as any)?.[toBalanceField] || 0;
    
    // Validate balance before debiting (check allowNegative permission)
    const fromWalletAllowNegative = (fromWallet as any)?.allowNegative ?? false;
    const fromWalletCreditLimit = (fromWallet as any)?.creditLimit;
    
    if (!fromWalletAllowNegative && fromCurrentBalance < amount) {
      throw new Error(
        `Insufficient balance. Required: ${amount}, Available: ${fromCurrentBalance}. ` +
        `Wallet does not allow negative balance.`
      );
    }
    
    // Check credit limit if allowNegative is enabled and creditLimit is set (not null/undefined)
    if (fromWalletAllowNegative && fromWalletCreditLimit != null && fromWalletCreditLimit !== undefined) {
      const newBalance = fromCurrentBalance - amount;
      if (newBalance < -fromWalletCreditLimit) {
        throw new Error(
          `Would exceed credit limit. New balance: ${newBalance}, Credit limit: -${fromWalletCreditLimit}`
        );
      }
    }
    
    // Build meta object from rest params + calculated fields
    const meta = {
      ...rest,
      method,  // Payment method (e.g., 'bonus_award', 'bonus_convert', 'card', 'bank_transfer')
      feeAmount,
      netAmount,
      currency,
      // Handle bankAccount alias
      accountNumber: (rest as any).accountNumber || (rest as any).bankAccount,
    };
    
    const transfer: Transfer = {
      id: transferId,
      tenantId,
      fromUserId,
      toUserId,
      amount,
      status: 'pending',
      charge: 'credit',
      meta,
      createdAt: new Date(),
    };
    
    // Create debit transaction (fromUser) using shared helper
    const debitTxParams: CreateTransactionParams = {
      userId: fromUserId,
      amount,  // Gross amount
      currency,
      tenantId,
      charge: 'debit',
      balanceType: fromBalanceType,
      objectId: transactionObjectId,  // Custom objectId (bonus ID) or transferId
      objectModel: transactionObjectModel,  // Custom objectModel ('bonus') or 'transfer'
      externalRef,
      feeAmount,
      description,  // Include description for debit transaction too
      transferId,  // Include transferId in meta
      status: approvalMode === 'pending' ? 'pending' : undefined,  // Set status for pending mode
    };
    const debitTx = createTransactionDocument(debitTxParams, fromWallet, fromCurrentBalance);
    // Override meta to include transferId (preserve existing meta fields like description)
    debitTx.meta = {
      ...debitTx.meta,
      transferId,  // Always include transferId in meta for reference
      // Preserve description if it was set in debitTxParams (should already be in meta from createTransactionDocument)
      description: debitTxParams.description || debitTx.meta?.description || descriptionParam,
    };
    
    // Create credit transaction (toUser) using shared helper
    const creditTxParams: CreateTransactionParams = {
      userId: toUserId,
      amount: netAmount,  // Net amount (after fee)
      currency,
      tenantId,
      charge: 'credit',
      balanceType: toBalanceType,
      objectId: transactionObjectId,  // Custom objectId (bonus ID) or transferId
      objectModel: transactionObjectModel,  // Custom objectModel ('bonus') or 'transfer'
      externalRef,
      description,
      feeAmount,
      transferId,  // Include transferId in meta
      status: approvalMode === 'pending' ? 'pending' : undefined,  // Set status for pending mode
    };
    const creditTx = createTransactionDocument(creditTxParams, toWallet, toCurrentBalance);
    // Override meta to include transferId (preserve existing meta fields like description)
    creditTx.meta = {
      ...creditTx.meta,
      transferId,  // Always include transferId in meta for reference
      // Preserve description if it was set in creditTxParams (should already be in meta from createTransactionDocument)
      description: creditTxParams.description || creditTx.meta?.description || descriptionParam,
    };
    
    // Insert all documents atomically (within transaction)
    await transfersCollection.insertOne(transfer, { session: txSession });
    await transactionsCollection.insertMany([debitTx, creditTx], { session: txSession });
    
    // Update transfer with transaction IDs (within transaction)
    await transfersCollection.updateOne(
      { id: transferId },
      {
        $set: {
          'meta.fromTransactionId': debitTx.id,
          'meta.toTransactionId': creditTx.id,
          'meta.fromWalletId': (fromWallet as any).id,
          'meta.toWalletId': (toWallet as any).id,
          updatedAt: new Date(),
        },
      },
      { session: txSession }
    );
    
    // Only update wallets and transfer status if approvalMode is 'direct' (immediate approval)
    if (approvalMode === 'direct') {
      // Update transfer status to 'approved'
      await transfersCollection.updateOne(
        { id: transferId },
        {
          $set: {
            status: 'approved',
            updatedAt: new Date(),
          },
        },
        { session: txSession }
      );
      
      // Update wallets atomically (within transaction)
      const walletsCollection = db.collection('wallets');
      const fromUpdate: Record<string, any> = {
        $inc: { [fromBalanceField]: -amount },
        $set: { lastActivityAt: new Date(), updatedAt: new Date() }
      };
      
      // For same-user transfers, combine updates
      if (isSameUser) {
        fromUpdate.$inc![toBalanceField] = netAmount;
        // Only update lifetime stats for real balance credits
        if (toBalanceType === 'real') {
          fromUpdate.$inc!.lifetimeDeposits = amount;
          fromUpdate.$inc!.lifetimeFees = feeAmount;
        }
        // Use wallet ID for update (more reliable than querying by userId+currency+tenantId)
        const sameUserUpdateResult = await walletsCollection.updateOne(
          { id: fromWalletId },
          fromUpdate,
          { session: txSession }
        );
        
        // Log if update didn't match (for debugging)
        if (sameUserUpdateResult.matchedCount === 0) {
          logger.error('Wallet update did not match - wallet ID not found', {
            walletId: fromWalletId,
            userId: fromUserId,
            currency,
            tenantId,
          });
          throw new Error(`Wallet not found for id=${fromWalletId}`);
        }
      } else {
        // Use wallet ID for update (more reliable than querying by userId+currency+tenantId)
        const fromUpdateResult = await walletsCollection.updateOne(
          { id: fromWalletId },
          fromUpdate,
          { session: txSession }
        );
        
        // Log update result for debugging
        logger.debug('Wallet update result', {
          walletId: fromWalletId,
          userId: fromUserId,
          currency,
          tenantId,
          matchedCount: fromUpdateResult.matchedCount,
          modifiedCount: fromUpdateResult.modifiedCount,
          update: fromUpdate,
        });
        
        // Log if update didn't match (for debugging)
        if (fromUpdateResult.matchedCount === 0) {
          logger.error('Wallet update did not match - wallet ID not found', {
            walletId: fromWalletId,
            userId: fromUserId,
            currency,
            tenantId,
          });
          throw new Error(`Wallet not found for id=${fromWalletId}`);
        }
        
        // Verify the update actually modified the document
        if (fromUpdateResult.modifiedCount === 0) {
          logger.warn('Wallet update matched but did not modify document', {
            walletId: fromWalletId,
            userId: fromUserId,
            currency,
            tenantId,
            update: fromUpdate,
          });
        }
        
        const toUpdate: Record<string, any> = {
          $inc: { [toBalanceField]: netAmount },
          $set: { lastActivityAt: new Date(), updatedAt: new Date() }
        };
        
        // Only update lifetime stats for real balance credits
        if (toBalanceType === 'real') {
          toUpdate.$inc!.lifetimeDeposits = amount;
          toUpdate.$inc!.lifetimeFees = feeAmount;
        }
        
        // Use wallet ID for update (more reliable than querying by userId+currency+tenantId)
        const toUpdateResult = await walletsCollection.updateOne(
          { id: toWalletId },
          toUpdate,
          { session: txSession }
        );
        
        // Log if update didn't match (for debugging)
        if (toUpdateResult.matchedCount === 0) {
          logger.error('Wallet update did not match - wallet ID not found', {
            walletId: toWalletId,
            userId: toUserId,
            currency,
            tenantId,
          });
          throw new Error(`Wallet not found for id=${toWalletId}`);
        }
        
        // Invalidate wallet cache after updates (non-blocking, outside transaction)
        // Note: We do this after the transaction commits, so we need to do it in the finally block
        // For now, we'll invalidate it here - if the transaction rolls back, the cache will be stale
        // but that's acceptable since the data will be rolled back too
      }
    }
    // If approvalMode === 'pending', wallets are NOT updated here - they will be updated when transfer is approved
    
    // Return result (transaction will commit automatically on success)
    return { transfer, debitTx, creditTx };
  };
  
  // If session provided, use it directly (caller manages transaction)
  if (session) {
    return await executeTransfer(session);
  }
  
  // Otherwise, create and manage session internally
  const internalSession = client.startSession();
  try {
    const result = await internalSession.withTransaction(async () => {
      return await executeTransfer(internalSession);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    
    // Invalidate wallet cache after successful transaction commit
    // This ensures queries see the updated balances
    // Collection name is 'wallets', so cache prefix is 'wallets'
    try {
      await deleteCachePattern('wallets:list:*');
      await deleteCachePattern('wallets:id:*');
    } catch (cacheError) {
      // Cache invalidation is non-critical - log and continue
      logger.debug('Failed to invalidate wallet cache after transfer', { error: cacheError });
    }
    
    return result;
  } catch (error) {
    logger.error('Failed to create transfer with transactions', {
      error,
      fromUserId,
      toUserId,
      amount,
      currency,
    });
    throw error;
  } finally {
    await internalSession.endSession();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Transfer Approval Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Approve a pending transfer and update wallets
 * 
 * This function:
 * 1. Updates transfer status to 'approved'
 * 2. Updates transaction statuses to 'completed'
 * 3. Updates wallet balances atomically
 * 
 * @param transferId - Transfer ID to approve
 * @param session - Optional MongoDB session
 * @returns Updated transfer
 */
export async function approveTransfer(
  transferId: string,
  session?: ClientSession
): Promise<Transfer> {
  const db = getDatabase();
  const client = getClient();
  const transfersCollection = db.collection('transfers');
  const transactionsCollection = db.collection('transactions');
  const walletsCollection = db.collection('wallets');
  
  const executeApproval = async (txSession: ClientSession): Promise<Transfer> => {
    // Find transfer
    const transfer = await transfersCollection.findOne(
      { id: transferId },
      { session: txSession }
    );
    
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }
    
    const transferData = transfer as any;
    
    // Check if transfer is in pending status
    if (transferData.status !== 'pending') {
      throw new Error(`Transfer must be in pending status. Current: ${transferData.status}`);
    }
    
    // Get transaction IDs from transfer meta
    const debitTxId = transferData.meta?.fromTransactionId;
    const creditTxId = transferData.meta?.toTransactionId;
    
    if (!debitTxId || !creditTxId) {
      throw new Error(`Transfer ${transferId} is missing transaction IDs`);
    }
    
    // Get transactions
    const [debitTx, creditTx] = await Promise.all([
      transactionsCollection.findOne({ id: debitTxId }, { session: txSession }),
      transactionsCollection.findOne({ id: creditTxId }, { session: txSession }),
    ]);
    
    if (!debitTx || !creditTx) {
      throw new Error(`Transactions not found for transfer ${transferId}`);
    }
    
    const debitTxData = debitTx as any;
    const creditTxData = creditTx as any;
    
    // Get wallet IDs and balance fields from transactions
    const fromWalletId = debitTxData.meta?.walletId;
    const toWalletId = creditTxData.meta?.walletId;
    const fromBalanceType = debitTxData.meta?.balanceType || 'real';
    const toBalanceType = creditTxData.meta?.balanceType || 'real';
    
    const fromBalanceField = fromBalanceType === 'bonus' ? 'bonusBalance' : fromBalanceType === 'locked' ? 'lockedBalance' : 'balance';
    const toBalanceField = toBalanceType === 'bonus' ? 'bonusBalance' : toBalanceType === 'locked' ? 'lockedBalance' : 'balance';
    
    // Get wallets by ID (from transaction metadata)
    const [fromWallet, toWallet] = await Promise.all([
      walletsCollection.findOne({ id: fromWalletId }, { session: txSession }),
      walletsCollection.findOne({ id: toWalletId }, { session: txSession }),
    ]);
    
    if (!fromWallet || !toWallet) {
      throw new Error(`Wallets not found for transfer ${transferId}. FromWalletId: ${fromWalletId}, ToWalletId: ${toWalletId}`);
    }
    
    const amount = transferData.amount;
    const feeAmount = transferData.meta?.feeAmount || 0;
    const netAmount = amount - feeAmount;
    const currency = transferData.meta?.currency || debitTxData.meta?.currency;
    const tenantId = transferData.tenantId;
    
    // Update wallets atomically
    const isSameUser = transferData.fromUserId === transferData.toUserId;
    
    if (isSameUser) {
      // Same user transfer (e.g., bonus convert)
      const update: Record<string, any> = {
        $inc: {
          [fromBalanceField]: -amount,
          [toBalanceField]: netAmount,
        },
        $set: { lastActivityAt: new Date(), updatedAt: new Date() }
      };
      
      // Only update lifetime stats for real balance credits
      if (toBalanceType === 'real') {
        update.$inc!.lifetimeDeposits = amount;
        update.$inc!.lifetimeFees = feeAmount;
      }
      
      const sameUserUpdateResult = await walletsCollection.updateOne(
        { id: fromWalletId },
        update,
        { session: txSession }
      );
      
      if (sameUserUpdateResult.matchedCount === 0) {
        throw new Error(`Wallet not found for id=${fromWalletId} during transfer approval`);
      }
    } else {
      // Different users
      const fromUpdateResult = await walletsCollection.updateOne(
        { id: fromWalletId },
        {
          $inc: { [fromBalanceField]: -amount },
          $set: { lastActivityAt: new Date(), updatedAt: new Date() }
        },
        { session: txSession }
      );
      
      if (fromUpdateResult.matchedCount === 0) {
        throw new Error(`Wallet not found for id=${fromWalletId} during transfer approval`);
      }
      
      const toUpdate: Record<string, any> = {
        $inc: { [toBalanceField]: netAmount },
        $set: { lastActivityAt: new Date(), updatedAt: new Date() }
      };
      
      // Only update lifetime stats for real balance credits
      if (toBalanceType === 'real') {
        toUpdate.$inc!.lifetimeDeposits = amount;
        toUpdate.$inc!.lifetimeFees = feeAmount;
      }
      
      const toUpdateResult = await walletsCollection.updateOne(
        { id: toWalletId },
        toUpdate,
        { session: txSession }
      );
      
      if (toUpdateResult.matchedCount === 0) {
        throw new Error(`Wallet not found for id=${toWalletId} during transfer approval`);
      }
    }
    
    // Update transaction statuses
    await Promise.all([
      transactionsCollection.updateOne(
        { id: debitTxId },
        {
          $set: {
            status: 'completed',
            updatedAt: new Date(),
          },
        },
        { session: txSession }
      ),
      transactionsCollection.updateOne(
        { id: creditTxId },
        {
          $set: {
            status: 'completed',
            updatedAt: new Date(),
          },
        },
        { session: txSession }
      ),
    ]);
    
    // Update transfer status
    await transfersCollection.updateOne(
      { id: transferId },
      {
        $set: {
          status: 'approved',
          updatedAt: new Date(),
        },
      },
      { session: txSession }
    );
    
    // Return updated transfer
    const updatedTransfer = await transfersCollection.findOne(
      { id: transferId },
      { session: txSession }
    );
    
    if (!updatedTransfer) {
      throw new Error(`Transfer ${transferId} not found after update`);
    }
    
    return updatedTransfer as unknown as Transfer;
  };
  
  // If session provided, use it directly
  if (session) {
    return await executeApproval(session);
  }
  
  // Otherwise, create and manage session internally
  const internalSession = client.startSession();
  try {
    const result = await internalSession.withTransaction(async () => {
      return await executeApproval(internalSession);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    
    // Invalidate wallet cache after successful transaction commit
    try {
      await deleteCachePattern('wallet:list:*');
      await deleteCachePattern('wallet:id:*');
    } catch (cacheError) {
      logger.debug('Failed to invalidate wallet cache after transfer approval', { error: cacheError });
    }
    
    return result;
  } finally {
    await internalSession.endSession();
  }
}

/**
 * Decline a pending transfer
 * 
 * This function:
 * 1. Updates transfer status to 'failed'
 * 2. Updates transaction statuses to 'failed'
 * 3. Does NOT update wallets (they were never updated for pending transfers)
 * 
 * @param transferId - Transfer ID to decline
 * @param reason - Optional reason for decline
 * @param session - Optional MongoDB session
 * @returns Updated transfer
 */
export async function declineTransfer(
  transferId: string,
  reason?: string,
  session?: ClientSession
): Promise<Transfer> {
  const db = getDatabase();
  const client = getClient();
  const transfersCollection = db.collection('transfers');
  const transactionsCollection = db.collection('transactions');
  
  const executeDecline = async (txSession: ClientSession): Promise<Transfer> => {
    // Find transfer
    const transfer = await transfersCollection.findOne(
      { id: transferId },
      { session: txSession }
    );
    
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }
    
    const transferData = transfer as any;
    
    // Check if transfer is in pending status
    if (transferData.status !== 'pending') {
      throw new Error(`Transfer must be in pending status. Current: ${transferData.status}`);
    }
    
    // Get transaction IDs from transfer meta
    const debitTxId = transferData.meta?.fromTransactionId;
    const creditTxId = transferData.meta?.toTransactionId;
    
    if (!debitTxId || !creditTxId) {
      throw new Error(`Transfer ${transferId} is missing transaction IDs`);
    }
    
    // Update transaction statuses to 'failed'
    await Promise.all([
      transactionsCollection.updateOne(
        { id: debitTxId },
        {
          $set: {
            status: 'failed',
            updatedAt: new Date(),
          },
        },
        { session: txSession }
      ),
      transactionsCollection.updateOne(
        { id: creditTxId },
        {
          $set: {
            status: 'failed',
            updatedAt: new Date(),
          },
        },
        { session: txSession }
      ),
    ]);
    
    // Update transfer status to 'failed'
    await transfersCollection.updateOne(
      { id: transferId },
      {
        $set: {
          status: 'failed',
          'meta.declineReason': reason || 'Manually declined',
          updatedAt: new Date(),
        },
      },
      { session: txSession }
    );
    
    // Return updated transfer
    const updatedTransfer = await transfersCollection.findOne(
      { id: transferId },
      { session: txSession }
    );
    
    if (!updatedTransfer) {
      throw new Error(`Transfer ${transferId} not found after update`);
    }
    
    return updatedTransfer as unknown as Transfer;
  };
  
  // If session provided, use it directly
  if (session) {
    return await executeDecline(session);
  }
  
  // Otherwise, create and manage session internally
  const internalSession = client.startSession();
  try {
    const result = await internalSession.withTransaction(async () => {
      return await executeDecline(internalSession);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    
    // Invalidate wallet cache after transaction (even though wallets weren't updated for declined transfers)
    // This ensures consistency
    try {
      await deleteCachePattern('wallet:list:*');
      await deleteCachePattern('wallet:id:*');
    } catch (cacheError) {
      logger.debug('Failed to invalidate wallet cache after transfer decline', { error: cacheError });
    }
    
    return result;
  } finally {
    await internalSession.endSession();
  }
}
