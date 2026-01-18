/**
 * Ledger Service Integration for Bonus Service
 * 
 * Generic ledger wrapper - uses generic transfers for all bonus operations.
 * The ledger system is agnostic to business logic (bonuses, fees, etc.).
 * It only knows about:
 * - Users/accounts (with optional subtypes like 'main', 'bonus', 'real')
 * - Whether accounts can go negative (allowNegative flag)
 * - Transaction types (transfer, deposit, withdrawal, etc.)
 * - Balance validation
 * 
 * Business logic (bonus awards, conversions, forfeitures) is handled by bonus-service.
 * This service provides generic accounting operations only.
 */

import { createLedger, getDatabase, getClient, logger, type Ledger } from 'core-service';

let ledgerInstance: Ledger | null = null;

/**
 * MongoDB error type helper
 */
interface MongoError {
  code?: number;
  codeName?: string;
  message?: string;
}

/**
 * Check if error is a MongoDB duplicate key error
 */
function isDuplicateKeyError(error: unknown): error is MongoError {
  const mongoError = error as MongoError;
  return mongoError.code === 11000 || mongoError.codeName === 'DuplicateKey';
}

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
 * Handles race conditions: if multiple concurrent calls try to create the same account,
 * only one succeeds and others retry the get operation.
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
  // Handle race condition: if another concurrent call created it, catch duplicate key error
  try {
    await ledger.createUserAccount(userId, 'bonus', currency, { allowNegative: false });
    logger.info('User bonus account created', { userId, currency, accountId });
  } catch (error: unknown) {
    // MongoDB duplicate key error (E11000) - another concurrent call created it
    if (isDuplicateKeyError(error)) {
      // Retry get - account should exist now
      const existingAccount = await ledger.getAccount(accountId);
      if (existingAccount) {
        logger.debug('Account created by concurrent call, using existing', { userId, currency, accountId });
        return accountId;
      }
      // If still not found, rethrow the error
      throw new Error(`Failed to create account ${accountId} and account not found after duplicate key error`);
    }
    // Rethrow other errors
    throw error;
  }
  
  return accountId;
}

/**
 * Get or create bonus pool account
 * Bonus pool is a user account (user:bonus-pool:main), not a system account
 */
export async function getOrCreateBonusPoolAccount(
  currency: string = 'USD'
): Promise<string> {
  const ledger = getLedger();
  const accountId = ledger.getUserAccountId('bonus-pool', 'main');
  
  // Check if account exists
  const account = await ledger.getAccount(accountId);
  if (account) {
    return accountId;
  }
  
  // Create bonus pool account (can go negative to allow funding)
  try {
    await ledger.createUserAccount('bonus-pool', 'main', currency, { allowNegative: true });
    logger.info('Bonus pool account created', { currency, accountId });
  } catch (error: unknown) {
    // MongoDB duplicate key error (E11000) - another concurrent call created it
    if (isDuplicateKeyError(error)) {
      // Retry get - account should exist now
      const existingAccount = await ledger.getAccount(accountId);
      if (existingAccount) {
        logger.debug('Bonus pool account created by concurrent call, using existing', { currency, accountId });
        return accountId;
      }
      throw new Error(`Failed to create bonus pool account ${accountId} and account not found after duplicate key error`);
    }
    throw error;
  }
  
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
  const bonusPoolAccountId = await getOrCreateBonusPoolAccount(currency);
  
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
 * Record bonus award in ledger using generic transfer
 * Flow: Bonus Pool -> User Bonus Account
 * Uses generic 'transfer' type - business logic (bonus) is in metadata
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
  const bonusPoolAccountId = await getOrCreateBonusPoolAccount(currency);
  const userBonusAccountId = await getOrCreateUserBonusAccount(userId, currency);
  
  // Record bonus award using generic transfer: Bonus Pool -> User Bonus Account
  const bonusTx = await ledger.createTransaction({
    type: 'transfer',
    fromAccountId: bonusPoolAccountId,
    toAccountId: userBonusAccountId,
    amount,
    currency,
    description: description || `Bonus awarded: ${bonusType}`,
    externalRef: `bonus-award-${bonusId}-${Date.now()}`,
    initiatedBy: 'system',
    metadata: {
      userId,
      bonusId,
      bonusType,
      tenantId,
      transactionType: 'bonus_award',
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
 * Record bonus conversion in ledger using generic transfer
 * Flow: User Bonus Account -> User Real Account
 * Uses generic 'transfer' type - business logic (bonus conversion) is in metadata
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
  const userRealAccountId = ledger.getUserAccountId(userId, 'main'); // 'main' is the real balance account
  
  // Check bonus account balance
  const bonusBalance = await ledger.getBalance(userBonusAccountId);
  if (bonusBalance.balance < amount) {
    throw new Error(
      `Insufficient bonus balance. Available: ${bonusBalance.balance}, Required: ${amount}`
    );
  }
  
  // Record conversion using generic transfer: User Bonus -> User Real
  const conversionTx = await ledger.createTransaction({
    type: 'transfer',
    fromAccountId: userBonusAccountId,
    toAccountId: userRealAccountId,
    amount,
    currency,
    description: description || `Bonus converted to real balance`,
    externalRef: `bonus-convert-${bonusId}-${Date.now()}`,
    initiatedBy: userId,
    metadata: {
      userId,
      bonusId,
      tenantId,
      transactionType: 'bonus_conversion',
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
 * Record bonus forfeiture in ledger using generic transfer
 * Flow: User Bonus Account -> Bonus Pool (return funds)
 * Uses generic 'transfer' type - business logic (bonus forfeiture) is in metadata
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
  const bonusPoolAccountId = await getOrCreateBonusPoolAccount(currency);
  
  // Check bonus account balance
  const bonusBalance = await ledger.getBalance(userBonusAccountId);
  const forfeitAmount = Math.min(amount, bonusBalance.balance);
  
  if (forfeitAmount <= 0) {
    throw new Error('No bonus balance to forfeit');
  }
  
  // Record forfeiture using generic transfer: User Bonus -> Bonus Pool (return funds)
  const forfeitTx = await ledger.createTransaction({
    type: 'transfer',
    fromAccountId: userBonusAccountId,
    toAccountId: bonusPoolAccountId,
    amount: forfeitAmount,
    currency,
    description: description || `Bonus forfeited: ${reason}`,
    externalRef: `bonus-forfeit-${bonusId}-${Date.now()}`,
    initiatedBy: 'system',
    metadata: {
      userId,
      bonusId,
      reason,
      tenantId,
      transactionType: 'bonus_forfeit',
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
  const bonusPoolAccountId = await getOrCreateBonusPoolAccount(currency);
  const balance = await ledger.getBalance(bonusPoolAccountId);
  return balance.balance;
}
