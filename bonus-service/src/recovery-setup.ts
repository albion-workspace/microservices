/**
 * Recovery Setup for Bonus Service
 *
 * Bonus operations (award, convert, forfeit) use transfers; this uses
 * createTransferRecoverySetupForService from core-service to register transfer recovery,
 * start the recovery job, and register shutdown cleanup.
 */

import { createTransferRecoverySetupForService } from 'core-service';

/**
 * Setup recovery system for bonus service
 */
export async function setupRecovery(): Promise<void> {
  createTransferRecoverySetupForService('bonus service');
}
