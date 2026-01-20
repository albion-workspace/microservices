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
        const transfer = await approveTransfer(transferId);
        
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
        const transfer = await declineTransfer(transferId, reason);
        
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
