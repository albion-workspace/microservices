/**
 * KYC Service Event Dispatcher
 * 
 * Handles incoming events from other services and emits KYC events
 */

import {
  createUnifiedEmitter,
  createWebhookManager,
  logger,
  on,
  startListening,
  withEventHandlerError,
  type IntegrationEvent,
} from 'core-service';

import { KYC_ERRORS } from './error-codes.js';
import { kycRepository } from './repositories/kyc-repository.js';
import { kycEngine } from './services/kyc-engine/engine.js';
import type { KYCTier } from './types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// KYC Webhook Event Types
// ═══════════════════════════════════════════════════════════════════

export type KYCWebhookEvents =
  | 'kyc.profile.created'
  | 'kyc.tier.upgraded'
  | 'kyc.tier.downgraded'
  | 'kyc.verification.started'
  | 'kyc.verification.completed'
  | 'kyc.verification.failed'
  | 'kyc.document.uploaded'
  | 'kyc.document.verified'
  | 'kyc.document.rejected'
  | 'kyc.risk.updated'
  | 'kyc.limit.exceeded'
  | 'kyc.eligibility.failed'
  | 'kyc.*';

// ═══════════════════════════════════════════════════════════════════
// Webhook Manager
// ═══════════════════════════════════════════════════════════════════

export const kycWebhooks = createWebhookManager<KYCWebhookEvents>({
  serviceName: 'kyc',
  apiVersion: '2024-01-01',
});

// ═══════════════════════════════════════════════════════════════════
// Unified Event Emitter
// ═══════════════════════════════════════════════════════════════════

export const emitKYCEvent = createUnifiedEmitter(kycWebhooks);

// ═══════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════

type UserRegisteredData = { userId: string; email?: string };

async function handleUserRegistered(event: IntegrationEvent<UserRegisteredData>): Promise<void> {
  const { tenantId, userId } = event;
  if (!userId) {
    logger.warn('user.registered event missing userId');
    return;
  }
  logger.info('Creating KYC profile for new user', { userId, tenantId });
  await kycEngine.getOrCreateProfile(userId, tenantId, 'US');
  logger.info('KYC profile created for new user', { userId });
}

type DepositInitiatedData = { amount: number; currency: string; transactionId: string };

async function handleDepositInitiated(event: IntegrationEvent<DepositInitiatedData>): Promise<void> {
  const { tenantId, userId, data } = event;
  if (!userId) {
    logger.warn('wallet.deposit.initiated event missing userId');
    return;
  }
  const check = await kycEngine.checkTransactionLimit(userId, tenantId, 'deposit', data.amount, data.currency);
  if (!check.allowed) {
    logger.warn('Deposit blocked by KYC limits', {
      userId,
      amount: data.amount,
      reason: check.reason,
      requiredTier: check.requiredTier,
    });
    await emitKYCEvent('kyc.limit.exceeded', tenantId, userId, {
      operationType: 'deposit',
      amount: data.amount,
      currency: data.currency,
      reason: check.reason,
      requiredTier: check.requiredTier,
      transactionId: data.transactionId,
    });
  }
}

type WithdrawalInitiatedData = { amount: number; currency: string; transactionId: string };

async function handleWithdrawalInitiated(event: IntegrationEvent<WithdrawalInitiatedData>): Promise<void> {
  const { tenantId, userId, data } = event;
  if (!userId) {
    logger.warn('wallet.withdrawal.initiated event missing userId');
    return;
  }
  const check = await kycEngine.checkTransactionLimit(userId, tenantId, 'withdrawal', data.amount, data.currency);
  if (!check.allowed) {
    logger.warn('Withdrawal blocked by KYC', {
      userId,
      amount: data.amount,
      reason: check.reason,
      requiredTier: check.requiredTier,
    });
    await emitKYCEvent('kyc.limit.exceeded', tenantId, userId, {
      operationType: 'withdrawal',
      amount: data.amount,
      currency: data.currency,
      reason: check.reason,
      requiredTier: check.requiredTier,
      transactionId: data.transactionId,
    });
  }
}

type HighValueTransactionData = { amount: number; currency: string; type: string };

async function handleHighValueTransaction(event: IntegrationEvent<HighValueTransactionData>): Promise<void> {
  const { tenantId, userId, data } = event;
  if (!userId) {
    logger.warn('wallet.transaction.completed event missing userId');
    return;
  }
  const threshold = 10000;
  if (data.amount >= threshold) {
    const profile = await kycRepository.findByUserId(userId, tenantId);
    if (profile) {
      logger.info('Triggering risk assessment for high-value transaction', {
        userId,
        amount: data.amount,
        type: data.type,
      });
      await kycEngine.assessRisk(profile.id);
    }
  }
}

type BonusClaimRequestedData = { bonusId: string; requiredTier?: string };

async function handleBonusClaimRequested(event: IntegrationEvent<BonusClaimRequestedData>): Promise<void> {
  const { tenantId, userId, data } = event;
  if (!userId) {
    logger.warn('bonus.claim.requested event missing userId');
    return;
  }
  if (data.requiredTier) {
    const eligibility = await kycEngine.checkEligibility(userId, tenantId, data.requiredTier as KYCTier);
    if (!eligibility.meetsRequirement) {
      logger.info('Bonus claim blocked by KYC tier', {
        userId,
        bonusId: data.bonusId,
        currentTier: eligibility.currentTier,
        requiredTier: data.requiredTier,
      });
      await emitKYCEvent('kyc.eligibility.failed', tenantId, userId, {
        operation: 'bonus_claim',
        bonusId: data.bonusId,
        currentTier: eligibility.currentTier,
        requiredTier: data.requiredTier,
        upgradeUrl: eligibility.upgradeUrl,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize event handlers
 */
export async function initializeEventHandlers(): Promise<void> {
  logger.info('Initializing KYC event handlers');

  on('user.registered', withEventHandlerError<IntegrationEvent<UserRegisteredData>>(KYC_ERRORS.InternalError, handleUserRegistered));
  on('wallet.deposit.initiated', withEventHandlerError<IntegrationEvent<DepositInitiatedData>>(KYC_ERRORS.InternalError, handleDepositInitiated));
  on('wallet.withdrawal.initiated', withEventHandlerError<IntegrationEvent<WithdrawalInitiatedData>>(KYC_ERRORS.InternalError, handleWithdrawalInitiated));
  on('wallet.transaction.completed', withEventHandlerError<IntegrationEvent<HighValueTransactionData>>(KYC_ERRORS.InternalError, handleHighValueTransaction));
  on('bonus.claim.requested', withEventHandlerError<IntegrationEvent<BonusClaimRequestedData>>(KYC_ERRORS.InternalError, handleBonusClaimRequested));

  await startListening();
  logger.info('KYC event handlers initialized');
}

/**
 * Get webhook manager
 */
export function getWebhookManager() {
  return kycWebhooks;
}
