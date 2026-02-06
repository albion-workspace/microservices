/**
 * Transfer Approval Service
 * 
 * Handles approval and decline of pending transfers.
 * Approval is handled at the transfer level, not transaction level.
 */

import { 
  findOneById,
  logger,
  approveTransfer,
  declineTransfer,
} from 'core-service';
import { db } from '../accessors.js';

// ═══════════════════════════════════════════════════════════════════
// Transfer Approval Resolvers
// ═══════════════════════════════════════════════════════════════════

export const transferApprovalResolvers = {
  Mutation: {
    approveTransfer: async (args: Record<string, unknown>) => {
      const transferId = args.transferId as string;
      
      try {
        // GraphQL resolvers use service database accessor
        const database = await db.getDb();
        const transfer = await approveTransfer(transferId, {
          database,
        });
        
        return {
          success: true,
          transfer,
        };
      } catch (error: any) {
        logger.error('Failed to approve transfer', {
          error: error.message,
          transferId,
        });
        throw error;
      }
    },
    
    declineTransfer: async (args: Record<string, unknown>) => {
      const transferId = args.transferId as string;
      const reason = (args.reason as string) || 'Manually declined';
      
      try {
        // GraphQL resolvers use service database accessor
        const database = await db.getDb();
        const transfer = await declineTransfer(transferId, {
          database,
          reason,
        });
        
        return {
          success: true,
          transfer,
        };
      } catch (error: any) {
        logger.error('Failed to decline transfer', {
          error: error.message,
          transferId,
          reason,
        });
        throw error;
      }
    },
  },
};
