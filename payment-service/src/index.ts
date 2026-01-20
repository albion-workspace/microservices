/**
 * Payment Service - Generic user-to-user transaction processing
 * 
 * Generic payment service that handles:
 * - User-to-user deposits and withdrawals
 * - Multi-currency wallet management
 * - Transaction history & tracking
 * - Saga-based rollback for atomic operations
 * - Event-driven balance synchronization
 * 
 * The service is agnostic to business logic (gateway, provider, etc.).
 * It only knows about users, amounts, currencies, and permissions.
 */

import {
  createGateway,
  // Permission helpers (native, no graphql-shield)
  hasRole,
  hasAnyRole,
  isAuthenticated,
  allow,
  logger,
  // Cross-service integration
  on,
  startListening,
  getDatabase,
  getClient,
  type IntegrationEvent,
  // Webhooks - plug-and-play service
  createWebhookService,
  type ResolverContext,
  findOneById,
  generateMongoId,
} from 'core-service';
import { initializeLedger, syncWalletBalanceFromLedger } from './services/ledger-service.js';

// Import unified event dispatcher (handles both internal events + webhooks)
import {
  paymentWebhooks,
  emitPaymentEvent,
  initializePaymentWebhooks,
  cleanupPaymentWebhookDeliveries,
  type PaymentWebhookEvents,
} from './event-dispatcher.js';

// Re-export for consumers
export { emitPaymentEvent, type PaymentWebhookEvents };

/**
 * Complete webhook service - ready to plug into gateway.
 * Single line to add webhooks to any service!
 */
const webhookService = createWebhookService({
  manager: paymentWebhooks,
  eventsDocs: `
    Payment Service Webhook Events:
    • wallet.created - New wallet created
    • wallet.updated - Wallet settings changed
    • wallet.deposit.initiated - Deposit started
    • wallet.deposit.completed - Deposit successful
    • wallet.deposit.failed - Deposit failed
    • wallet.withdrawal.initiated - Withdrawal requested
    • wallet.withdrawal.completed - Withdrawal processed
    • wallet.withdrawal.failed - Withdrawal failed
    • wallet.transfer.completed - Internal transfer completed
    • wallet.* - All wallet events (wildcard)
  `,
});

import { 
  depositService,
  withdrawalService,
  transactionApprovalResolvers,
} from './services/transaction.js';

import {
  walletService,
  walletTransactionService,
  userWalletResolvers,
} from './services/wallet.js';
import { ledgerResolvers, ledgerTypes } from './services/ledger-resolvers.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

import { SYSTEM_ROLE, SYSTEM_CURRENCY } from './constants.js';
export { SYSTEM_ROLE };

/**
 * Get bonus-pool user ID from auth database
 * Bonus-pool is a registered user (bonus-pool@system.com), not a string literal
 */
async function getBonusPoolUserId(): Promise<string> {
  try {
    const client = getClient();
    const authDb = client.db('auth_service');
    const usersCollection = authDb.collection('users');
    
    // Look up bonus-pool user by email
    const bonusPoolUser = await usersCollection.findOne({ email: 'bonus-pool@system.com' });
    
    if (!bonusPoolUser) {
      // Fallback: if user doesn't exist, log warning and return the string (for backward compatibility)
      logger.warn('Bonus-pool user not found in auth database, using string literal as fallback');
      return 'bonus-pool';
    }
    
    return bonusPoolUser._id?.toString() || bonusPoolUser.id;
  } catch (error) {
    logger.error('Failed to get bonus-pool user ID', { error });
    // Fallback to string literal for backward compatibility
    return 'bonus-pool';
  }
}


const config = {
  name: 'payment-service',
  port: parseInt(process.env.PORT || '3002'),
  cors: {
    origins: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  },
  jwt: {
    secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
    expiresIn: '8h',
  },
  services: [
    { name: 'deposit', types: depositService.types, resolvers: depositService.resolvers },
    { name: 'withdrawal', types: withdrawalService.types, resolvers: withdrawalService.resolvers },
    { 
      name: 'wallet', 
      types: walletService.types, 
      resolvers: {
        Query: {
          ...walletService.resolvers.Query,
          wallets: async (args: Record<string, unknown>, ctx: any) => {
            // Call the default wallets resolver
            const result: any = await walletService.resolvers.Query.wallets(args, ctx);
            
            // Sync ALL wallets from ledger before returning (provider, system, and regular user wallets)
            if (result && result.nodes && Array.isArray(result.nodes)) {
              const db = getDatabase();
              const syncPromises = result.nodes.map(async (wallet: any) => {
                const isProviderWallet = wallet.userId?.startsWith('provider-');
                
                // Check if wallet belongs to a user with 'system' role (optimized: only fetch roles)
                let isSystemWallet = false;
                if (!isProviderWallet && wallet.userId) {
                  const user = await db.collection('users').findOne(
                    { id: wallet.userId },
                    { projection: { roles: 1 } } // Only fetch roles field for performance
                  );
                  isSystemWallet = user?.roles?.includes(SYSTEM_ROLE) || false;
                }
                
                // Sync ALL wallets from ledger (provider, system, and regular user wallets)
                // This ensures balances are always up-to-date from the ledger (source of truth)
                try {
                  const { syncWalletBalanceFromLedger } = await import('./services/ledger-service.js');
                  await syncWalletBalanceFromLedger(wallet.userId, wallet.id, wallet.currency);
                  // Re-fetch wallet to get updated balance (optimized: only fetch balance fields)
                  const syncedWallet = await db.collection('wallets').findOne(
                    { id: wallet.id },
                    { projection: { balance: 1, bonusBalance: 1, lockedBalance: 1 } }
                  );
                  if (syncedWallet) {
                    wallet.balance = syncedWallet.balance ?? wallet.balance;
                    wallet.bonusBalance = syncedWallet.bonusBalance ?? wallet.bonusBalance;
                    wallet.lockedBalance = syncedWallet.lockedBalance ?? wallet.lockedBalance;
                  }
                } catch (syncError) {
                  // Don't fail the query if sync fails - log at debug level
                  logger.debug('Could not sync wallet in query', { 
                    walletId: wallet.id, 
                    userId: wallet.userId,
                    isProvider: isProviderWallet,
                    isSystem: isSystemWallet,
                    error: syncError instanceof Error ? syncError.message : String(syncError)
                  });
                }
              });
              
              // Sync all wallets in parallel (non-blocking)
              await Promise.allSettled(syncPromises);
            }
            
            // Normalize null values to 0 for bonusBalance, lockedBalance, and lifetimeFees
            if (result && result.nodes && Array.isArray(result.nodes)) {
              result.nodes = result.nodes.map((wallet: any) => ({
                ...wallet,
                bonusBalance: wallet.bonusBalance ?? 0,
                lockedBalance: wallet.lockedBalance ?? 0,
                balance: wallet.balance ?? 0,
                lifetimeFees: wallet.lifetimeFees ?? 0,
              }));
            }
            
            return result;
          },
          wallet: async (args: Record<string, unknown>, ctx: any) => {
            // Call the default wallet resolver
            const wallet: any = await walletService.resolvers.Query.wallet(args, ctx);
            
            if (!wallet) {
              return wallet;
            }
            
            // Sync ALL wallets from ledger before returning (provider, system, and regular user wallets)
            // This ensures balances are always up-to-date from the ledger (source of truth)
            try {
              const { syncWalletBalanceFromLedger } = await import('./services/ledger-service.js');
              await syncWalletBalanceFromLedger(wallet.userId, wallet.id, wallet.currency);
              // Re-fetch wallet to get updated balance (optimized: only fetch balance fields)
              const db = getDatabase();
              const syncedWallet = await db.collection('wallets').findOne(
                { id: wallet.id },
                { projection: { balance: 1, bonusBalance: 1, lockedBalance: 1, lifetimeFees: 1 } }
              );
              if (syncedWallet) {
                wallet.balance = syncedWallet.balance ?? wallet.balance;
                wallet.bonusBalance = syncedWallet.bonusBalance ?? wallet.bonusBalance;
                wallet.lockedBalance = syncedWallet.lockedBalance ?? wallet.lockedBalance;
                wallet.lifetimeFees = syncedWallet.lifetimeFees ?? wallet.lifetimeFees ?? 0;
              }
            } catch (syncError) {
              // Don't fail the query if sync fails - log at debug level
              logger.debug('Could not sync wallet in query', { 
                walletId: wallet.id, 
                userId: wallet.userId,
                error: syncError instanceof Error ? syncError.message : String(syncError)
              });
            }
            
            // Normalize null values to 0 for bonusBalance, lockedBalance, and lifetimeFees
            return {
              ...wallet,
              bonusBalance: wallet.bonusBalance ?? 0,
              lockedBalance: wallet.lockedBalance ?? 0,
              balance: wallet.balance ?? 0,
              lifetimeFees: wallet.lifetimeFees ?? 0,
            };
          },
        },
        Mutation: walletService.resolvers.Mutation,
      }
    },
    { name: 'walletTransaction', types: walletTransactionService.types, resolvers: walletTransactionService.resolvers },
    // Custom user wallet queries (userWallets, walletBalance)
    { 
      name: 'userWallet', 
      types: `
        type UserWalletsResponse {
          userId: String!
          currency: String!
          totals: WalletTotals!
          wallets: [WalletSummary!]!
        }
        type WalletTotals {
          realBalance: Float!
          bonusBalance: Float!
          lockedBalance: Float!
          totalBalance: Float!
          withdrawableBalance: Float!
          lifetimeDeposits: Float!
          lifetimeWithdrawals: Float!
        }
        type WalletSummary {
          id: ID!
          category: String!
          realBalance: Float!
          bonusBalance: Float!
          lockedBalance: Float!
          totalBalance: Float!
          status: String!
          lastActivityAt: String
        }
        type WalletBalanceResponse {
          walletId: ID!
          userId: String!
          category: String!
          currency: String!
          realBalance: Float!
          bonusBalance: Float!
          lockedBalance: Float!
          totalBalance: Float!
          withdrawableBalance: Float!
          status: String!
        }
        extend type Query {
          userWallets(input: JSON): UserWalletsResponse
          walletBalance(input: JSON): WalletBalanceResponse
        }
      `, 
      resolvers: userWalletResolvers 
    },
    // Ledger account balance queries
    { name: 'ledger', types: ledgerTypes, resolvers: ledgerResolvers },
    // Transaction approval mutations and unified transactions query
    { 
      name: 'transactionApproval', 
      types: `
        type TransactionApprovalResult {
          success: Boolean!
          transaction: Transaction
        }
        extend type Query {
          transactions(first: Int, skip: Int, filter: JSON): TransactionConnection
        }
        extend type Mutation {
          approveTransaction(transactionId: String!): TransactionApprovalResult!
          declineTransaction(transactionId: String!, reason: String): TransactionApprovalResult!
        }
      `, 
      resolvers: transactionApprovalResolvers 
    },
    // Webhooks - just plug it in!
    webhookService,
  ],
  // Permission rules using native helpers
  permissions: {
    Query: {
      health: allow,
      // Provider configs (system only - was admin)
      providerConfigs: hasRole('system'),
      providerConfig: hasRole('system'),
      // Transactions
      deposits: isAuthenticated,
      deposit: isAuthenticated,
      withdrawals: isAuthenticated,
      withdrawal: isAuthenticated,
      transactions: isAuthenticated, // Unified transactions query
      // Wallets
      wallets: isAuthenticated,
      wallet: isAuthenticated,
      walletTransactions: isAuthenticated,
      walletTransaction: isAuthenticated,
      // User wallet API (clean client response)
      userWallets: isAuthenticated,
      walletBalance: isAuthenticated,
      // Ledger queries
      ledgerAccountBalance: isAuthenticated,
      bulkLedgerBalances: isAuthenticated, // Allow authenticated users to query balances
      ledgerTransactions: isAuthenticated, // Allow authenticated users to query ledger transactions
      providerLedgerBalance: hasRole('system'),
      bonusPoolBalance: hasRole('system'),
      systemHouseBalance: hasRole('system'),
      // Webhooks (system only)
      webhooks: hasRole('system'),
      webhook: hasRole('system'),
      webhookStats: hasRole('system'),
      webhookDeliveries: hasRole('system'),
    },
    Mutation: {
      // System: Provider management
      createProviderConfig: hasRole('system'),
      updateProviderConfig: hasRole('system'),
      deleteProviderConfig: hasRole('system'),
      // User: Deposits
      createDeposit: isAuthenticated,
      updateDeposit: hasRole('system'),
      deleteDeposit: hasRole('system'),
      // User: Withdrawals
      createWithdrawal: isAuthenticated,
      updateWithdrawal: hasRole('system'),
      deleteWithdrawal: hasRole('system'),
      // System: Transaction approval (for testing/manual approval)
      approveTransaction: hasRole('system'),
      declineTransaction: hasRole('system'),
      // User: Wallets
      createWallet: isAuthenticated,
      updateWallet: hasRole('system'),
      deleteWallet: hasRole('system'),
      // Wallet transactions (internal/system operations)
      // Allow system, payment-gateway, and payment-provider roles
      // Regular users should use createDeposit/createWithdrawal instead
      createWalletTransaction: hasAnyRole('system', 'payment-gateway', 'payment-provider'),
      updateWalletTransaction: hasRole('system'),
      deleteWalletTransaction: hasRole('system'),
      // Webhooks (system only)
      registerWebhook: hasRole('system'),
      updateWebhook: hasRole('system'),
      deleteWebhook: hasRole('system'),
      testWebhook: hasRole('system'),
    },
  },
  // Note: When connecting from localhost, directConnection=true prevents replica set member discovery
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true',
  // Redis password: default is redis123 (from Docker container), can be overridden via REDIS_PASSWORD env var
  redisUrl: process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`,
  defaultPermission: 'deny' as const, // Secure default
};

// ═══════════════════════════════════════════════════════════════════
// Cross-Service Event Handlers (Ledger → Wallet Sync)
// ═══════════════════════════════════════════════════════════════════

/**
 * Setup event handlers for ledger transaction completion
 * Event-driven wallet balance sync using Redis pub/sub (no delays needed)
 * Works across containers/processes - shared source of truth
 */
function setupLedgerEventHandlers() {
  // ═══════════════════════════════════════════════════════════════════
  // Ledger Deposit Completed → Sync Wallet Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<{ depositTxId: string; userId: string; currency: string; netAmount: number; accountId: string }>('ledger.deposit.completed', async (event: IntegrationEvent<{ depositTxId: string; userId: string; currency: string; netAmount: number; accountId: string }>) => {
    // Performance: Use debug logging for frequent operations
    logger.debug('Processing ledger.deposit.completed - syncing wallet balance', {
      eventId: event.eventId,
      userId: event.userId,
      depositTxId: event.data.depositTxId,
    });
    
    try {
      const db = getDatabase();
      const { syncWalletBalanceFromLedger } = await import('./services/ledger-service.js');
      
      // Find user's wallet for this currency (optimized query using compound index)
      // Index: { userId: 1, tenantId: 1, currency: 1, category: 1 }
      const wallet = await db.collection('wallets').findOne(
        {
          userId: event.userId,
          currency: event.data.currency,
          category: 'main',
        },
        { projection: { id: 1 } } // Only fetch id field for performance
      );
      const walletId = wallet ? (wallet as any).id : null;
      
      if (walletId) {
        await syncWalletBalanceFromLedger(
          event.userId!,
          walletId,
          event.data.currency
        );
        // Only log on success at debug level (performance optimization)
        logger.debug('Wallet balance synced after deposit', {
          walletId,
          userId: event.userId,
        });
      } else {
        logger.debug('Wallet not found for deposit sync (may be created later)', {
          userId: event.userId,
          currency: event.data.currency,
        });
      }
    } catch (err) {
      // Only log errors (not warnings) to reduce log noise
      logger.error('Failed to sync wallet balance after deposit', { 
        error: err, 
        eventId: event.eventId,
        userId: event.userId,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Ledger Withdrawal Completed → Sync Wallet Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<{ withdrawalTxId: string; userId: string; currency: string; totalAmount: number; accountId: string }>('ledger.withdrawal.completed', async (event: IntegrationEvent<{ withdrawalTxId: string; userId: string; currency: string; totalAmount: number; accountId: string }>) => {
    // Performance: Use debug logging for frequent operations
    logger.debug('Processing ledger.withdrawal.completed - syncing wallet balance', {
      eventId: event.eventId,
      userId: event.userId,
      withdrawalTxId: event.data.withdrawalTxId,
    });
    
    try {
      const db = getDatabase();
      const { syncWalletBalanceFromLedger } = await import('./services/ledger-service.js');
      
      // Find user's wallet for this currency (optimized query using compound index)
      // Index: { userId: 1, tenantId: 1, currency: 1, category: 1 }
      const wallet = await db.collection('wallets').findOne(
        {
          userId: event.userId,
          currency: event.data.currency,
          category: 'main',
        },
        { projection: { id: 1 } } // Only fetch id field for performance
      );
      const walletId = wallet ? (wallet as any).id : null;
      
      if (walletId) {
        await syncWalletBalanceFromLedger(
          event.userId!,
          walletId,
          event.data.currency
        );
        // Only log on success at debug level (performance optimization)
        logger.debug('Wallet balance synced after withdrawal', {
          walletId,
          userId: event.userId,
        });
      } else {
        logger.debug('Wallet not found for withdrawal sync (may be created later)', {
          userId: event.userId,
          currency: event.data.currency,
        });
      }
    } catch (err) {
      // Only log errors (not warnings) to reduce log noise
      logger.error('Failed to sync wallet balance after withdrawal', { 
        error: err, 
        eventId: event.eventId,
        userId: event.userId,
      });
    }
  });
  
  logger.info('Ledger event handlers registered', {
    handlers: [
      'ledger.deposit.completed → sync wallet balance',
      'ledger.withdrawal.completed → sync wallet balance',
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════
// Cross-Service Event Handlers (Bonus → Wallet Credit)
// ═══════════════════════════════════════════════════════════════════

interface BonusAwardedData {
  bonusId: string;
  type: string;
  value: number;
  currency: string;
  walletId?: string;
  turnoverRequired?: number;
}

interface BonusConvertedData {
  bonusId: string;
  walletId: string;
  amount: number;
  currency: string;
}

interface BonusForfeitedData {
  bonusId: string;
  walletId?: string;
  forfeitedValue: number;
  currency?: string;
  reason: string;
}

/**
 * Setup event handlers to react to bonus events.
 * When bonus-service awards/converts/forfeits a bonus,
 * payment-gateway updates the wallet balance accordingly.
 */
function setupBonusEventHandlers() {
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Awarded → Credit Bonus Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<BonusAwardedData>('bonus.awarded', async (event: IntegrationEvent<BonusAwardedData>) => {
    logger.info('Processing bonus.awarded - crediting wallet', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      value: event.data.value,
      currency: event.data.currency,
    });
    
    // Early return if userId is missing
    if (!event.userId) {
      logger.warn('No userId in bonus.awarded event, cannot sync wallet', { eventId: event.eventId });
      return;
    }
    
    // TypeScript type narrowing - userId is guaranteed to be string after the check above
    const userId = event.userId;
    
    try {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Find user's wallet (use provided walletId or find by user/currency)
      let walletId: string | undefined = event.data.walletId;
      
      if (!walletId) {
        // Find user's main wallet for this currency
        const wallet = await walletsCollection.findOne({
          userId: userId,
          currency: event.data.currency,
          category: 'main',
        });
        
        if (!wallet) {
          logger.warn('No wallet found for bonus credit', {
            userId: userId,
            currency: event.data.currency,
          });
          return;
        }
        walletId = (wallet as any).id;
      }
      
      // Ensure walletId is defined before syncing
      if (!walletId) {
        logger.warn('Wallet ID not found for bonus credit', {
          userId: userId,
          currency: event.data.currency,
        });
        return;
      }
      
      // Sync wallet balance from ledger (source of truth)
      // The bonus-service has already recorded the ledger entry, so sync from ledger
      try {
        // Both userId and walletId are guaranteed to be strings after checks above
        await syncWalletBalanceFromLedger(userId, walletId, event.data.currency);
        logger.info('Bonus balance synced from ledger', {
          walletId,
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
        });
        
        // Record the transaction - use MongoDB ObjectId for performant single-insert operation
        const txCollection = db.collection('wallet_transactions');
        const { objectId, idString } = generateMongoId();
        const txData = {
          _id: objectId,
          id: idString,
          walletId,
          userId: event.userId,
          tenantId: event.tenantId,
          type: 'bonus_credit',
          balanceType: 'bonus',
          currency: event.data.currency,
          amount: event.data.value,
          bonusId: event.data.bonusId,
          description: `Bonus awarded: ${event.data.type}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await txCollection.insertOne(txData as any);
        
        // Dispatch webhook for bonus credit (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.updated', event.tenantId, event.userId!, {
          walletId,
          action: 'bonus_credit',
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
        }, { skipInternal: true });
      } catch (syncError) {
        logger.error('Failed to sync bonus balance from ledger', { 
          error: syncError, 
          eventId: event.eventId,
          walletId,
          userId: event.userId,
        });
      }
    } catch (err) {
      logger.error('Failed to credit bonus to wallet', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Converted → Move from Bonus to Real Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<BonusConvertedData>('bonus.converted', async (event: IntegrationEvent<BonusConvertedData>) => {
    logger.info('Processing bonus.converted - moving to real balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      amount: event.data.amount,
    });
    
    try {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Find wallet
      // Use optimized findOneById utility (performance-optimized)
      const wallet = await findOneById(walletsCollection, event.data.walletId, {});
      
      if (!wallet) {
        logger.warn('Wallet not found for bonus conversion', { walletId: event.data.walletId });
        return;
      }
      
      const currentBonusBalance = (wallet as any).bonusBalance || 0;
      
      // Can't convert more than available bonus balance
      const convertAmount = Math.min(event.data.amount, currentBonusBalance);
      
      if (convertAmount <= 0) {
        logger.warn('No bonus balance to convert', { walletId: event.data.walletId });
        return;
      }
      
      // Record in ledger using generic transfer (bonus-service should have already done this, but ensure it)
      // Generic: User bonus account -> User real account (both are just user accounts with subtypes)
      try {
        const { getOrCreateUserAccount, getLedger } = await import('./services/ledger-service.js');
        const ledger = getLedger();
        
        // Get account IDs for bonus and real accounts
        const userBonusAccountId = await getOrCreateUserAccount(event.userId!, 'bonus', event.data.currency);
        const userRealAccountId = await getOrCreateUserAccount(event.userId!, 'real', event.data.currency);
        
        // Use generic transfer: bonus account -> real account
        await ledger.createTransaction({
          type: 'transfer',
          fromAccountId: userBonusAccountId,
          toAccountId: userRealAccountId,
          amount: convertAmount,
          currency: event.data.currency,
          description: `Bonus converted: ${event.data.bonusId}`,
          externalRef: `bonus-convert-${event.data.bonusId}-${Date.now()}`,
          initiatedBy: event.userId!,
          metadata: {
            userId: event.userId!,
            bonusId: event.data.bonusId,
            tenantId: event.tenantId,
            transactionType: 'bonus_conversion',
          },
        });
      } catch (ledgerError) {
        logger.error('Failed to record bonus conversion in ledger', { error: ledgerError });
        // Continue - bonus-service should have already recorded it
      }
      
      // Atomic: debit bonus, credit real
      const result = await walletsCollection.updateOne(
        { id: event.data.walletId, bonusBalance: { $gte: convertAmount } },
        { 
          $inc: { 
            bonusBalance: -convertAmount,
            balance: convertAmount,
          },
          $set: { updatedAt: new Date() },
        }
      );
      
      if (result.modifiedCount > 0) {
        logger.info('Bonus converted to real balance', {
          walletId: event.data.walletId,
          bonusId: event.data.bonusId,
          amount: convertAmount,
        });
        
        // Sync wallet balance from ledger to ensure consistency
        try {
          const { syncWalletBalanceFromLedger } = await import('./services/ledger-service.js');
          await syncWalletBalanceFromLedger(event.userId!, event.data.walletId, event.data.currency);
        } catch (syncError) {
          logger.warn('Could not sync wallet balance from ledger', { error: syncError });
        }
        
        // Record the transactions - use MongoDB ObjectId for performant single-insert operation
        const txCollection = db.collection('wallet_transactions');
        
        // Debit from bonus
        const { objectId: debitObjectId, idString: txId } = generateMongoId();
        const debitTxData = {
          _id: debitObjectId,
          id: txId,
          walletId: event.data.walletId,
          userId: event.userId,
          tenantId: event.tenantId,
          type: 'bonus_convert_out',
          balanceType: 'bonus',
          currency: event.data.currency,
          amount: convertAmount,
          bonusId: event.data.bonusId,
          description: 'Bonus converted to real balance',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await txCollection.insertOne(debitTxData as any);
        
        // Credit to real
        const { objectId: creditObjectId, idString: creditIdString } = generateMongoId();
        const creditTxData = {
          _id: creditObjectId,
          id: creditIdString,
          walletId: event.data.walletId,
          userId: event.userId,
          tenantId: event.tenantId,
          type: 'bonus_convert_in',
          balanceType: 'real',
          currency: event.data.currency,
          amount: convertAmount,
          bonusId: event.data.bonusId,
          relatedTransactionId: txId,
          description: 'Converted from bonus balance',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await txCollection.insertOne(creditTxData as any);
        
        // Dispatch webhook (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.transfer.completed', event.tenantId, event.userId!, {
          walletId: event.data.walletId,
          action: 'bonus_conversion',
          bonusId: event.data.bonusId,
          amount: convertAmount,
          currency: event.data.currency,
          from: 'bonus',
          to: 'real',
        }, { skipInternal: true });
      }
    } catch (err) {
      logger.error('Failed to convert bonus to real balance', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Forfeited → Debit Bonus Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<BonusForfeitedData>('bonus.forfeited', async (event: IntegrationEvent<BonusForfeitedData>) => {
    logger.info('Processing bonus.forfeited - debiting bonus balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      forfeitedValue: event.data.forfeitedValue,
    });
    
    try {
      if (!event.data.walletId) {
        logger.warn('No walletId in forfeited event, skipping wallet update');
        return;
      }
      
      // Record in ledger using generic transfer (bonus-service should have already done this, but ensure it)
      // Generic: User bonus account -> Bonus pool account (both are just user accounts)
      try {
        const { getOrCreateUserAccount } = await import('./services/ledger-service.js');
        const ledger = (await import('./services/ledger-service.js')).getLedger();
        
        // Get bonus-pool user ID (lookup from auth database)
        const bonusPoolUserId = await getBonusPoolUserId();
        
        // Get account IDs for bonus and bonus pool accounts
        // Bonus pool cannot go negative (has fixed budget)
        const userBonusAccountId = await getOrCreateUserAccount(event.userId!, 'bonus', event.data.currency || SYSTEM_CURRENCY);
        const bonusPoolAccountId = await getOrCreateUserAccount(bonusPoolUserId, 'main', event.data.currency || SYSTEM_CURRENCY, false);
        
        // Use generic transfer: user bonus account -> bonus pool account
        await ledger.createTransaction({
          type: 'transfer',
          fromAccountId: userBonusAccountId,
          toAccountId: bonusPoolAccountId,
          amount: event.data.forfeitedValue,
          currency: event.data.currency || SYSTEM_CURRENCY,
          description: `Bonus forfeited: ${event.data.reason || 'Forfeited'}`,
          externalRef: `bonus-forfeit-${event.data.bonusId}-${Date.now()}`,
          initiatedBy: 'system',
          metadata: {
            userId: event.userId!,
            bonusId: event.data.bonusId,
            reason: event.data.reason || 'Forfeited',
            tenantId: event.tenantId,
            transactionType: 'bonus_forfeit',
          },
        });
      } catch (ledgerError) {
        logger.error('Failed to record bonus forfeiture in ledger', { error: ledgerError });
        // Continue - bonus-service should have already recorded it
      }
      
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Debit the forfeited amount from bonus balance
      const result = await walletsCollection.updateOne(
        { id: event.data.walletId },
        { 
          $inc: { bonusBalance: -Math.abs(event.data.forfeitedValue) },
          $set: { updatedAt: new Date() },
        }
      );
      
      if (result.modifiedCount > 0) {
        logger.info('Bonus forfeited from wallet', {
          walletId: event.data.walletId,
          bonusId: event.data.bonusId,
          amount: event.data.forfeitedValue,
          reason: event.data.reason,
        });
        
        // Record transaction - use MongoDB ObjectId for performant single-insert operation
        const txCollection = db.collection('wallet_transactions');
        const { objectId, idString } = generateMongoId();
        const forfeitTxData = {
          _id: objectId,
          id: idString,
          walletId: event.data.walletId,
          userId: event.userId,
          tenantId: event.tenantId,
          type: 'bonus_forfeit',
          balanceType: 'bonus',
          currency: event.data.currency || 'USD',
          amount: event.data.forfeitedValue,
          bonusId: event.data.bonusId,
          description: `Bonus forfeited: ${event.data.reason}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await txCollection.insertOne(forfeitTxData as any);
        
        // Dispatch webhook (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.updated', event.tenantId, event.userId!, {
          walletId: event.data.walletId,
          action: 'bonus_forfeit',
          bonusId: event.data.bonusId,
          amount: event.data.forfeitedValue,
          reason: event.data.reason,
        }, { skipInternal: true });
      }
    } catch (err) {
      logger.error('Failed to forfeit bonus from wallet', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Expired → Debit Bonus Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<BonusForfeitedData>('bonus.expired', async (event: IntegrationEvent<BonusForfeitedData>) => {
    // Treat expiration same as forfeiture
    logger.info('Processing bonus.expired - debiting bonus balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
    });
    
    // Reuse forfeiture logic
    if (event.data.walletId && event.data.forfeitedValue) {
      try {
        const db = getDatabase();
        const walletsCollection = db.collection('wallets');
        
        await walletsCollection.updateOne(
          { id: event.data.walletId },
          { 
            $inc: { bonusBalance: -Math.abs(event.data.forfeitedValue) },
            $set: { updatedAt: new Date() },
          }
        );
        
        logger.info('Expired bonus removed from wallet', {
          walletId: event.data.walletId,
          bonusId: event.data.bonusId,
          amount: event.data.forfeitedValue,
        });
      } catch (err) {
        logger.error('Failed to remove expired bonus', { error: err });
      }
    }
  });
  
  logger.info('Bonus event handlers registered', {
    handlers: [
      'bonus.awarded → credit bonusBalance',
      'bonus.converted → move to real balance',
      'bonus.forfeited → debit bonusBalance',
      'bonus.expired → debit bonusBalance',
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                     PAYMENT SERVICE                                   ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Features:                                                            ║
║  • User-to-user deposits and withdrawals                              ║
║  • Multi-currency wallet management                                   ║
║  • Balance validation based on permissions                            ║
║  • Saga-based rollback for atomic operations                          ║
║  • Event-driven balance synchronization                               ║
║                                                                       ║
║  Bonus Integration (listens to bonus-service events):                 ║
║  • bonus.awarded → credit bonusBalance                                ║
║  • bonus.converted → move to real balance                             ║
║  • bonus.forfeited/expired → debit bonusBalance                       ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  console.log('Environment:');
  console.log(`  PORT:       ${config.port}`);
  console.log(`  MONGO_URI:  ${process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service'}`);
  console.log(`  REDIS_URL:  ${process.env.REDIS_URL || 'not configured'}`);
  console.log('');

  // Register event handlers before starting
  setupLedgerEventHandlers();
  setupBonusEventHandlers();

  // Create gateway first (this connects to database)
  await createGateway({
    ...config,
  });

  // Initialize payment webhooks AFTER database connection is established
  try {
    await initializePaymentWebhooks();
  } catch (error) {
    logger.error('Failed to initialize payment webhooks', { error });
    // Continue - webhooks are optional
  }
  
  // ✅ CRITICAL: Ensure unique index on metadata.externalRef exists
  // This prevents duplicate transactions at the database level
  try {
    const db = getDatabase();
    const transactionsCollection = db.collection('transactions');
    
    // Check if unique index exists
    const indexes = await transactionsCollection.indexes();
    const uniqueExternalRefIndex = indexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'metadata.externalRef' in idx.key && 
      idx.unique === true
    );
    
    if (!uniqueExternalRefIndex) {
      logger.info('Creating unique index on metadata.externalRef for duplicate protection');
      
      // Drop any existing non-unique index on metadata.externalRef
      const existingIndex = indexes.find(idx => 
        idx.key && 
        typeof idx.key === 'object' && 
        'metadata.externalRef' in idx.key
      );
      
      if (existingIndex && existingIndex.name && !existingIndex.unique) {
        try {
          await transactionsCollection.dropIndex(existingIndex.name);
          logger.info(`Dropped existing non-unique index: ${existingIndex.name}`);
        } catch (dropError: any) {
          logger.warn('Could not drop existing index, will try to create unique index anyway', {
            error: dropError.message
          });
        }
      }
      
      // Create unique index
      try {
        await transactionsCollection.createIndex(
          { 'metadata.externalRef': 1 },
          { 
            unique: true,
            sparse: true,
            name: 'metadata.externalRef_1_unique'
          }
        );
        logger.info('✅ Unique index on metadata.externalRef created successfully');
      } catch (createError: any) {
        const { isDuplicateKeyError } = await import('core-service');
        if (isDuplicateKeyError(createError)) {
          logger.warn('Cannot create unique index - duplicate values exist. Please clean duplicates first.', {
            error: createError.message
          });
        } else if (createError.code === 85 || createError.codeName === 'IndexOptionsConflict') {
          logger.warn('Index exists with different options. Attempting to recreate...');
          try {
            // Try to drop conflicting indexes
            await transactionsCollection.dropIndex('metadata.externalRef_1').catch(() => {});
            await transactionsCollection.dropIndex('metadata.externalRef_1_unique').catch(() => {});
            
            // Recreate with correct options
            await transactionsCollection.createIndex(
              { 'metadata.externalRef': 1 },
              { 
                unique: true,
                sparse: true,
                name: 'metadata.externalRef_1_unique'
              }
            );
            logger.info('✅ Unique index on metadata.externalRef recreated successfully');
          } catch (recreateError: any) {
            logger.error('Failed to recreate unique index on metadata.externalRef', {
              error: recreateError.message
            });
            // Don't throw - service can still run, but duplicates won't be prevented at DB level
          }
        } else {
          logger.error('Failed to create unique index on metadata.externalRef', {
            error: createError.message,
            code: createError.code
          });
          // Don't throw - service can still run, but duplicates won't be prevented at DB level
        }
      }
    } else {
      logger.debug('Unique index on metadata.externalRef already exists', {
        indexName: uniqueExternalRefIndex.name
      });
    }
  } catch (indexError: any) {
    logger.error('Failed to ensure unique index on metadata.externalRef', {
      error: indexError.message
    });
    // Don't throw - service can still run, but duplicates won't be prevented at DB level
  }
  
  // Initialize ledger system AFTER database connection is established
  const tenantId = 'default-tenant'; // Match tenantId used throughout the system
  try {
    const ledger = await initializeLedger(tenantId);
    logger.info('Ledger system initialized for payment service');
    
    // ✅ PHASE 2: Start crash recovery job (runs every minute)
    ledger.startRecoveryJob(60000); // 60 seconds
    logger.info('Transaction recovery job started');
  } catch (error) {
    logger.error('Failed to initialize ledger system', { error });
    // Ledger is critical - but we'll let it fail gracefully and log
    // The service can still run, but ledger operations will fail
    throw error; // Re-throw as ledger is critical for payment service
  }
  
  // Cleanup old webhook deliveries daily
  setInterval(async () => {
    try {
      const deleted = await cleanupPaymentWebhookDeliveries(30);
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old payment webhook deliveries`);
      }
    } catch (err) {
      logger.error('Webhook cleanup failed', { error: err });
    }
  }, 24 * 60 * 60 * 1000); // Daily
  
  // Start listening to events from Redis
  if (process.env.REDIS_URL) {
    try {
      // Subscribe to event channels
      const channels = [
        'integration:bonus',  // bonus.awarded, bonus.converted, bonus.forfeited, bonus.expired
        'integration:ledger',  // ledger.deposit.completed, ledger.withdrawal.completed
      ];
      await startListening(channels);
      logger.info('Started listening on event channels', { channels });
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  }
}

// Export webhook manager for advanced use cases (direct dispatch without internal events)
export { paymentWebhooks };

main().catch((err) => {
  logger.error('Failed to start payment-gateway', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

// Setup process-level error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in payment-service', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in payment-service', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit - log and continue (some rejections are acceptable)
});

// Export types for consumers
export type {
  // Payment types
  PaymentProvider,
  PaymentMethod,
  TransactionType,
  TransactionStatus,
  Currency,
  ProviderConfig,
  Transaction,
  // Wallet types
  Wallet,
  WalletCategory,
  WalletTransaction,
  WalletTransactionType,
  WalletBalance,
  UserWalletSummary,
  WalletTransfer,
  WalletStrategyConfig,
  // API input types
  CreateWalletInput,
  TransferBetweenWalletsInput,
} from './types.js';

// Export wallet strategy constants
export { WALLET_CATEGORIES, WALLET_STRATEGIES } from './types.js';
