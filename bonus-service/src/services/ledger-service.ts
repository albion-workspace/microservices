/**
 * Ledger Service Integration for Bonus Service
 * 
 * Ensures all bonus operations are backed by ledger accounts.
 * Prevents infinite money by checking bonus pool balance before awarding.
 */

import { createLedger, getDatabase, getClient, logger, type Ledger } from 'core-service';

let ledgerInstance: Ledger | null = null;

/**
 * Initialize ledger system for bonus service
 */
export async function initializeLedger(tenantId: string = 'default'): Promise<Ledger> {
  if (ledgerInstance) {
    return ledgerInstance;
  }

  const db = getDatabase();
  const client = getClient();

  ledgerInstance = createLedger({
    tenantId,
    db,
    client,
  });

  await ledgerInstance.initialize();
  
  logger.info('Bonus ledger initialized', { tenantId });
  
  return ledgerInstance;
}

/**
 * Get ledger instance (must be initialized first)
 */
export function getLedger(): Ledger {
  if (!ledgerInstance) {
    throw new Error('Ledger not initialized. Call initializeLedger() first.');
  }
  return ledgerInstance;
}

/**
 * Get or create user bonus account
 */
export async function getOrCreateUserBonusAccount(
  userId: string,
  currency: string = 'USD'
): Promise<string> {
  const ledger = getLedger();
  const accountId = ledger.getUserAccountId(userId, 'bonus');
  
  // Check if account exists
  const account = await ledger.getAccount(accountId);
  if (account) {
    return accountId;
  }
  
  // Create user bonus account
  await ledger.createUserAccount(userId, 'bonus', currency, { allowNegative: false });
  logger.info('User bonus account created', { userId, currency, accountId });
  
  return accountId;
}

/**
 * Check if bonus pool has sufficient balance
 */
export async function checkBonusPoolBalance(
  amount: number,
  currency: string = 'USD'
): Promise<{ sufficient: boolean; available: number; required: number }> {
  const ledger = getLedger();
  const bonusPoolAccountId = ledger.getSystemAccountId('bonus_pool');
  
  const balance = await ledger.getBalance(bonusPoolAccountId);
  const available = balance.balance;
  const sufficient = available >= amount;
  
  if (!sufficient) {
    logger.warn('Insufficient bonus pool balance', {
      available,
      required: amount,
      currency,
      accountId: bonusPoolAccountId,
    });
  }
  
  return {
    sufficient,
    available,
    required: amount,
  };
}

/**
 * Record bonus award in ledger
 * Flow: Bonus Pool -> User Bonus Account
 */
export async function recordBonusAwardLedgerEntry(
  userId: string,
  amount: number,
  currency: string,
  tenantId: string,
  bonusId: string,
  bonusType: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Check balance first
  const balanceCheck = await checkBonusPoolBalance(amount, currency);
  if (!balanceCheck.sufficient) {
    throw new Error(
      `Insufficient bonus pool balance. Available: ${balanceCheck.available}, Required: ${balanceCheck.required}`
    );
  }
  
  // Get or create accounts
  const bonusPoolAccountId = ledger.getSystemAccountId('bonus_pool');
  const userBonusAccountId = await getOrCreateUserBonusAccount(userId, currency);
  
  // Record bonus award: Bonus Pool -> User Bonus Account
  const bonusTx = await ledger.createTransaction({
    type: 'bonus_credit',
    fromAccountId: bonusPoolAccountId,
    toAccountId: userBonusAccountId,
    amount,
    currency,
    description: description || `Bonus awarded: ${bonusType}`,
    initiatedBy: 'system',
    metadata: {
      userId,
      bonusId,
      bonusType,
      tenantId,
    },
  });
  
  logger.info('Bonus award recorded in ledger', {
    bonusTxId: bonusTx._id,
    userId,
    bonusId,
    bonusType,
    amount,
    currency,
  });
  
  return bonusTx._id;
}

/**
 * Record bonus conversion in ledger
 * Flow: User Bonus Account -> User Real Account
 */
export async function recordBonusConversionLedgerEntry(
  userId: string,
  amount: number,
  currency: string,
  tenantId: string,
  bonusId: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Get accounts
  const userBonusAccountId = ledger.getUserAccountId(userId, 'bonus');
  const userRealAccountId = ledger.getUserAccountId(userId, 'real');
  
  // Check bonus account balance
  const bonusBalance = await ledger.getBalance(userBonusAccountId);
  if (bonusBalance.balance < amount) {
    throw new Error(
      `Insufficient bonus balance. Available: ${bonusBalance.balance}, Required: ${amount}`
    );
  }
  
  // Record conversion: User Bonus -> User Real
  const conversionTx = await ledger.createTransaction({
    type: 'bonus_convert',
    fromAccountId: userBonusAccountId,
    toAccountId: userRealAccountId,
    amount,
    currency,
    description: description || `Bonus converted to real balance`,
    initiatedBy: userId,
    metadata: {
      userId,
      bonusId,
      tenantId,
    },
  });
  
  logger.info('Bonus conversion recorded in ledger', {
    conversionTxId: conversionTx._id,
    userId,
    bonusId,
    amount,
    currency,
  });
  
  return conversionTx._id;
}

/**
 * Record bonus forfeiture in ledger
 * Flow: User Bonus Account -> Bonus Pool (return funds)
 */
export async function recordBonusForfeitLedgerEntry(
  userId: string,
  amount: number,
  currency: string,
  tenantId: string,
  bonusId: string,
  reason: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Get accounts
  const userBonusAccountId = ledger.getUserAccountId(userId, 'bonus');
  const bonusPoolAccountId = ledger.getSystemAccountId('bonus_pool');
  
  // Check bonus account balance
  const bonusBalance = await ledger.getBalance(userBonusAccountId);
  const forfeitAmount = Math.min(amount, bonusBalance.balance);
  
  if (forfeitAmount <= 0) {
    throw new Error('No bonus balance to forfeit');
  }
  
  // Record forfeiture: User Bonus -> Bonus Pool (return funds)
  const forfeitTx = await ledger.createTransaction({
    type: 'bonus_forfeit',
    fromAccountId: userBonusAccountId,
    toAccountId: bonusPoolAccountId,
    amount: forfeitAmount,
    currency,
    description: description || `Bonus forfeited: ${reason}`,
    initiatedBy: 'system',
    metadata: {
      userId,
      bonusId,
      reason,
      tenantId,
    },
  });
  
  logger.info('Bonus forfeiture recorded in ledger', {
    forfeitTxId: forfeitTx._id,
    userId,
    bonusId,
    amount: forfeitAmount,
    currency,
    reason,
  });
  
  return forfeitTx._id;
}

/**
 * Get user bonus balance from ledger
 */
export async function getUserBonusBalance(
  userId: string,
  currency: string = 'USD'
): Promise<number> {
  try {
    const ledger = getLedger();
    const userBonusAccountId = ledger.getUserAccountId(userId, 'bonus');
    const balance = await ledger.getBalance(userBonusAccountId);
    return balance.balance;
  } catch (error) {
    // Account might not exist yet - return 0
    logger.debug('User bonus account not found, returning 0', { userId, currency });
    return 0;
  }
}

/**
 * Get bonus pool balance
 */
export async function getBonusPoolBalance(currency: string = 'USD'): Promise<number> {
  const ledger = getLedger();
  const bonusPoolAccountId = ledger.getSystemAccountId('bonus_pool');
  const balance = await ledger.getBalance(bonusPoolAccountId);
  return balance.balance;
}
