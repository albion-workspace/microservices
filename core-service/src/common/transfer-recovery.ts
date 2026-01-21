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

import type { ClientSession } from 'mongodb';
import { getDatabase, logger } from '../index.js';
import type { Transfer } from './transfer-helper.js';
import { createTransferWithTransactions, type CreateTransferParams } from './transfer-helper.js';
import type { RecoveryHandler, RecoverableOperation } from './recovery.js';

/**
 * Create reverse transfer (opposite direction)
 * Used for recovery - reverses the original transfer
 */
async function createReverseTransfer(
  transfer: Transfer,
  session: ClientSession
): Promise<{ operationId: string }> {
  const transferData = transfer as any;
  
  // Determine balance types from original transfer
  const fromBalanceType = transferData.meta?.toBalanceType || 'real';
  const toBalanceType = transferData.meta?.fromBalanceType || 'real';
  
  // Create reverse transfer (swap fromUserId and toUserId)
  const reverseTransfer = await createTransferWithTransactions({
    fromUserId: transferData.toUserId,
    toUserId: transferData.fromUserId,
    amount: transferData.amount,
    currency: transferData.meta?.currency || 'EUR',
    tenantId: transferData.tenantId,
    feeAmount: transferData.meta?.feeAmount || 0,
    method: `recovery_${transferData.meta?.method || 'transfer'}`,
    description: `Recovery: Reverse transfer ${transferData.id}`,
    // Use same balance types as original (swapped)
    fromBalanceType,
    toBalanceType,
    // Mark as recovery transfer
    externalRef: `recovery_${transferData.id}_${Date.now()}`,
  }, session);
  
  return { operationId: reverseTransfer.transfer.id };
}

/**
 * Create transfer recovery handler
 * Implements RecoveryHandler interface for transfers
 */
export function createTransferRecoveryHandler(): RecoveryHandler<Transfer> {
  const db = getDatabase();
  const transfersCollection = db.collection('transfers');
  const transactionsCollection = db.collection('transactions');

  return {
    /**
     * Find transfer by ID
     */
    findOperation: async (id: string, session?: ClientSession): Promise<Transfer | null> => {
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
      return await createReverseTransfer(transfer, session);
    },

    /**
     * Delete transfer (if no transactions exist)
     */
    deleteOperation: async (id: string, session: ClientSession): Promise<void> => {
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
