/**
 * Recovery Setup for Bonus Service
 *
 * Bonus operations (award, convert, forfeit) use transfers; this uses
 * createTransferRecoverySetup from core-service to register transfer recovery,
 * start the recovery job, and register shutdown cleanup.
 */

import type { RecoveryHandler, RecoverableOperation } from 'core-service';
import { createTransferRecoverySetup, createTransferRecoveryHandler } from 'core-service';

/**
 * Setup recovery system for bonus service
 */
export async function setupRecovery(): Promise<void> {
  createTransferRecoverySetup(createTransferRecoveryHandler() as unknown as RecoveryHandler<RecoverableOperation>, {
    serviceLabel: 'bonus service',
  });
}
