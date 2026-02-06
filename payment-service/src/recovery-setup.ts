/**
 * Recovery Setup for Payment Service
 * 
 * This module sets up recovery handlers for payment service operations.
 * It registers transfer recovery handler and starts the recovery job.
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
  getErrorMessage,
  createTransferRecoveryHandler,
  onShutdown,
} from 'core-service';

/**
 * Setup recovery system for payment service
 * Registers recovery handlers and starts recovery job
 */
export async function setupRecovery(): Promise<void> {
  try {
    // Register transfer recovery handler
    registerRecoveryHandler('transfer', createTransferRecoveryHandler());
    logger.info('✅ Transfer recovery handler registered');

    // Start recovery job (runs every 5 minutes, checks for operations older than 60 seconds)
    const recoveryJob = getRecoveryJob();
    recoveryJob.start(5 * 60 * 1000, 60); // 5 minutes interval, 60 seconds max age
    logger.info('✅ Recovery job started (interval: 5 minutes, max age: 60 seconds)');

    // Setup graceful shutdown
    onShutdown(() => {
      recoveryJob.stop();
      logger.info('Recovery job stopped');
    });
  } catch (error) {
    logger.error('Failed to setup recovery system', {
      error: getErrorMessage(error),
    });
    throw error;
  }
}
