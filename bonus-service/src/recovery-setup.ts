/**
 * Recovery Setup for Bonus Service
 * 
 * This module sets up recovery handlers for bonus service operations.
 * Bonus service uses transfers for bonus operations (award, convert, forfeit),
 * so it needs transfer recovery handler registered.
 * 
 * Usage:
 * ```typescript
 * import { setupRecovery } from './recovery-setup';
 * 
 * // In service initialization
 * await setupRecovery();
 * ```
 */

import {
  registerRecoveryHandler,
  getRecoveryJob,
  logger,
} from 'core-service';
import { createTransferRecoveryHandler } from 'core-service';

/**
 * Setup recovery system for bonus service
 * Registers transfer recovery handler (bonus operations use transfers)
 * and starts recovery job
 */
export async function setupRecovery(): Promise<void> {
  try {
    // Register transfer recovery handler
    // Bonus operations (award, convert, forfeit) use createTransferWithTransactions
    // So they need transfer recovery handler
    registerRecoveryHandler('transfer', createTransferRecoveryHandler());
    logger.info('✅ Transfer recovery handler registered for bonus service');

    // Start recovery job (runs every 5 minutes, checks for operations older than 60 seconds)
    const recoveryJob = getRecoveryJob();
    recoveryJob.start(5 * 60 * 1000, 60); // 5 minutes interval, 60 seconds max age
    logger.info('✅ Recovery job started (interval: 5 minutes, max age: 60 seconds)');

    // Setup graceful shutdown
    const { onShutdown } = await import('core-service');
    onShutdown(() => {
      recoveryJob.stop();
      logger.info('Recovery job stopped');
    });
  } catch (error) {
    logger.error('Failed to setup recovery system', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
