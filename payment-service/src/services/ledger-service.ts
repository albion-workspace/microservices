/**
 * Ledger Service Integration
 * 
 * Generic ledger system wrapper - handles user-to-user transactions only.
 * The ledger system is agnostic to business logic (payment gateway, provider, bonuses, etc.).
 * It only knows about:
 * - Users/accounts (with optional subtypes like 'main', 'bonus', 'real')
 * - Whether accounts can go negative (allowNegative flag)
 * - Transaction types (deposit, withdrawal, transfer, fee, etc.)
 * - Balance validation
 * 
 * Business logic (fees, bonuses, etc.) is handled by respective services.
 * This service provides generic accounting operations only.
 */

import { 
  createLedger, 
  getDatabase, 
  getClient, 
  logger, 
  type Ledger, 
  emit,
  findById,
} from 'core-service';
import { SYSTEM_CURRENCY } from '../constants.js';
import { convertCurrency, getExchangeRate } from './exchange-rate.js';

let ledgerInstance: Ledger | null = null;

/**
 * Initialize ledger system
 * Generic: All accounts are user accounts - no system accounts
 */
export async function initializeLedger(tenantId: string = 'default'): Promise<Ledger> {
  if (ledgerInstance) {
    return ledgerInstance;
  }

  const db = getDatabase();
  const client = getClient();

  // Generic: All accounts are user accounts - created on-demand
  ledgerInstance = createLedger({
    tenantId,
    db,
    client,
    systemAccounts: [], // No system accounts - everything is user accounts
  });

  await ledgerInstance.initialize();
  
  logger.info('Ledger initialized', { tenantId });
  
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
 * Initialize ledger and return instance (for recovery job setup)
 */
export async function initializeLedgerAndGetInstance(tenantId: string = 'default'): Promise<Ledger> {
  if (ledgerInstance) {
    return ledgerInstance;
  }
  return await initializeLedger(tenantId);
}

/**
 * Get or create user account
 * Generic: All accounts are user accounts - permissions determine allowNegative
 * Handles race conditions: if multiple concurrent calls try to create the same account,
 * only one succeeds and others retry the get operation.
 */
export async function getOrCreateUserAccount(
  userId: string,
  subtype: string = 'main',
  currency: string = SYSTEM_CURRENCY,
  allowNegative: boolean = false
): Promise<string> {
  const ledger = getLedger();
  const accountId = ledger.getUserAccountId(userId, subtype as any);
  
  // Check if account exists
  const account = await ledger.getAccount(accountId);
  if (account) {
    return accountId;
  }
  
  // Create user account with permission-based allowNegative
  // Handle race condition: if another concurrent call created it, catch duplicate key error
  try {
    await ledger.createUserAccount(userId, subtype as any, currency, { allowNegative });
    logger.info('User account created', { userId, subtype, currency, accountId, allowNegative });
  } catch (error: any) {
    // Use centralized duplicate key handler (optimized for sharding)
    const { isDuplicateKeyError, handleDuplicateKeyError } = await import('core-service');
    if (isDuplicateKeyError(error)) {
      // Account was created by concurrent call - verify it exists
      const existingAccount = await ledger.getAccount(accountId);
      if (existingAccount) {
        logger.debug('Account created by concurrent call, using existing', { userId, subtype, currency, accountId });
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
 * Check if user account has sufficient balance
 * Generic: Checks balance and validates against allowNegative permission
 * 
 * The ledger system doesn't know about business roles (provider, gateway, etc.).
 * It only checks the allowNegative flag from user permissions.
 * Business logic (which roles can go negative) is handled at the permission level.
 */
export async function checkUserBalance(
  userId: string,
  amount: number,
  currency: string = SYSTEM_CURRENCY,
  subtype: string = 'main'
): Promise<{ sufficient: boolean; available: number; required: number; allowNegative: boolean }> {
  const ledger = getLedger();
  
  // Query user permissions from auth_service database directly (microservices architecture)
  // Users are stored in auth_service, not duplicated in payment_service
  // We query the auth_service database directly since both services share MongoDB
  let permissions: Record<string, any> = {};
  let allowNegative = false;
  
  try {
    // Query auth_service database directly (both services share MongoDB instance)
    // Use getClient to access MongoDB, then switch to auth_service database
    const client = getClient();
    const authDb = client.db('auth_service');
    const authUsersCollection = authDb.collection('users');
    
    // Query user using generic findById utility from core-service
    let authUser: any = null;
    
    // Try findById first (handles both _id and id fields automatically)
    authUser = await findById(
      authUsersCollection,
      userId,
      {}
    );
    
    // If found, apply projection
    if (authUser) {
      authUser = {
        permissions: authUser.permissions,
        roles: authUser.roles,
        id: authUser.id,
        _id: authUser._id,
        email: authUser.email,
      };
    }
    
    // Fallback: try by email if userId looks like email
    if (!authUser && userId.includes('@')) {
      authUser = await authUsersCollection.findOne(
        { email: userId },
        { projection: { permissions: 1, roles: 1, id: 1, _id: 1, email: 1 } }
      );
    }
    
    logger.info('checkUserBalance - User lookup result', {
      userId,
      found: !!authUser,
      userEmail: authUser?.email,
      userIdInDoc: authUser?.id,
      user_idInDoc: authUser?._id?.toString(),
      permissions: authUser?.permissions,
      permissionsType: typeof authUser?.permissions,
      isArray: Array.isArray(authUser?.permissions),
      permissionsLength: Array.isArray(authUser?.permissions) ? authUser.permissions.length : 'N/A',
      permissionsSample: Array.isArray(authUser?.permissions) && authUser.permissions.length > 0 ? authUser.permissions[0] : 'N/A',
    });
    
    if (authUser?.permissions) {
      // Permissions can be stored as:
      // 1. Object: { allowNegative: true, acceptFee: true, ... }
      // 2. Array: ["allowNegative", "acceptFee", ...]
      if (Array.isArray(authUser.permissions)) {
        // Array format - check if "allowNegative" is in the array
        allowNegative = authUser.permissions.includes('allowNegative') || authUser.permissions.includes('*:*:*');
        permissions = { allowNegative };
        logger.info('Parsed permissions from array', {
          userId,
          permissionsArray: authUser.permissions,
          allowNegative,
        });
      } else if (typeof authUser.permissions === 'object') {
        // Object format
        permissions = authUser.permissions;
        allowNegative = permissions.allowNegative === true || permissions['*:*:*'] === true;
        logger.info('Parsed permissions from object', {
          userId,
          permissionsObject: permissions,
          allowNegative,
        });
      } else {
        permissions = {};
        allowNegative = false;
        logger.warn('Permissions is not array or object', {
          userId,
          permissionsType: typeof authUser.permissions,
          permissionsValue: authUser.permissions,
        });
      }
    } else {
      logger.error('User not found in auth_service or has no permissions', { 
        userId,
        userFound: !!authUser,
        hasPermissions: !!authUser?.permissions,
        userEmail: authUser?.email,
        user_id: authUser?._id?.toString(),
      });
      // Default to false if no permissions found
      allowNegative = false;
    }
  } catch (error: any) {
    // Auth service database not available or query failed
    logger.error('Could not fetch user permissions from auth_service database', { 
      userId, 
      error: error.message,
      stack: error.stack,
    });
    // Default to false (no negative balance allowed) if auth_service unavailable
    allowNegative = false;
  }
  
  // Get or create account with correct allowNegative flag
  const accountId = await getOrCreateUserAccount(userId, subtype, currency, allowNegative);
  
  const account = await ledger.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }
  
  // Update account's allowNegative if it doesn't match user permissions
  if (account.allowNegative !== allowNegative) {
    const db = getDatabase();
    await db.collection('ledger_accounts').updateOne(
      { accountId: accountId },
      { $set: { allowNegative } }
    );
    logger.info('Updated account allowNegative flag to match user permissions', {
      userId,
      accountId,
      allowNegative,
      previousValue: account.allowNegative,
    });
  }
  
  const { balance: availableBalance } = await ledger.getBalance(accountId);
  const available = availableBalance;
  const sufficient = allowNegative || available >= amount;
  
  // Log final result
  logger.info('checkUserBalance - Final result', {
    userId,
    allowNegative,
    sufficient,
    available,
    amount,
  });
  
  // Validate: Account cannot go negative if allowNegative is false
  // BUT: If account is already negative and we're checking for a new transaction,
  // we need to use the account's current allowNegative flag (which should match user permissions)
  // This prevents accounts that shouldn't be negative from going further negative
  const accountAllowNegative = account.allowNegative;
  if (available < 0 && !accountAllowNegative) {
    logger.error('Account is negative but allowNegative is false', {
      userId,
      balance: available,
      currency,
      subtype,
      accountAllowNegative,
      userAllowNegative: allowNegative,
    });
    throw new Error(`Account cannot go negative. Current balance: ${available}, Required: ${amount}`);
  }
  
  // If account is already negative but user permissions say it can go negative,
  // update the account flag to match (this handles cases where permissions changed)
  if (available < 0 && !accountAllowNegative && allowNegative) {
    logger.warn('Account is negative but flag is false, updating to match user permissions', {
      userId,
      balance: available,
      accountAllowNegative,
      userAllowNegative: allowNegative,
    });
    const db = getDatabase();
    await db.collection('ledger_accounts').updateOne(
      { accountId: accountId },
      { $set: { allowNegative: true } }
    );
  }
  
  return {
    sufficient,
    available,
    required: amount,
    allowNegative,
  };
}

/**
 * Record deposit in ledger
 * Generic: User-to-user transaction with multi-currency support
 * Flow: From User Account -> To User Account
 * 
 * Multi-currency support:
 * - If currencies differ, automatically converts using exchange rates
 * - Exchange rate is fetched from exchange-rate service (cached, manual override, or API)
 * - Both accounts maintain their native currencies
 */
export async function recordDepositLedgerEntry(
  fromUserId: string, // User providing the funds
  toUserId: string,   // User receiving the funds
  amount: number,
  feeAmount: number,
  currency: string, // Currency of the transaction (from user's currency)
  tenantId: string,
  externalRef: string, // ✅ CRITICAL: Now required (was optional)
  description?: string,
  toCurrency?: string // Optional: destination currency (if different from source)
): Promise<string> {
  // ✅ CRITICAL: Validate externalRef is provided
  if (!externalRef || externalRef.trim() === '') {
    throw new Error('externalRef is required for deposit transactions to prevent duplicates');
  }
  const ledger = getLedger();
  
  // Determine destination currency (defaults to source currency if not specified)
  const destinationCurrency = toCurrency || currency;
  
  // Check from user balance in source currency - permissions determine if negative is allowed
  const balanceCheck = await checkUserBalance(fromUserId, amount, currency, 'main');
  const { sufficient, allowNegative: fromAllowNegative, available } = balanceCheck;
  
  logger.info('recordDepositLedgerEntry - Balance check result', {
    fromUserId,
    amount,
    currency,
    sufficient,
    allowNegative: fromAllowNegative,
    available,
    willAllowNegative: fromAllowNegative,
    canProceed: sufficient || fromAllowNegative,
  });
  
  // Allow transaction if:
  // 1. Balance is sufficient (available >= amount), OR
  // 2. User has allowNegative permission (can go negative)
  if (!sufficient && !fromAllowNegative) {
    logger.error('Insufficient balance and allowNegative is false', {
      fromUserId,
      amount,
      available,
      allowNegative: fromAllowNegative,
      sufficient,
      balanceCheckResult: balanceCheck,
    });
    throw new Error(`Insufficient balance: ${available} < ${amount}`);
  }
  
  // Get or create accounts (each in their own currency)
  const fromAccountId = await getOrCreateUserAccount(fromUserId, 'main', currency, fromAllowNegative);
  const toAccountId = await getOrCreateUserAccount(toUserId, 'main', destinationCurrency, false);
  
  // Handle currency conversion if currencies differ
  let convertedAmount = amount;
  let convertedFeeAmount = feeAmount;
  let exchangeRate = 1.0;
  
  if (currency !== destinationCurrency) {
    // Convert amount to destination currency using exchange rate
    exchangeRate = await getExchangeRate(currency, destinationCurrency);
    convertedAmount = await convertCurrency(amount, currency, destinationCurrency);
    convertedFeeAmount = await convertCurrency(feeAmount, currency, destinationCurrency);
    
    logger.info('Currency conversion applied for deposit', {
      fromCurrency: currency,
      toCurrency: destinationCurrency,
      originalAmount: amount,
      convertedAmount,
      exchangeRate,
      fromUserId,
      toUserId,
    });
  }
  
  // Net amount (after fees) in destination currency - this is what the user receives
  const netAmount = convertedAmount - convertedFeeAmount;
  
  // IMPORTANT: Ledger requires same currency for both accounts in a transaction
  // For multi-currency support, we use a conversion account as intermediary
  // When currencies differ:
  // 1. Debit source account (source currency) -> conversion account (source currency)
  // 2. Credit conversion account (destination currency) -> destination account (destination currency)
  
  // Fees are handled at transaction level (stored in metadata, like exchange rates)
  // For deposits: Credit netAmount directly (amount - fee) to user account
  // Fee is deducted from the source amount before crediting to user
  
  let depositTx;
  
  if (currency !== destinationCurrency) {
    // Cross-currency deposit: use conversion accounts as intermediaries
    // Step 1: Create conversion accounts (one per currency)
    const sourceConversionAccountId = await getOrCreateUserAccount(`conversion-${currency}-${destinationCurrency}-source`, 'main', currency, true);
    const destConversionAccountId = await getOrCreateUserAccount(`conversion-${currency}-${destinationCurrency}-dest`, 'main', destinationCurrency, true);
    
    // Step 2: Debit source account in source currency (full amount including fee)
    await ledger.createTransaction({
      type: 'transfer',
      fromAccountId,
      toAccountId: sourceConversionAccountId,
      amount, // Original amount in source currency (includes fee)
      currency, // Source currency
      description: `Currency conversion debit: ${amount} ${currency}`,
      externalRef: `${externalRef}-conversion-debit`,
      initiatedBy: toUserId,
      metadata: {
        fromUserId,
        toUserId,
        originalCurrency: currency,
        originalAmount: amount,
        originalFeeAmount: feeAmount,
        exchangeRate,
        conversionType: 'cross-currency-deposit',
      },
    });
    
    // Step 3: Create main deposit transaction: conversion account (destination currency) -> destination account (destination currency)
    // Credit netAmount (amount - fee) to user account
    depositTx = await ledger.createTransaction({
      type: 'deposit',
      fromAccountId: destConversionAccountId, // Use conversion account in destination currency
      toAccountId,
      amount: netAmount, // Net amount after fees (convertedAmount - convertedFeeAmount)
      currency: destinationCurrency, // Use destination currency for transaction
      description: description || `Deposit of ${amount} ${currency} (converted to ${convertedAmount} ${destinationCurrency}, fee: ${convertedFeeAmount} ${destinationCurrency}, net: ${netAmount} ${destinationCurrency})`,
      externalRef,
      initiatedBy: toUserId,
      metadata: {
        fromUserId,
        toUserId,
        originalCurrency: currency,
        originalAmount: amount,
        originalFeeAmount: feeAmount,
        convertedAmount,
        convertedFeeAmount,
        feeAmount: convertedFeeAmount, // Store fee in transaction metadata for audit trail
        exchangeRate,
      },
    });
  } else {
    // Same currency: direct deposit
    // Credit netAmount (amount - fee) to user account
    depositTx = await ledger.createTransaction({
      type: 'deposit',
      fromAccountId,
      toAccountId,
      amount: netAmount, // Net amount after fees (convertedAmount - convertedFeeAmount)
      currency: destinationCurrency, // Same as source currency
      description: description || `Deposit of ${amount} ${currency} (fee: ${feeAmount} ${currency}, net: ${netAmount} ${currency})`,
      externalRef,
      initiatedBy: toUserId,
      metadata: {
        fromUserId,
        toUserId,
        feeAmount, // Store fee in transaction metadata for audit trail
      },
    });
  }
  
  logger.info('Deposit recorded in ledger', {
    depositTxId: depositTx._id,
    fromUserId,
    toUserId,
    amount: currency !== destinationCurrency ? `${amount} ${currency} -> ${convertedAmount} ${destinationCurrency}` : `${amount} ${currency}`,
    exchangeRate: currency !== destinationCurrency ? exchangeRate : undefined,
  });
  
  // Emit event for wallet balance sync (event-driven, no delays needed)
  // Works across containers/processes via Redis pub/sub - shared source of truth
  // Fire-and-forget: don't await to avoid blocking the deposit flow
  emit('ledger.deposit.completed', tenantId, toUserId, {
    depositTxId: depositTx._id,
    userId: toUserId,
    currency: destinationCurrency, // Use destination currency for event
    netAmount, // Calculated: convertedAmount - convertedFeeAmount
    accountId: toAccountId,
    // Only include conversion info if currencies differ
    ...(currency !== destinationCurrency ? {
      originalCurrency: currency,
      exchangeRate,
    } : {}),
  }).catch((eventError) => {
    // Don't fail deposit if event emission fails - sync can happen via query resolver
    logger.debug('Failed to emit deposit completion event (non-critical)', { error: eventError });
  });
  
  return depositTx._id;
}

// Removed checkUserWithdrawalBalance - use checkUserBalance instead

/**
 * Record withdrawal in ledger
 * Generic: User-to-user transaction with multi-currency support
 * Flow: From User Account -> To User Account
 * 
 * Multi-currency support:
 * - If currencies differ, automatically converts using exchange rates
 * - Exchange rate is fetched from exchange-rate service (cached, manual override, or API)
 * - Both accounts maintain their native currencies
 */
export async function recordWithdrawalLedgerEntry(
  fromUserId: string, // User withdrawing
  toUserId: string,   // Destination user
  amount: number,
  feeAmount: number,
  currency: string, // Currency of the transaction (from user's currency)
  tenantId: string,
  externalRef: string, // ✅ CRITICAL: Now required (was optional)
  description?: string,
  toCurrency?: string // Optional: destination currency (if different from source)
): Promise<string> {
  // ✅ CRITICAL: Validate externalRef is provided
  if (!externalRef || externalRef.trim() === '') {
    throw new Error('externalRef is required for withdrawal transactions to prevent duplicates');
  }
  const ledger = getLedger();
  
  // Determine destination currency (defaults to source currency if not specified)
  const destinationCurrency = toCurrency || currency;
  
  const totalAmount = amount + feeAmount;
  
  // Check from user balance in source currency - permissions determine if negative is allowed
  const { sufficient, allowNegative: fromAllowNegative, available } = await checkUserBalance(fromUserId, totalAmount, currency, 'main');
  if (!sufficient && !fromAllowNegative) {
    throw new Error(
      `Insufficient balance for withdrawal. Available: ${available}, Required: ${totalAmount}`
    );
  }
  
  // Get or create accounts (each in their own currency)
  const fromAccountId = await getOrCreateUserAccount(fromUserId, 'main', currency, fromAllowNegative);
  const toAccountId = await getOrCreateUserAccount(toUserId, 'main', destinationCurrency, true); // Receiving user can go negative
  
  // Handle currency conversion if currencies differ
  let convertedAmount = amount;
  let convertedFeeAmount = feeAmount;
  let convertedTotalAmount = totalAmount;
  let exchangeRate = 1.0;
  
  if (currency !== destinationCurrency) {
    // Convert amounts to destination currency using exchange rate
    exchangeRate = await getExchangeRate(currency, destinationCurrency);
    convertedAmount = await convertCurrency(amount, currency, destinationCurrency);
    convertedFeeAmount = await convertCurrency(feeAmount, currency, destinationCurrency);
    convertedTotalAmount = convertedAmount + convertedFeeAmount;
    
    logger.info('Currency conversion applied for withdrawal', {
      fromCurrency: currency,
      toCurrency: destinationCurrency,
      originalAmount: amount,
      convertedAmount,
      exchangeRate,
      fromUserId,
      toUserId,
    });
  }
  
  // IMPORTANT: Ledger requires same currency for both accounts in a transaction
  // For multi-currency support, we use a conversion account as intermediary
  // When currencies differ:
  // 1. Debit source account (source currency) -> conversion account (source currency)
  // 2. Credit conversion account (destination currency) -> destination account (destination currency)
  
  let withdrawalTx;
  
  if (currency !== destinationCurrency) {
    // Cross-currency withdrawal: use conversion accounts as intermediaries
    // Step 1: Create conversion accounts (one per currency)
    const sourceConversionAccountId = await getOrCreateUserAccount(`conversion-${currency}-${destinationCurrency}-source`, 'main', currency, true);
    const destConversionAccountId = await getOrCreateUserAccount(`conversion-${currency}-${destinationCurrency}-dest`, 'main', destinationCurrency, true);
    
    // Step 2: Debit source account in source currency
    await ledger.createTransaction({
      type: 'transfer',
      fromAccountId,
      toAccountId: sourceConversionAccountId,
      amount: totalAmount, // Original total amount in source currency
      currency, // Source currency
      description: `Currency conversion debit: ${totalAmount} ${currency}`,
      externalRef: `${externalRef}-conversion-debit`,
      initiatedBy: fromUserId,
      metadata: {
        fromUserId,
        toUserId,
        originalCurrency: currency,
        originalAmount: amount,
        originalFeeAmount: feeAmount,
        exchangeRate,
        conversionType: 'cross-currency-withdrawal',
      },
    });
    
    // Step 3: Create main withdrawal transaction: conversion account (destination currency) -> destination account (destination currency)
    withdrawalTx = await ledger.createTransaction({
      type: 'withdrawal',
      fromAccountId: destConversionAccountId, // Use conversion account in destination currency
      toAccountId,
      amount: convertedTotalAmount, // Use converted total amount in destination currency
      currency: destinationCurrency, // Use destination currency for transaction
      description: description || `Withdrawal of ${amount} ${currency} (converted to ${convertedAmount} ${destinationCurrency}, fee: ${convertedFeeAmount} ${destinationCurrency})`,
      externalRef,
      initiatedBy: fromUserId,
      metadata: {
        fromUserId,
        toUserId,
        originalCurrency: currency,
        originalAmount: amount,
        originalFeeAmount: feeAmount,
        convertedAmount,
        convertedFeeAmount,
        feeAmount: convertedFeeAmount, // Store fee in transaction metadata for audit trail
        exchangeRate,
      },
    });
  } else {
    // Same currency: direct withdrawal
    withdrawalTx = await ledger.createTransaction({
      type: 'withdrawal',
      fromAccountId,
      toAccountId,
      amount: convertedTotalAmount, // Same as original total amount
      currency: destinationCurrency, // Same as source currency
      description: description || `Withdrawal of ${amount} ${currency} (fee: ${feeAmount} ${currency})`,
      externalRef,
      initiatedBy: fromUserId,
      metadata: {
        fromUserId,
        toUserId,
        feeAmount, // Store fee in transaction metadata for audit trail
      },
    });
  }
  
  const { _id: withdrawalTxId } = withdrawalTx;
  
  logger.info('Withdrawal recorded in ledger', {
    withdrawalTxId,
    fromUserId,
    toUserId,
    amount: currency !== destinationCurrency ? `${amount} ${currency} -> ${convertedAmount} ${destinationCurrency}` : `${amount} ${currency}`,
    exchangeRate: currency !== destinationCurrency ? exchangeRate : undefined,
  });
  
  // Emit event for wallet balance sync (event-driven, no delays needed)
  // Works across containers/processes via Redis pub/sub - shared source of truth
  // Fire-and-forget: don't await to avoid blocking the withdrawal flow
  emit('ledger.withdrawal.completed', tenantId, fromUserId, {
    withdrawalTxId,
    fromUserId,
    toUserId,
    currency, // Use source currency for event (user's currency)
    totalAmount, // Use original total amount
    accountId: fromAccountId,
    // Only include conversion info if currencies differ
    ...(currency !== destinationCurrency ? {
      destinationCurrency,
      exchangeRate,
    } : {}),
  }).catch((eventError) => {
    // Don't fail withdrawal if event emission fails - sync can happen via query resolver
    logger.debug('Failed to emit withdrawal completion event (non-critical)', { error: eventError });
  });
  
  return withdrawalTx._id;
}

// Bonus-specific functions removed - use generic recordUserTransferLedgerEntry instead
// Bonus operations should be handled by bonus-service using generic ledger transfers

/**
 * Record user-to-user transfer (simplified funding)
 * Flow: From User Account -> To User Account
 * Simplified: Everything is user-to-user
 */
export async function recordUserTransferLedgerEntry(
  fromUserId: string,
  toUserId: string,
  amount: number,
  currency: string,
  tenantId: string,
  description?: string,
  externalRef?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Check from user balance - permissions determine if negative is allowed
  const { sufficient, allowNegative: fromAllowNegative, available } = await checkUserBalance(fromUserId, amount, currency, 'main');
  if (!sufficient && !fromAllowNegative) {
    throw new Error(`Insufficient balance: ${available} < ${amount}`);
  }
  
  // Get or create accounts
  const fromAccountId = await getOrCreateUserAccount(fromUserId, 'main', currency, fromAllowNegative);
  const toAccountId = await getOrCreateUserAccount(toUserId, 'main', currency, true); // Receiving user can go negative
  
  // Generate externalRef if not provided
  const txExternalRef = externalRef || `transfer-${fromUserId}-${toUserId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Record transfer: From User -> To User
  const transferTx = await ledger.createTransaction({
    type: 'transfer',
    fromAccountId,
    toAccountId,
    amount,
    currency,
    description: description || `Transfer from ${fromUserId} to ${toUserId}`,
    externalRef: txExternalRef,
    initiatedBy: fromUserId,
    metadata: {
      fromUserId,
      toUserId,
      tenantId,
    },
  });
  
  const { _id: transferTxId } = transferTx;
  
  logger.info('User transfer recorded in ledger', {
    transferTxId,
    fromUserId,
    toUserId,
    amount,
    currency,
  });
  
  return transferTx._id;
}

/**
 * Record wallet transaction in ledger (for bet, win, etc.)
 * Generic: User-to-user transactions only
 * Flow depends on transaction type:
 * - bet: User Account -> House User Account (house user can go negative)
 * - win: House User Account -> User Account
 * - refund: User Account -> User Account
 */
export async function recordWalletTransactionLedgerEntry(
  userId: string,
  transactionType: string,
  amount: number,
  currency: string,
  tenantId: string,
  walletTransactionId?: string,
  description?: string,
  houseUserId?: string // Optional: house user ID (defaults to 'house')
): Promise<string> {
  const ledger = getLedger();
  
  // Get user account
  const userAccountId = await getOrCreateUserAccount(userId, 'main', currency);
  
  // Determine source/destination based on transaction type
  const creditTypes = ['win', 'refund', 'transfer_in', 'release'];
  const isCredit = creditTypes.includes(transactionType);
  
  // House user (can go negative) - defaults to 'house' user
  const houseUser = houseUserId || 'house';
  const houseAccountId = await getOrCreateUserAccount(houseUser, 'main', currency, true); // House can go negative
  
  let fromAccountId: string;
  let toAccountId: string;
  
  if (isCredit) {
    // Credit to user: House User -> User
    fromAccountId = houseAccountId;
    toAccountId = userAccountId;
  } else {
    // Debit from user: User -> House User
    fromAccountId = userAccountId;
    toAccountId = houseAccountId;
  }
  
  // Check balance for debits
  if (!isCredit) {
    const { balance: availableBalance } = await ledger.getBalance(userAccountId);
    if (availableBalance < amount) {
      throw new Error(
        `Insufficient balance in ledger. Available: ${availableBalance}, Required: ${amount}`
      );
    }
  }
  
  // Create ledger transaction
  const externalRef = walletTransactionId || `wallet-tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const ledgerTx = await ledger.createTransaction({
    type: transactionType as any,
    fromAccountId,
    toAccountId,
    amount,
    currency,
    description: description || `${transactionType} transaction: ${amount} ${currency}`,
    externalRef,
    initiatedBy: userId,
    metadata: {
      userId,
      transactionType,
      walletTransactionId,
      tenantId,
    },
  });
  
  const { _id: ledgerTxId } = ledgerTx;
  
  logger.info('Wallet transaction recorded in ledger', {
    walletTransactionId,
    ledgerTxId,
    userId,
    transactionType,
    amount,
    currency,
    fromAccountId,
    toAccountId,
  });
  
  // Emit event for wallet balance sync
  emit('ledger.wallet.transaction.completed', tenantId, userId, {
    walletTransactionId,
    ledgerTxId,
    userId,
    currency,
    amount,
    accountId: userAccountId,
    transactionType,
  }).catch((eventError) => {
    logger.debug('Failed to emit wallet transaction completion event (non-critical)', { error: eventError });
  });
  
  return ledgerTxId;
}

/**
 * Sync wallet balance from ledger account
 * Generic: All wallets are user wallets - sync from user ledger account
 * This ensures wallet.balance matches ledger account balance
 * Also syncs bonusBalance from bonus account
 */
export async function syncWalletBalanceFromLedger(
  userId: string,
  walletId: string,
  currency: string
): Promise<void> {
  const ledger = getLedger();
  const db = getDatabase();
  
  try {
    // Sync main account balance
    const mainAccountId = await getOrCreateUserAccount(userId, 'main', currency);
    const { balance: ledgerBalance } = await ledger.getBalance(mainAccountId);
    
    // Sync bonus account balance
    let bonusBalance = 0;
    try {
      const bonusAccountId = await getOrCreateUserAccount(userId, 'bonus', currency);
      const { balance: ledgerBonusBalance } = await ledger.getBalance(bonusAccountId);
      bonusBalance = ledgerBonusBalance;
    } catch (bonusError) {
      // Bonus account might not exist yet - that's okay, bonusBalance stays 0
      logger.debug('Bonus account not found or error syncing bonus balance', {
        userId,
        currency,
        error: bonusError instanceof Error ? bonusError.message : String(bonusError),
      });
    }
    
    // Update wallet balances to match ledger
    await db.collection('wallets').updateOne(
      { id: walletId },
      {
        $set: {
          balance: ledgerBalance,
          bonusBalance: bonusBalance,
          updatedAt: new Date(),
        },
      }
    );
    
    logger.debug('User wallet balance synced from ledger', {
      walletId,
      userId,
      balance: ledgerBalance,
      bonusBalance,
      currency,
    });
  } catch (error) {
    logger.error('Failed to sync wallet balance from ledger', {
      error,
      walletId,
      userId,
      currency,
    });
    // Don't throw - sync failure shouldn't break the flow
  }
}
