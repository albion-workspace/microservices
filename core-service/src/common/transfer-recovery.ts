/**
 * Transfer Recovery Handler - Implementation of generic recovery for transfers
 * 
 * This module implements the RecoveryHandler interface for transfers.
 * It's a showcase of how to use the generic recovery system.
 * 
 * Usage:
 * ```typescript
 * import { registerRecoveryHandler } from 'core-service';
 * import { createTransferRecoveryHandler } from './transfer-recovery';
 * 
 * // Register transfer recovery handler
 * registerRecoveryHandler('transfer', createTransferRecoveryHandler());
 * 
 * // Recovery will now work automatically for transfers
 * ```
 */

import type { ClientSession, Db } from 'mongodb';
import { logger } from '../index.js';
import type { Transfer } from './transfer-helper.js';
import { createTransferWithTransactions, type CreateTransferParams } from './transfer-helper.js';
import type { RecoveryHandler, RecoverableOperation } from './recovery.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';

/**
 * Create reverse transfer (opposite direction)
 * Used for recovery - reverses the original transfer
 */
async function createReverseTransfer(
  transfer: Transfer,
  session: ClientSession,
  options?: {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    context?: DatabaseContext;
  }
): Promise<{ operationId: string }> {
  // Determine balance types from original transfer
  const fromBalanceType = (transfer.meta?.toBalanceType as 'real' | 'bonus' | 'locked') || 'real';
  const toBalanceType = (transfer.meta?.fromBalanceType as 'real' | 'bonus' | 'locked') || 'real';
  
  // Create reverse transfer (swap fromUserId and toUserId)
  const reverseTransfer = await createTransferWithTransactions({
    fromUserId: transfer.toUserId,
    toUserId: transfer.fromUserId,
    amount: transfer.amount,
    currency: (transfer.meta?.currency as string) || 'EUR',
    tenantId: transfer.tenantId,
    feeAmount: (transfer.meta?.feeAmount as number) || 0,
    method: `recovery_${(transfer.meta?.method as string) || 'transfer'}`,
    description: `Recovery: Reverse transfer ${transfer.id}`,
    // Use same balance types as original (swapped)
    fromBalanceType,
    toBalanceType,
    // Mark as recovery transfer
    externalRef: `recovery_${transfer.id}_${Date.now()}`,
  }, {
    ...options,
    session,
  });
  
  return { operationId: reverseTransfer.transfer.id };
}

/**
 * Create transfer recovery handler
 * Implements RecoveryHandler interface for transfers
 */
export function createTransferRecoveryHandler(options?: {
  database?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
  context?: DatabaseContext;
}): RecoveryHandler<Transfer> {
  let db: Db | null = options?.database || null;
  const strategy = options?.databaseStrategy;
  const context = options?.context;

  const getDb = async (): Promise<Db> => {
    if (db) return db;
    if (strategy && context) {
      db = await strategy.resolve(context);
      return db;
    }
    throw new Error('createTransferRecoveryHandler requires either database or databaseStrategy with context');
  };

  return {
    /**
     * Find transfer by ID
     */
    findOperation: async (id: string, session?: ClientSession): Promise<Transfer | null> => {
      const database = await getDb();
      const transfersCollection = database.collection('transfers');
      const transfer = await transfersCollection.findOne(
        { id },
        { session }
      );
      return transfer as Transfer | null;
    },

    /**
     * Find transactions related to this transfer
     */
    findRelatedTransactions: async (id: string, session?: ClientSession): Promise<unknown[]> => {
      const database = await getDb();
      const transactionsCollection = database.collection('transactions');
      const transactions = await transactionsCollection
        .find(
          {
            objectId: id,
            objectModel: 'transfer',
          },
          { session }
        )
        .toArray();
      return transactions;
    },

    /**
     * Reverse the transfer by creating opposite transfer
     */
    reverseOperation: async (transfer: Transfer, session: ClientSession): Promise<{ operationId: string }> => {
      return await createReverseTransfer(transfer, session, options);
    },

    /**
     * Delete transfer (if no transactions exist)
     */
    deleteOperation: async (id: string, session: ClientSession): Promise<void> => {
      const database = await getDb();
      const transfersCollection = database.collection('transfers');
      await transfersCollection.deleteOne({ id }, { session });
    },

    /**
     * Update transfer status
     */
    updateStatus: async (
      id: string,
      status: RecoverableOperation['status'],
      meta: Record<string, unknown>,
      session: ClientSession
    ): Promise<void> => {
      const database = await getDb();
      const transfersCollection = database.collection('transfers');
      await transfersCollection.updateOne(
        { id },
        {
          $set: {
            status: status as Transfer['status'],
            ...meta,
            updatedAt: new Date(),
          },
        },
        { session }
      );
    },

    /**
     * Check if transfer needs recovery
     * Custom logic for transfers
     */
    needsRecovery: (transfer: Transfer, transactions: unknown[]): boolean => {
      // Transfer needs recovery if:
      // 1. Status is 'pending' but transactions exist
      if (transfer.status === 'pending' && transactions.length > 0) {
        return true;
      }

      // 2. Status is 'failed' but transactions exist
      if (transfer.status === 'failed' && transactions.length > 0) {
        return true;
      }

      // 3. Status is 'approved' but should be reversed (for recovery scenarios)
      // This is typically called explicitly for recovery, so we assume it needs recovery
      if (transfer.status === 'approved') {
        return true;
      }

      return false;
    },

    /**
     * Get operation type name
     */
    getOperationType: () => 'transfer',
  };
}
