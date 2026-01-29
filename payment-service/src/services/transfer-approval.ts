/**
 * Transfer Approval Service
 * 
 * Handles approval and decline of pending transfers.
 * Approval is handled at the transfer level, not transaction level.
 */

import { 
  getDatabase, 
  findOneById,
  logger,
  approveTransfer,
  declineTransfer,
} from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Transfer Approval Resolvers
// ═══════════════════════════════════════════════════════════════════

export const transferApprovalResolvers = {
  Mutation: {
    approveTransfer: async (args: Record<string, unknown>) => {
      const transferId = args.transferId as string;
      
      try {
        // GraphQL resolvers use getDatabase() as database strategies are initialized at gateway level
        const db = getDatabase();
        const transfer = await approveTransfer(transferId, {
          database: db,
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
        // GraphQL resolvers use getDatabase() as database strategies are initialized at gateway level
        const db = getDatabase();
        const transfer = await declineTransfer(transferId, {
          database: db,
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
