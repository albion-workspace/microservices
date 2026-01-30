/**
 * KYC Service Event Dispatcher
 * 
 * Handles incoming events from other services and emits KYC events
 */

import { 
  on, 
  emit, 
  startListening, 
  logger,
  createUnifiedEmitter,
  createWebhookManager,
} from 'core-service';

import { kycEngine } from './services/kyc-engine/engine.js';
import { kycRepository } from './repositories/kyc-repository.js';
import { db } from './database.js';

// ═══════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle user registration - create KYC profile
 */
async function handleUserRegistered(event: {
  tenantId: string;
  userId: string;
  data: {
    userId: string;
    email?: string;
  };
}) {
  try {
    const { tenantId, userId, data } = event;
    
    logger.info('Creating KYC profile for new user', { userId, tenantId });
    
    // Create profile with default jurisdiction
    await kycEngine.getOrCreateProfile(userId, tenantId, 'US');
    
    logger.info('KYC profile created for new user', { userId });
  } catch (error) {
    logger.error('Failed to create KYC profile for user', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: event.data.userId,
    });
  }
}

/**
 * Handle deposit initiated - check limits
 */
async function handleDepositInitiated(event: {
  tenantId: string;
  userId: string;
  data: {
    amount: number;
    currency: string;
    transactionId: string;
  };
}) {
  try {
    const { tenantId, userId, data } = event;
    
    const check = await kycEngine.checkTransactionLimit(
      userId,
      tenantId,
      'deposit',
      data.amount,
      data.currency
    );
    
    if (!check.allowed) {
      logger.warn('Deposit blocked by KYC limits', {
        userId,
        amount: data.amount,
        reason: check.reason,
        requiredTier: check.requiredTier,
      });
      
      // Emit limit exceeded event
      await emit('kyc.limit.exceeded', tenantId, userId, {
        operationType: 'deposit',
        amount: data.amount,
        currency: data.currency,
        reason: check.reason,
        requiredTier: check.requiredTier,
        transactionId: data.transactionId,
      });
    }
  } catch (error) {
    logger.error('Error checking deposit limits', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: event.userId,
    });
  }
}

/**
 * Handle withdrawal initiated - check limits and tier
 */
async function handleWithdrawalInitiated(event: {
  tenantId: string;
  userId: string;
  data: {
    amount: number;
    currency: string;
    transactionId: string;
  };
}) {
  try {
    const { tenantId, userId, data } = event;
    
    const check = await kycEngine.checkTransactionLimit(
      userId,
      tenantId,
      'withdrawal',
      data.amount,
      data.currency
    );
    
    if (!check.allowed) {
      logger.warn('Withdrawal blocked by KYC', {
        userId,
        amount: data.amount,
        reason: check.reason,
        requiredTier: check.requiredTier,
      });
      
      await emit('kyc.limit.exceeded', tenantId, userId, {
        operationType: 'withdrawal',
        amount: data.amount,
        currency: data.currency,
        reason: check.reason,
        requiredTier: check.requiredTier,
        transactionId: data.transactionId,
      });
    }
  } catch (error) {
    logger.error('Error checking withdrawal limits', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: event.userId,
    });
  }
}

/**
 * Handle high-value transaction - trigger risk assessment
 */
async function handleHighValueTransaction(event: {
  tenantId: string;
  userId: string;
  data: {
    amount: number;
    currency: string;
    type: string;
  };
}) {
  try {
    const { tenantId, userId, data } = event;
    
    // Threshold for triggering risk assessment (EUR 10,000)
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
  } catch (error) {
    logger.error('Error triggering risk assessment', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: event.userId,
    });
  }
}

/**
 * Handle bonus claim - check tier eligibility
 */
async function handleBonusClaimRequested(event: {
  tenantId: string;
  userId: string;
  data: {
    bonusId: string;
    requiredTier?: string;
  };
}) {
  try {
    const { tenantId, userId, data } = event;
    
    if (data.requiredTier) {
      const eligibility = await kycEngine.checkEligibility(
        userId,
        tenantId,
        data.requiredTier as any
      );
      
      if (!eligibility.meetsRequirement) {
        logger.info('Bonus claim blocked by KYC tier', {
          userId,
          bonusId: data.bonusId,
          currentTier: eligibility.currentTier,
          requiredTier: data.requiredTier,
        });
        
        await emit('kyc.eligibility.failed', tenantId, userId, {
          operation: 'bonus_claim',
          bonusId: data.bonusId,
          currentTier: eligibility.currentTier,
          requiredTier: data.requiredTier,
          upgradeUrl: eligibility.upgradeUrl,
        });
      }
    }
  } catch (error) {
    logger.error('Error checking bonus eligibility', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: event.userId,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════

let webhookManager: any = null;
let unifiedEmitter: any = null;

/**
 * Initialize event handlers
 */
export async function initializeEventHandlers(): Promise<void> {
  logger.info('Initializing KYC event handlers');
  
  // Initialize webhook manager
  const database = await db.getDb();
  webhookManager = createWebhookManager({
    db: database,
    serviceName: 'kyc-service',
  });
  
  // Create unified emitter
  unifiedEmitter = createUnifiedEmitter(webhookManager);
  
  // Register event handlers
  
  // Auth service events
  on('user.registered', handleUserRegistered);
  
  // Payment service events
  on('wallet.deposit.initiated', handleDepositInitiated);
  on('wallet.withdrawal.initiated', handleWithdrawalInitiated);
  on('wallet.transaction.completed', handleHighValueTransaction);
  
  // Bonus service events
  on('bonus.claim.requested', handleBonusClaimRequested);
  
  // Start listening
  await startListening();
  
  logger.info('KYC event handlers initialized');
}

/**
 * Emit KYC event (with webhook support)
 */
export async function emitKYCEvent(
  eventType: string,
  tenantId: string,
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  if (unifiedEmitter) {
    await unifiedEmitter.emit(eventType, { tenantId, userId, ...data });
  } else {
    await emit(eventType, tenantId, userId, data);
  }
}

/**
 * Get webhook manager
 */
export function getWebhookManager() {
  return webhookManager;
}
