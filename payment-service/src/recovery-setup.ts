/**
 * Recovery Setup for Payment Service
 *
 * Uses createTransferRecoverySetup from core-service to register transfer recovery,
 * start the recovery job, and register shutdown cleanup.
 */

import type { RecoveryHandler, RecoverableOperation } from 'core-service';
import { createTransferRecoverySetup, createTransferRecoveryHandler } from 'core-service';

/**
 * Setup recovery system for payment service
 */
export async function setupRecovery(): Promise<void> {
  createTransferRecoverySetup(createTransferRecoveryHandler() as unknown as RecoveryHandler<RecoverableOperation>, {
    serviceLabel: 'payment service',
  });
}
