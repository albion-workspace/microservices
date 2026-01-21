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
  isDuplicateKeyError,
} from 'core-service';
// Ledger service imports removed - wallets are updated atomically via createTransferWithTransactions
import { createTransferWithTransactions } from 'core-service';

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
  transactionsQueryResolver,
} from './services/transaction.js';
import { transferApprovalResolvers } from './services/transfer-approval.js';

import { transferService } from './services/transfer.js';

import {
  walletService,
  userWalletResolvers,
  walletResolvers,
  walletTypes,
  walletBalanceResolvers,
  walletBalanceTypes,
  ledgerResolvers,
  ledgerTypes,
} from './services/wallet.js';

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
    // Register transfer service FIRST so Transfer type is available for deposit/withdrawal results
    { name: 'transfer', types: transferService.types, resolvers: transferService.resolvers },
    { name: 'deposit', types: depositService.types, resolvers: depositService.resolvers },
    { name: 'withdrawal', types: withdrawalService.types, resolvers: withdrawalService.resolvers },
    // Unified wallet service - Includes wallet CRUD + balance queries + transaction history
    // Architecture: Wallets + Transactions + Transfers
    { 
      name: 'wallet', 
      types: walletService.types + '\n' + walletTypes + `
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
      `, 
      resolvers: {
        Query: {
          ...walletService.resolvers.Query,
          ...walletResolvers.Query,
          wallets: async (args: Record<string, unknown>, ctx: any) => {
            // Call the default wallets resolver
            const result: any = await walletService.resolvers.Query.wallets(args, ctx);
            
            // Wallets are updated atomically via createTransferWithTransactions - no sync needed
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
                
                // Wallets are updated atomically via createTransferWithTransactions
                // No sync needed - wallets are the source of truth
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
            
            // Wallets are updated atomically via createTransferWithTransactions
            // No sync needed - wallets are the source of truth
            
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
    // Transfer approval mutations and unified transactions query
    { 
      name: 'transferApproval', 
      types: `
        type TransferApprovalResult {
          success: Boolean!
          transfer: Transfer
        }
        extend type Query {
          transactions(first: Int, skip: Int, filter: JSON): TransactionConnection
        }
        extend type Mutation {
          approveTransfer(transferId: String!): TransferApprovalResult!
          declineTransfer(transferId: String!, reason: String): TransferApprovalResult!
        }
      `, 
      resolvers: {
        Query: {
          transactions: transactionsQueryResolver,
        },
        Mutation: {
          ...transferApprovalResolvers.Mutation,
        },
        // Field resolvers for Transaction computed fields
        Transaction: {
          type: (parent: any) => parent.type || parent.charge,
          status: (parent: any) => parent.status || 'completed',
          currency: (parent: any) => parent.currency || parent.meta?.currency,
          feeAmount: (parent: any) => parent.feeAmount ?? parent.meta?.feeAmount ?? null,
          netAmount: (parent: any) => parent.netAmount ?? parent.meta?.netAmount ?? null,
          fromUserId: (parent: any) => parent.fromUserId || parent.meta?.fromUserId || null,
          toUserId: (parent: any) => parent.toUserId || parent.meta?.toUserId || null,
          description: (parent: any) => parent.description || parent.meta?.description || null,
          metadata: (parent: any) => parent.metadata || parent.meta || null,
        },
      }
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
      // Transfers
      transfers: isAuthenticated, // User-to-user transfers query
      transfer: isAuthenticated, // Single transfer query
      // Wallets
      wallets: isAuthenticated,
      wallet: isAuthenticated,
      // User wallet API (clean client response)
      userWallets: isAuthenticated,
      walletBalance: isAuthenticated,
      bulkWalletBalances: isAuthenticated, // Allow authenticated users to query balances
      transactionHistory: isAuthenticated, // Allow authenticated users to query transaction history
      // Legacy query aliases (for test scripts that use old names)
      ledgerAccountBalance: isAuthenticated, // Alias for walletBalance
      bulkLedgerBalances: isAuthenticated, // Alias for bulkWalletBalances
      ledgerTransactions: isAuthenticated, // Alias for transactionHistory
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
      // System: Transfer approval (for pending transfers)
      approveTransfer: hasRole('system'),
      declineTransfer: hasRole('system'),
      // User: Wallets
      createWallet: isAuthenticated,
      updateWallet: hasRole('system'),
      deleteWallet: hasRole('system'),
      // Transfers (user-to-user transfers)
      createTransfer: isAuthenticated,
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
      
      // Get bonus-pool user ID
      const bonusPoolUserId = await getBonusPoolUserId();
      
      // Create transfer: bonus-pool -> user (bonus balance)
      try {
        const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
          fromUserId: bonusPoolUserId,
          toUserId: userId,
          amount: event.data.value,
          currency: event.data.currency,
          tenantId: event.tenantId,
          feeAmount: 0,
          method: 'bonus_award',  // Uniform payment method for reconciliation
          externalRef: `bonus-award-${event.data.bonusId}`,
          description: `Bonus awarded: ${event.data.type}`,
          objectId: event.data.bonusId,  // Transactions reference bonus, not transfer
          objectModel: 'bonus',
          bonusId: event.data.bonusId,
          bonusType: event.data.type,
        });
        
        logger.info('Bonus awarded via transfer', {
          transferId: transfer.id,
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
        });
        
        // Dispatch webhook for bonus credit (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.updated', event.tenantId, event.userId!, {
          walletId,
          action: 'bonus_credit',
          bonusId: event.data.bonusId,
          amount: event.data.value,
          currency: event.data.currency,
          transferId: transfer.id,
        }, { skipInternal: true });
      } catch (transferError) {
        logger.error('Failed to create bonus transfer', { 
          error: transferError, 
          eventId: event.eventId,
          walletId,
          userId: event.userId,
        });
        throw transferError;
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
      
      // Create transfer: user (bonus) -> user (real) - same user, different balance types
      try {
        const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
          fromUserId: event.userId!,
          toUserId: event.userId!,  // Same user
          amount: convertAmount,
          currency: event.data.currency,
          tenantId: event.tenantId,
          feeAmount: 0,
          method: 'bonus_convert',
          externalRef: `bonus-convert-${event.data.bonusId}`,
          description: `Bonus converted: ${event.data.bonusId}`,
          fromBalanceType: 'bonus',  // Debit from bonus balance
          toBalanceType: 'real',     // Credit to real balance
          objectId: event.data.bonusId,  // Transactions reference bonus, not transfer
          objectModel: 'bonus',
          bonusId: event.data.bonusId,
        });
        
        logger.info('Bonus converted via transfer', {
          transferId: transfer.id,
          bonusId: event.data.bonusId,
          amount: convertAmount,
          currency: event.data.currency,
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
          transferId: transfer.id,
        }, { skipInternal: true });
      } catch (transferError) {
        logger.error('Failed to create bonus conversion transfer', { 
          error: transferError, 
          eventId: event.eventId,
          walletId: event.data.walletId,
          userId: event.userId,
        });
        throw transferError;
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
      
      // Get bonus-pool user ID
      const bonusPoolUserId = await getBonusPoolUserId();
      
      // Create transfer: user -> bonus-pool (return forfeited bonus)
      try {
        const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
          fromUserId: event.userId!,
          toUserId: bonusPoolUserId,
          amount: event.data.forfeitedValue,
          currency: event.data.currency || SYSTEM_CURRENCY,
          tenantId: event.tenantId,
          feeAmount: 0,
          method: 'bonus_forfeit',
          externalRef: `bonus-forfeit-${event.data.bonusId}`,
          description: `Bonus forfeited: ${event.data.reason || 'Forfeited'}`,
          fromBalanceType: 'bonus',  // Debit from user bonus balance
          toBalanceType: 'real',      // Credit to bonus-pool real balance
          objectId: event.data.bonusId,  // Transactions reference bonus, not transfer
          objectModel: 'bonus',
          bonusId: event.data.bonusId,
          reason: event.data.reason,
        });
        
        logger.info('Bonus forfeited via transfer', {
          transferId: transfer.id,
          bonusId: event.data.bonusId,
          amount: event.data.forfeitedValue,
          reason: event.data.reason,
        });
        
        // Dispatch webhook (skipInternal: already handling this event)
        await emitPaymentEvent('wallet.updated', event.tenantId, event.userId!, {
          walletId: event.data.walletId,
          action: 'bonus_forfeit',
          bonusId: event.data.bonusId,
          amount: event.data.forfeitedValue,
          reason: event.data.reason,
          transferId: transfer.id,
        }, { skipInternal: true });
      } catch (transferError) {
        logger.error('Failed to create bonus forfeit transfer', { 
          error: transferError, 
          eventId: event.eventId,
          walletId: event.data.walletId,
          userId: event.userId,
        });
        throw transferError;
      }
    } catch (err) {
      logger.error('Failed to forfeit bonus from wallet', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Expired → Debit Bonus Balance
  // ═══════════════════════════════════════════════════════════════════
  
  on<BonusForfeitedData>('bonus.expired', async (event: IntegrationEvent<BonusForfeitedData>) => {
    // Treat expiration same as forfeiture - use same transfer logic
    logger.info('Processing bonus.expired - debiting bonus balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
    });
    
    if (!event.data.walletId || !event.data.forfeitedValue) {
      logger.warn('Missing walletId or forfeitedValue in bonus.expired event');
      return;
    }
    
    try {
      // Get bonus-pool user ID
      const bonusPoolUserId = await getBonusPoolUserId();
      
      // Create transfer: user -> bonus-pool (return expired bonus)
      const { transfer } = await createTransferWithTransactions({
        fromUserId: event.userId!,
        toUserId: bonusPoolUserId,
        amount: event.data.forfeitedValue,
        currency: event.data.currency || SYSTEM_CURRENCY,
        tenantId: event.tenantId,
        feeAmount: 0,
        method: 'bonus_forfeit',  // Same method as forfeiture for reconciliation
        externalRef: `bonus-expired-${event.data.bonusId}`,
        description: `Bonus expired: ${event.data.bonusId}`,
        objectId: event.data.bonusId,
        objectModel: 'bonus',
        bonusId: event.data.bonusId,
        reason: 'expired',
      });
      
      logger.info('Expired bonus removed via transfer', {
        transferId: transfer.id,
        bonusId: event.data.bonusId,
        amount: event.data.forfeitedValue,
      });
    } catch (err) {
      logger.error('Failed to remove expired bonus', { error: err, eventId: event.eventId });
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
  
  // Ledger initialization removed - wallets are the source of truth, updated atomically via createTransferWithTransactions
  // Transaction recovery is handled by saga state manager (Redis-backed)
  logger.info('Payment service initialized - using wallets + transactions architecture');
  
  // Setup recovery system (transfer recovery + recovery job)
  try {
    const { setupRecovery } = await import('./recovery-setup.js');
    await setupRecovery();
    logger.info('✅ Recovery system initialized');
  } catch (err) {
    logger.warn('Could not setup recovery system', { error: (err as Error).message });
    // Don't throw - service can still run without recovery
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
  Transfer,
  // Wallet types
  Wallet,
  WalletCategory,
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
