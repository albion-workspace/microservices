/**
 * Ledger Service Integration
 * 
 * Wraps the core-service ledger system for payment service use.
 * Provides helper methods for common payment operations.
 */

import { createLedger, getDatabase, getClient, logger, type Ledger, type CreateTransactionInput, emit } from 'core-service';
import { SYSTEM_ROLE } from '../constants.js';

let ledgerInstance: Ledger | null = null;

/**
 * Initialize ledger system for payment service
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
  
  logger.info('Payment ledger initialized', { tenantId });
  
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
 * Get or create provider account
 */
export async function getOrCreateProviderAccount(
  providerId: string,
  subtype: 'deposit' | 'withdrawal',
  currency: string = 'USD'
): Promise<string> {
  const ledger = getLedger();
  const accountId = ledger.getProviderAccountId(providerId, subtype);
  
  // Check if account exists
  const account = await ledger.getAccount(accountId);
  if (account) {
    return accountId;
  }
  
  // Create provider account - handle race conditions
  try {
    await ledger.createProviderAccount(providerId, subtype, currency);
    logger.info('Provider account created', { providerId, subtype, currency, accountId });
  } catch (error: any) {
    // If account was created by another concurrent request, that's fine
    if (error.code === 11000 || error.message?.includes('duplicate key') || error.message?.includes('E11000')) {
      // Account already exists (race condition) - verify it exists
      const existingAccount = await ledger.getAccount(accountId);
      if (existingAccount) {
        logger.debug('Provider account already exists (race condition)', { providerId, subtype, accountId });
        return accountId;
      }
    }
    // Re-throw if it's a different error
    throw error;
  }
  
  return accountId;
}

/**
 * Get or create user account (maps to wallet)
 */
export async function getOrCreateUserAccount(
  userId: string,
  subtype: 'real' | 'bonus' | 'locked',
  currency: string = 'USD'
): Promise<string> {
  const ledger = getLedger();
  const accountId = ledger.getUserAccountId(userId, subtype);
  
  // Check if account exists
  const account = await ledger.getAccount(accountId);
  if (account) {
    return accountId;
  }
  
  // Create user account
  await ledger.createUserAccount(userId, subtype, currency, { allowNegative: false });
  logger.info('User account created', { userId, subtype, currency, accountId });
  
  return accountId;
}

/**
 * Check if provider account has sufficient balance for deposit
 * Providers can go negative (receivables), but we should track it
 */
export async function checkProviderDepositBalance(
  providerId: string,
  amount: number,
  currency: string = 'USD'
): Promise<{ sufficient: boolean; available: number; required: number }> {
  const ledger = getLedger();
  const providerAccountId = await getOrCreateProviderAccount(providerId, 'deposit', currency);
  
  const balance = await ledger.getBalance(providerAccountId);
  // Providers can go negative (receivables), but we log it
  const available = balance.balance;
  const sufficient = true; // Providers can go negative
  
  if (available < 0) {
    logger.warn('Provider deposit account is negative (receivables)', {
      providerId,
      balance: available,
      currency,
    });
  }
  
  return {
    sufficient,
    available,
    required: amount,
  };
}

/**
 * Record deposit in ledger
 * Flow: Provider Account (deposit) -> User Account (real)
 */
export async function recordDepositLedgerEntry(
  providerId: string,
  userId: string,
  amount: number,
  feeAmount: number,
  currency: string,
  tenantId: string,
  externalRef?: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Check provider balance (informational - providers can go negative)
  await checkProviderDepositBalance(providerId, amount, currency);
  
  // Get or create accounts
  const providerAccountId = await getOrCreateProviderAccount(providerId, 'deposit', currency);
  const userAccountId = await getOrCreateUserAccount(userId, 'real', currency);
  
  // Net amount (after fees)
  const netAmount = amount - feeAmount;
  
  // Record deposit: Provider -> User
  const depositTx = await ledger.createTransaction({
    type: 'deposit',
    fromAccountId: providerAccountId,
    toAccountId: userAccountId,
    amount: netAmount,
    currency,
    description: description || `Deposit of ${amount} ${currency} (fee: ${feeAmount})`,
    externalRef,
    initiatedBy: userId,
    metadata: {
      providerId,
      userId,
      grossAmount: amount,
      feeAmount,
      netAmount,
    },
  });
  
  // Record fee: User -> Fee Collection
  if (feeAmount > 0) {
    const feeAccountId = ledger.getSystemAccountId('fee_collection');
    
    // Ensure fee collection account exists (create lazily if needed)
    // Check if account exists first, then create if needed
    let feeAccount = await ledger.getAccount(feeAccountId);
    if (!feeAccount) {
      // Use updateOne with upsert to avoid race conditions
      const db = getDatabase();
      try {
        await db.collection('ledger_accounts').updateOne(
          { _id: feeAccountId as any },
          {
            $setOnInsert: {
              _id: feeAccountId as any,
              tenantId,
              type: 'system',
              subtype: 'fee_collection',
              currency,
              balance: 0,
              availableBalance: 0,
              pendingIn: 0,
              pendingOut: 0,
              allowNegative: false,
              status: 'active',
              lastEntrySequence: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
        // Re-check if account was created
        feeAccount = await ledger.getAccount(feeAccountId);
      } catch (upsertError: any) {
        // If duplicate key error, account was created by another request
        if (upsertError.code === 11000 || upsertError.message?.includes('duplicate key') || upsertError.message?.includes('E11000')) {
          feeAccount = await ledger.getAccount(feeAccountId);
          if (!feeAccount) {
            throw new Error(`Fee collection account creation failed: ${upsertError.message}`);
          }
        } else {
          throw upsertError;
        }
      }
    }
    
    if (!feeAccount) {
      throw new Error(`Fee collection account not found: ${feeAccountId}`);
    }
    
    // Fee transaction should have externalRef to avoid duplicate key errors
    // Use deposit transaction ID with suffix to make it unique
    const feeExternalRef = externalRef ? `${externalRef}-fee` : `${depositTx._id}-fee`;
    
    await ledger.createTransaction({
      type: 'fee',
      fromAccountId: userAccountId,
      toAccountId: feeAccountId,
      amount: feeAmount,
      currency,
      description: `Deposit fee: ${feeAmount} ${currency}`,
      externalRef: feeExternalRef,
      initiatedBy: 'system',
      metadata: {
        providerId,
        userId,
        parentTxId: depositTx._id,
        relatedDeposit: depositTx._id,
      },
    });
  }
  
  logger.info('Deposit recorded in ledger', {
    depositTxId: depositTx._id,
    providerId,
    userId,
    amount,
    feeAmount,
    netAmount,
  });
  
  // Emit event for wallet balance sync (event-driven, no delays needed)
  // Works across containers/processes via Redis pub/sub - shared source of truth
  // Fire-and-forget: don't await to avoid blocking the deposit flow
  emit('ledger.deposit.completed', tenantId, userId, {
    depositTxId: depositTx._id,
    userId,
    currency,
    netAmount,
    accountId: userAccountId,
  }).catch((eventError) => {
    // Don't fail deposit if event emission fails - sync can happen via query resolver
    logger.debug('Failed to emit deposit completion event (non-critical)', { error: eventError });
  });
  
  return depositTx._id;
}

/**
 * Check if user has sufficient balance for withdrawal
 */
export async function checkUserWithdrawalBalance(
  userId: string,
  amount: number,
  feeAmount: number,
  currency: string = 'USD'
): Promise<{ sufficient: boolean; available: number; required: number }> {
  const ledger = getLedger();
  const userAccountId = await getOrCreateUserAccount(userId, 'real', currency);
  
  const balance = await ledger.getBalance(userAccountId);
  const available = balance.balance;
  const totalRequired = amount + feeAmount;
  const sufficient = available >= totalRequired;
  
  if (!sufficient) {
    logger.warn('Insufficient user balance for withdrawal', {
      userId,
      available,
      required: totalRequired,
      currency,
    });
  }
  
  return {
    sufficient,
    available,
    required: totalRequired,
  };
}

/**
 * Record withdrawal in ledger
 * Flow: User Account (real) -> Provider Account (withdrawal)
 */
export async function recordWithdrawalLedgerEntry(
  providerId: string,
  userId: string,
  amount: number,
  feeAmount: number,
  currency: string,
  tenantId: string,
  externalRef?: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Check user balance BEFORE recording (ledger will also check, but we want early validation)
  const balanceCheck = await checkUserWithdrawalBalance(userId, amount, feeAmount, currency);
  if (!balanceCheck.sufficient) {
    throw new Error(
      `Insufficient balance for withdrawal. Available: ${balanceCheck.available}, Required: ${balanceCheck.required}`
    );
  }
  
  // Get or create accounts
  const providerAccountId = await getOrCreateProviderAccount(providerId, 'withdrawal', currency);
  const userAccountId = await getOrCreateUserAccount(userId, 'real', currency);
  
  // Total amount (amount + fee)
  const totalAmount = amount + feeAmount;
  
  // Record withdrawal: User -> Provider
  // Ledger will validate balance again (double-check)
  const withdrawalTx = await ledger.createTransaction({
    type: 'withdrawal',
    fromAccountId: userAccountId,
    toAccountId: providerAccountId,
    amount: totalAmount,
    currency,
    description: description || `Withdrawal of ${amount} ${currency} (fee: ${feeAmount})`,
    externalRef,
    initiatedBy: userId,
    metadata: {
      providerId,
      userId,
      withdrawalAmount: amount,
      feeAmount,
      totalAmount,
    },
  });
  
  logger.info('Withdrawal recorded in ledger', {
    withdrawalTxId: withdrawalTx._id,
    providerId,
    userId,
    amount,
    feeAmount,
    totalAmount,
  });
  
  // Emit event for wallet balance sync (event-driven, no delays needed)
  // Works across containers/processes via Redis pub/sub - shared source of truth
  // Fire-and-forget: don't await to avoid blocking the withdrawal flow
  emit('ledger.withdrawal.completed', tenantId, userId, {
    withdrawalTxId: withdrawalTx._id,
    userId,
    currency,
    totalAmount,
    accountId: userAccountId,
  }).catch((eventError) => {
    // Don't fail withdrawal if event emission fails - sync can happen via query resolver
    logger.debug('Failed to emit withdrawal completion event (non-critical)', { error: eventError });
  });
  
  return withdrawalTx._id;
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
  const userBonusAccountId = await getOrCreateUserAccount(userId, 'bonus', currency);
  const userRealAccountId = await getOrCreateUserAccount(userId, 'real', currency);
  
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
  const userBonusAccountId = await getOrCreateUserAccount(userId, 'bonus', currency);
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
 * Record system funding of provider in ledger
 * Flow: System House Account -> Provider Account (deposit)
 * This is used when admins manually fund providers
 */
export async function recordSystemFundProviderLedgerEntry(
  providerId: string,
  amount: number,
  currency: string,
  tenantId: string,
  description?: string,
  walletTransactionId?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Get or create provider account
  const providerAccountId = await getOrCreateProviderAccount(providerId, 'deposit', currency);
  
  // Always use currency-specific system house account to avoid currency mismatches
  // Format: system:house:{currency}:{tenantId}
  const systemAccountId = `system:house:${currency.toLowerCase()}:${tenantId}`;
  
  // Check if currency-specific system account exists
  let systemAccount = await ledger.getAccount(systemAccountId);
  
  if (!systemAccount) {
    // Create currency-specific system house account
    // Use upsert to handle race conditions
    const db = getDatabase();
    try {
      await db.collection('ledger_accounts').updateOne(
        { _id: systemAccountId as any },
        {
          $setOnInsert: {
            _id: systemAccountId as any,
            tenantId,
            type: 'system',
            subtype: 'house',
            currency,
            balance: 0,
            availableBalance: 0,
            pendingIn: 0,
            pendingOut: 0,
            allowNegative: true,
            status: 'active',
            lastEntrySequence: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      // Re-fetch to get the created account
      systemAccount = await ledger.getAccount(systemAccountId);
      if (systemAccount) {
        logger.info('Created currency-specific system house account', { currency, accountId: systemAccountId });
      }
    } catch (upsertError: any) {
      // If duplicate key error, account was created by another request
      if (upsertError.code === 11000 || upsertError.message?.includes('duplicate key') || upsertError.message?.includes('E11000')) {
        systemAccount = await ledger.getAccount(systemAccountId);
        if (systemAccount) {
          logger.debug('Currency-specific system house account already exists (race condition)', { currency, accountId: systemAccountId });
        }
      } else {
        throw upsertError;
      }
    }
  }
  
  // Verify the account currency matches (safety check)
  if (systemAccount && systemAccount.currency !== currency) {
    throw new Error(`System house account currency mismatch: expected ${currency}, got ${systemAccount.currency}`);
  }
  
  if (!systemAccount) {
    throw new Error(`Failed to get or create system house account for currency ${currency}`);
  }
  
  // Verify provider account exists
  const providerAccount = await ledger.getAccount(providerAccountId);
  if (!providerAccount) {
    throw new Error(`Provider account not found: ${providerAccountId}`);
  }
  
  logger.info('Creating ledger transaction for provider funding', {
    systemAccountId,
    systemAccountCurrency: systemAccount.currency,
    providerAccountId,
    providerAccountCurrency: providerAccount.currency,
    amount,
    currency,
  });
  
  // Record funding: System House -> Provider
  // Always provide externalRef to avoid duplicate key errors
  const externalRef = walletTransactionId || `provider-funding-${providerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  let fundingTx;
  try {
    fundingTx = await ledger.createTransaction({
      type: 'transfer', // System transfer to provider
      fromAccountId: systemAccountId,
      toAccountId: providerAccountId,
      amount,
      currency,
      description: description || `System funding to provider ${providerId}`,
      externalRef, // Always provide externalRef to avoid duplicate key errors
      initiatedBy: 'system',
      metadata: {
        providerId,
        tenantId,
        fundingType: 'provider',
        walletTransactionId,
      },
    });
    
    logger.info('System funding recorded in ledger', {
      fundingTxId: fundingTx._id,
      providerId,
      amount,
      currency,
      systemAccountId,
      providerAccountId,
    });
  } catch (txError: any) {
    logger.error('Failed to create ledger transaction', {
      error: txError.message,
      stack: txError.stack,
      systemAccountId,
      providerAccountId,
      amount,
      currency,
    });
    throw txError;
  }
  
  return fundingTx._id;
}

/**
 * Record wallet transaction in ledger (for bet, win, etc.)
 * For betting/casino operations, records the transaction in ledger
 * Flow depends on transaction type:
 * - bet: User Account (real) -> System House Account
 * - win: System House Account -> User Account (real)
 * - refund: Provider/System Account -> User Account (real)
 */
export async function recordWalletTransactionLedgerEntry(
  userId: string,
  transactionType: string,
  amount: number,
  currency: string,
  tenantId: string,
  walletTransactionId?: string,
  description?: string
): Promise<string> {
  const ledger = getLedger();
  
  // Get user account
  const userAccountId = await getOrCreateUserAccount(userId, 'real', currency);
  
  // Determine source/destination based on transaction type
  const creditTypes = ['win', 'refund', 'transfer_in', 'release'];
  const isCredit = creditTypes.includes(transactionType);
  
  let fromAccountId: string;
  let toAccountId: string;
  
  if (isCredit) {
    // Credit to user: System House -> User
    // Use currency-specific system house account
    const systemAccountId = `system:house:${currency.toLowerCase()}:${tenantId}`;
    let systemAccount = await ledger.getAccount(systemAccountId);
    
    if (!systemAccount) {
      // Fall back to default system account
      const defaultAccountId = ledger.getSystemAccountId('house');
      systemAccount = await ledger.getAccount(defaultAccountId);
      if (systemAccount) {
        fromAccountId = defaultAccountId;
      } else {
        // Create currency-specific system account if needed
        const db = getDatabase();
        await db.collection('ledger_accounts').updateOne(
          { _id: systemAccountId as any },
          {
            $setOnInsert: {
              _id: systemAccountId as any,
              tenantId,
              type: 'system',
              subtype: 'house',
              currency,
              balance: 0,
              availableBalance: 0,
              pendingIn: 0,
              pendingOut: 0,
              allowNegative: true,
              status: 'active',
              lastEntrySequence: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
        fromAccountId = systemAccountId;
      }
    } else {
      fromAccountId = systemAccountId;
    }
    
    toAccountId = userAccountId;
  } else {
    // Debit from user: User -> System House
    fromAccountId = userAccountId;
    
    // Use currency-specific system house account
    const systemAccountId = `system:house:${currency.toLowerCase()}:${tenantId}`;
    let systemAccount = await ledger.getAccount(systemAccountId);
    
    if (!systemAccount) {
      // Fall back to default system account
      const defaultAccountId = ledger.getSystemAccountId('house');
      systemAccount = await ledger.getAccount(defaultAccountId);
      if (systemAccount) {
        toAccountId = defaultAccountId;
      } else {
        // Create currency-specific system account if needed
        const db = getDatabase();
        await db.collection('ledger_accounts').updateOne(
          { _id: systemAccountId as any },
          {
            $setOnInsert: {
              _id: systemAccountId as any,
              tenantId,
              type: 'system',
              subtype: 'house',
              currency,
              balance: 0,
              availableBalance: 0,
              pendingIn: 0,
              pendingOut: 0,
              allowNegative: true,
              status: 'active',
              lastEntrySequence: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
        toAccountId = systemAccountId;
      }
    } else {
      toAccountId = systemAccountId;
    }
  }
  
  // Check balance for debits
  if (!isCredit) {
    const balance = await ledger.getBalance(userAccountId);
    if (balance.balance < amount) {
      throw new Error(
        `Insufficient balance in ledger. Available: ${balance.balance}, Required: ${amount}`
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
  
  logger.info('Wallet transaction recorded in ledger', {
    walletTransactionId,
    ledgerTxId: ledgerTx._id,
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
    ledgerTxId: ledgerTx._id,
    userId,
    currency,
    amount,
    accountId: userAccountId,
    transactionType,
  }).catch((eventError) => {
    logger.debug('Failed to emit wallet transaction completion event (non-critical)', { error: eventError });
  });
  
  return ledgerTx._id;
}

/**
 * Sync wallet balance from ledger account
 * This ensures wallet.balance matches ledger account balance
 */
export async function syncWalletBalanceFromLedger(
  userId: string,
  walletId: string,
  currency: string
): Promise<void> {
  const ledger = getLedger();
  const db = getDatabase();
  
  try {
    // Check if this is a provider wallet (userId starts with "provider-")
    const isProviderWallet = userId.startsWith('provider-');
    
    if (isProviderWallet) {
      // For provider wallets, sync from provider ledger account
      const providerId = userId;
      const providerAccountId = await getOrCreateProviderAccount(providerId, 'deposit', currency);
      const balance = await ledger.getBalance(providerAccountId);
      
      // Update wallet balance to match ledger
      await db.collection('wallets').updateOne(
        { id: walletId },
        {
          $set: {
            balance: balance.balance,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.debug('Provider wallet balance synced from ledger', {
        walletId,
        providerId,
        balance: balance.balance,
      });
    } else {
      // Check if this is a system user wallet (user has 'system' role)
      // Query the user's roles from auth_service database (optimized: only fetch roles field)
      const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { roles: 1 } } // Only fetch roles field for performance
      );
      const isSystemUser = user?.roles?.includes(SYSTEM_ROLE);
      
      if (isSystemUser) {
        // For system wallet, sync from currency-specific system house account
        // Get wallet to determine currency (optimized: only fetch needed fields)
        const wallet = await db.collection('wallets').findOne(
          { id: walletId },
          { projection: { currency: 1, tenantId: 1 } } // Only fetch needed fields
        );
        if (!wallet) {
          logger.debug('System wallet not found for sync', { walletId });
          return;
        }
        
        const walletCurrency = (wallet as any).currency || 'USD';
        const tenantId = (wallet as any).tenantId || 'default-tenant';
        
        // Use currency-specific system account (e.g., system:house:eur:default-tenant)
        const systemAccountId = `system:house:${walletCurrency.toLowerCase()}:${tenantId}`;
        
        try {
          // Check if currency-specific account exists, fall back to default if not
          let systemAccount = await ledger.getAccount(systemAccountId);
          let accountIdToUse = systemAccountId;
          
          if (!systemAccount) {
            // Try default system account as fallback
            const defaultAccountId = ledger.getSystemAccountId('house');
            systemAccount = await ledger.getAccount(defaultAccountId);
            if (systemAccount) {
              accountIdToUse = defaultAccountId;
              logger.debug('Using default system account (currency-specific not found)', {
                walletCurrency,
                accountId: accountIdToUse,
              });
            }
          }
          
          if (!systemAccount) {
            logger.debug('System account not found, wallet balance will remain as is', {
              walletId,
              currency: walletCurrency,
              accountId: systemAccountId,
            });
            return;
          }
          
          const balance = await ledger.getBalance(accountIdToUse);
          
          // Update wallet balance to match ledger
          await db.collection('wallets').updateOne(
            { id: walletId },
            {
              $set: {
                balance: balance.balance,
                updatedAt: new Date(),
              },
            }
          );
          
          logger.debug('System wallet balance synced from ledger', {
            walletId,
            userId,
            currency: walletCurrency,
            accountId: accountIdToUse,
            balance: balance.balance,
          });
        } catch (systemError) {
          // System account might not exist yet - that's ok
          logger.debug('Could not sync system wallet balance (account may not exist yet)', {
            walletId,
            userId,
            currency: walletCurrency,
            accountId: systemAccountId,
            error: systemError instanceof Error ? systemError.message : String(systemError),
          });
        }
        return; // Exit early for system wallets
      }
      
      // For regular user wallets, sync from user ledger account
      // Ensure account exists first (it should be created during deposit/transaction)
      const userAccountId = await getOrCreateUserAccount(userId, 'real', currency);
      try {
        const balance = await ledger.getBalance(userAccountId);
        
        // Update wallet balance to match ledger (single atomic operation - no verification query needed)
        const updateResult = await db.collection('wallets').updateOne(
          { id: walletId },
          {
            $set: {
              balance: balance.balance,
              updatedAt: new Date(),
            },
          }
        );
        
        if (updateResult.matchedCount === 0) {
          logger.error('Wallet not found for sync', { walletId, userId, currency });
          throw new Error(`Wallet not found: ${walletId}`);
        }
        
        // Log sync result (info level for critical operations, debug for routine syncs)
        if (updateResult.modifiedCount > 0) {
          logger.info('Wallet balance synced from ledger', {
            walletId,
            userId,
            accountId: userAccountId,
            ledgerBalance: balance.balance,
            currency,
          });
        } else {
          logger.debug('Wallet balance already in sync with ledger', {
            walletId,
            userId,
            accountId: userAccountId,
            ledgerBalance: balance.balance,
            currency,
          });
        }
      } catch (userError) {
        // Log error with full context for debugging
        logger.error('Could not sync user wallet balance from ledger', {
          walletId,
          userId,
          accountId: userAccountId,
          currency,
          error: userError instanceof Error ? userError.message : String(userError),
          stack: userError instanceof Error ? userError.stack : undefined,
        });
        throw userError; // Re-throw to allow retry logic to work
      }
    }
  } catch (error) {
    // General error handling
    logger.warn('Error syncing wallet balance from ledger', {
      walletId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
