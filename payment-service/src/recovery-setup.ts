/**
 * Recovery Setup for Payment Service
 *
 * Uses createTransferRecoverySetupForService from core-service to register transfer recovery,
 * start the recovery job, and register shutdown cleanup.
 */

import { createTransferRecoverySetupForService } from 'core-service';

/**
 * Setup recovery system for payment service
 */
export async function setupRecovery(): Promise<void> {
  createTransferRecoverySetupForService('payment service');
}
