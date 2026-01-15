/**
 * Payment Gateway - Multi-provider payment processing
 * 
 * Features:
 * - Multiple payment provider support
 * - Deposit & Withdrawal with saga rollback
 * - Wallet balance management
 * - Transaction history & tracking
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
  type IntegrationEvent,
  // Webhooks - plug-and-play service
  createWebhookService,
  type ResolverContext,
} from 'core-service';
import { initializeLedger } from './services/ledger-service.js';

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
    Payment Gateway Webhook Events:
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
  providerConfigService,
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

import { SYSTEM_ROLE } from './constants.js';
export { SYSTEM_ROLE };

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
    { name: 'providerConfig', types: providerConfigService.types, resolvers: providerConfigService.resolvers },
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
            
            // Sync system and provider wallets from ledger before returning
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
                
                // Sync provider wallets and system user wallets
                if (isProviderWallet || isSystemWallet) {
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
                    // Don't fail the query if sync fails
                    logger.debug('Could not sync wallet in query', { 
                      walletId: wallet.id, 
                      userId: wallet.userId,
                      error: syncError instanceof Error ? syncError.message : String(syncError)
                    });
                  }
                }
              });
              
              // Sync all wallets in parallel (non-blocking)
              await Promise.allSettled(syncPromises);
            }
            
            // Normalize null values to 0 for bonusBalance and lockedBalance
            if (result && result.nodes && Array.isArray(result.nodes)) {
              result.nodes = result.nodes.map((wallet: any) => ({
                ...wallet,
                bonusBalance: wallet.bonusBalance ?? 0,
                lockedBalance: wallet.lockedBalance ?? 0,
                balance: wallet.balance ?? 0,
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
            
            // Sync system and provider wallets from ledger before returning
            const db = getDatabase();
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
            
            // Sync provider wallets and system user wallets
            if (isProviderWallet || isSystemWallet) {
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
                // Don't fail the query if sync fails
                logger.debug('Could not sync wallet in query', { 
                  walletId: wallet.id, 
                  userId: wallet.userId,
                  error: syncError instanceof Error ? syncError.message : String(syncError)
                });
              }
            }
            
            // Normalize null values to 0 for bonusBalance and lockedBalance
            return {
              ...wallet,
              bonusBalance: wallet.bonusBalance ?? 0,
              lockedBalance: wallet.lockedBalance ?? 0,
              balance: wallet.balance ?? 0,
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
    // Transaction approval mutations (for testing/manual approval)
    { 
      name: 'transactionApproval', 
      types: `
        type TransactionApprovalResult {
          success: Boolean!
          transaction: Transaction
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
      // Provider configs (admin only)
      providerConfigs: hasRole('admin'),
      providerConfig: hasRole('admin'),
      // Transactions
      deposits: isAuthenticated,
      deposit: isAuthenticated,
      withdrawals: isAuthenticated,
      withdrawal: isAuthenticated,
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
      providerLedgerBalance: hasRole('admin'),
      bonusPoolBalance: hasRole('admin'),
      // Webhooks (admin only)
      webhooks: hasRole('admin'),
      webhook: hasRole('admin'),
      webhookStats: hasRole('admin'),
      webhookDeliveries: hasRole('admin'),
    },
    Mutation: {
      // Admin: Provider management
      createProviderConfig: hasRole('admin'),
      updateProviderConfig: hasRole('admin'),
      deleteProviderConfig: hasRole('admin'),
      // User: Deposits
      createDeposit: isAuthenticated,
      updateDeposit: hasRole('admin'),
      deleteDeposit: hasRole('admin'),
      // User: Withdrawals
      createWithdrawal: isAuthenticated,
      updateWithdrawal: hasRole('admin'),
      deleteWithdrawal: hasRole('admin'),
      // Admin: Transaction approval (for testing/manual approval)
      approveTransaction: hasRole('admin'),
      declineTransaction: hasRole('admin'),
      // User: Wallets
      createWallet: isAuthenticated,
      updateWallet: hasRole('admin'),
      deleteWallet: hasRole('admin'),
      // Wallet transactions (internal)
      createWalletTransaction: hasAnyRole('admin', 'system'),
      updateWalletTransaction: hasRole('admin'),
      deleteWalletTransaction: hasRole('admin'),
      // Webhooks (admin only)
      registerWebhook: hasRole('admin'),
      updateWebhook: hasRole('admin'),
      deleteWebhook: hasRole('admin'),
      testWebhook: hasRole('admin'),
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
    
    try {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Find user's wallet (use provided walletId or find by user/currency)
      let walletId = event.data.walletId;
      
      if (!walletId) {
        // Find user's main wallet for this currency
        const wallet = await walletsCollection.findOne({
          userId: event.userId,
          currency: event.data.currency,
          category: 'main',
        });
        
        if (!wallet) {
          logger.warn('No wallet found for bonus credit', {
            userId: event.userId,
            currency: event.data.currency,
          });
          return;
        }
        walletId = (wallet as any).id;
      }
      
      // Credit bonus balance
      const result = await walletsCollection.updateOne(
        { id: walletId },
        { 
          $inc: { bonusBalance: event.data.value },
          $set: { updatedAt: new Date() },
        }
      );
      
      if (result.modifiedCount > 0) {
        logger.info('Bonus balance credited', {
          walletId,
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
        });
        
        // Record the transaction
        const txCollection = db.collection('wallet_transactions');
        await txCollection.insertOne({
          id: crypto.randomUUID(),
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
        });
        
        // Dispatch webhook for bonus credit (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.updated', event.tenantId, event.userId!, {
          walletId,
          action: 'bonus_credit',
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
        }, { skipInternal: true });
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
      const wallet = await walletsCollection.findOne({ id: event.data.walletId });
      
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
      
      // Record in ledger FIRST (bonus-service should have already done this, but ensure it)
      try {
        const { recordBonusConversionLedgerEntry } = await import('./services/ledger-service.js');
        await recordBonusConversionLedgerEntry(
          event.userId!,
          convertAmount,
          event.data.currency,
          event.tenantId,
          event.data.bonusId,
          `Bonus converted: ${event.data.bonusId}`
        );
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
        
        // Record the transactions
        const txCollection = db.collection('wallet_transactions');
        const txId = crypto.randomUUID();
        
        // Debit from bonus
        await txCollection.insertOne({
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
        });
        
        // Credit to real
        await txCollection.insertOne({
          id: crypto.randomUUID(),
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
        });
        
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
      
      // Record in ledger FIRST (bonus-service should have already done this, but ensure it)
      try {
        const { recordBonusForfeitLedgerEntry } = await import('./services/ledger-service.js');
        await recordBonusForfeitLedgerEntry(
          event.userId!,
          event.data.forfeitedValue,
          event.data.currency || 'USD',
          event.tenantId,
          event.data.bonusId,
          event.data.reason || 'Forfeited',
          `Bonus forfeited: ${event.data.reason || 'Forfeited'}`
        );
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
        
        // Record transaction
        const txCollection = db.collection('wallet_transactions');
        await txCollection.insertOne({
          id: crypto.randomUUID(),
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
        });
        
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
║  Providers:                                                           ║
║  • Stripe, PayPal, Adyen, Worldpay, Braintree                        ║
║  • Skrill, Neteller, Paysafe, Trustly                                ║
║  • Klarna, iDEAL, Sofort, Giropay, PIX                               ║
║  • Crypto: BTC, ETH, USDT                                            ║
║                                                                       ║
║  Features:                                                            ║
║  • Deposits with auto-routing                                         ║
║  • Withdrawals with balance hold                                      ║
║  • Wallet management                                                  ║
║  • Saga-based rollback                                                ║
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
  
  // Initialize ledger system AFTER database connection is established
  const tenantId = 'default'; // Could be multi-tenant in future
  try {
    await initializeLedger(tenantId);
    logger.info('Ledger system initialized for payment service');
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
