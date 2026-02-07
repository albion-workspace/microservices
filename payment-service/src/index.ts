/**
 * Payment Service
 * Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below.
 *
 * Generic user-to-user transaction processing:
 * - User-to-user deposits and withdrawals
 * - Multi-currency wallet management
 * - Transaction history & tracking
 * - Saga-based rollback for atomic operations
 * - Event-driven balance synchronization
 * 
 * The service is agnostic to business logic (gateway, provider, etc.).
 * It only knows about users, amounts, currencies, and permissions.
 */

// Internal packages
import {
  createGateway,
  buildDefaultGatewayConfig,
  hasRole,
  hasAnyRole,
  isAuthenticated,
  allow,
  logger,
  getErrorMessage,
  on,
  startListening,
  extractDocumentId,
  GraphQLError,
  withEventHandlerError,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  resolveContext,
  initializeWebhooks,
  runServiceStartup,
  createWebhookService,
  findOneById,
  generateMongoId,
  createUniqueIndexSafe,
  createObjectModelQueryResolver,
  findUserIdByRole,
  createTransferWithTransactions,
  normalizeWalletForGraphQL,
  type IntegrationEvent,
  type ResolverContext,
  type DatabaseStrategyResolver,
  type DatabaseContext,
} from 'core-service';
import { db, redis } from './accessors.js';

// Local imports
import {
  paymentWebhooks,
  emitPaymentEvent,
  cleanupPaymentWebhookDeliveries,
  type PaymentWebhookEvents,
} from './event-dispatcher.js';
import { PAYMENT_ERROR_CODES, PAYMENT_ERRORS } from './error-codes.js';
import { loadConfig, validateConfig, printConfigSummary, setUseMongoTransactions, SERVICE_NAME, type PaymentConfig } from './config.js';
import { PAYMENT_CONFIG_DEFAULTS } from './config-defaults.js';

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
import { setupRecovery } from './recovery-setup.js';
import {
  walletService,
  walletResolvers,
  walletTypes,
} from './services/wallet.js';
import { SYSTEM_ROLE, SYSTEM_CURRENCY } from './constants.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════
export { SYSTEM_ROLE };

/**
 * Get system user ID from auth database using role-based lookup
 * Uses a user with 'system' role's bonusBalance as the bonus pool
 * This is generic and flexible - supports multiple system users if needed
 * 
 * @param tenantId - Optional tenant ID to filter by (for multi-tenant scenarios)
 * @returns System user ID
 */
async function getSystemUserId(tenantId?: string): Promise<string> {
  
  try {
    // Find user with 'system' role (role-based, not hardcoded email)
    const systemUserId = await findUserIdByRole({
      role: 'system',
      tenantId,
      throwIfNotFound: true,
    });
    
    logger.debug('System user ID resolved for bonus pool', { 
      userId: systemUserId, 
      tenantId,
      method: 'role-based' 
    });
    
    return systemUserId;
  } catch (error) {
    throw new GraphQLError(PAYMENT_ERRORS.FailedToGetSystemUserId, { 
      error: getErrorMessage(error),
      tenantId 
    });
  }
}


// Configuration will be loaded asynchronously in main()
let paymentConfig: PaymentConfig | null = null;
let paymentDbStrategy: DatabaseStrategyResolver | null = null;
let paymentDbContext: DatabaseContext | null = null;

// Gateway config (will be built from paymentConfig)
const buildGatewayConfig = (): Parameters<typeof createGateway>[0] => {
  if (!paymentConfig) throw new Error('Configuration not loaded yet');
  const config = paymentConfig;
  return buildDefaultGatewayConfig(config, {
    name: 'payment-service',
    services: [
    // Register transfer service FIRST so Transfer type is available for deposit/withdrawal results
    { name: 'transfer', types: transferService.types, resolvers: transferService.resolvers },
    { 
      name: 'deposit', 
      types: depositService.types, 
      resolvers: {
        Query: {
          deposit: depositService.resolvers.Query.deposit,
          // Override deposits query to filter by objectModel='deposit' and use cursor pagination
          deposits: createObjectModelQueryResolver(depositService.repository, 'deposit'),
        } as Record<string, any>,
        Mutation: depositService.resolvers.Mutation,
      },
    },
    { 
      name: 'withdrawal', 
      types: withdrawalService.types, 
      resolvers: {
        Query: {
          withdrawal: withdrawalService.resolvers.Query.withdrawal,
          // Override withdrawals query to filter by objectModel='withdrawal' and use cursor pagination
          withdrawals: createObjectModelQueryResolver(withdrawalService.repository, 'withdrawal'),
        } as Record<string, any>,
        Mutation: withdrawalService.resolvers.Mutation,
      },
    },
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
              const database = await db.getDb();
              const syncPromises = result.nodes.map(async (wallet: any) => {
                const isProviderWallet = wallet.userId?.startsWith('provider-');
                
                // Check if wallet belongs to a user with 'system' role (optimized: only fetch roles)
                let isSystemWallet = false;
                if (!isProviderWallet && wallet.userId) {
                  const user = await database.collection('users').findOne(
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
            
            if (result && result.nodes && Array.isArray(result.nodes)) {
              result.nodes = result.nodes.map((wallet: any) => normalizeWalletForGraphQL(wallet));
            }
            return result;
          },
          wallet: async (args: Record<string, unknown>, ctx: any) => {
            // Call the default wallet resolver
            const wallet: any = await walletService.resolvers.Query.wallet(args, ctx);
            
            if (!wallet) {
              return wallet;
            }
            
            return normalizeWalletForGraphQL(wallet);
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
          transactions(first: Int, after: String, last: Int, before: String, filter: JSON): TransactionConnection
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
      } as any // Field resolvers are valid but not in ServiceResolvers type
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
      // User wallet API
      userWallets: isAuthenticated,
      walletBalance: isAuthenticated,
      bulkWalletBalances: isAuthenticated,
      transactionHistory: isAuthenticated,
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
  });
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
  
  on<BonusAwardedData>('bonus.awarded', withEventHandlerError<IntegrationEvent<BonusAwardedData>>(PAYMENT_ERRORS.FailedToCreditBonusToWallet, async (event) => {
    logger.info('Processing bonus.awarded - crediting wallet', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      value: event.data.value,
      currency: event.data.currency,
    });
    if (!event.userId) {
      logger.warn('No userId in bonus.awarded event, cannot sync wallet', { eventId: event.eventId });
      return;
    }
    const userId = event.userId;
    const database = await db.getDb();
      const walletsCollection = database.collection('wallets');
      
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
        walletId = extractDocumentId(wallet) || undefined;
      }
      
      // Ensure walletId is defined before syncing
      if (!walletId) {
        logger.warn('Wallet ID not found for bonus credit', {
          userId: userId,
          currency: event.data.currency,
        });
        return;
      }
      
      // Get system user ID (bonus pool is system user's bonusBalance)
      const systemUserId = await getSystemUserId(event.tenantId);
      
      // Create transfer: system (bonus) -> user (bonus)
      // Uses system user's bonusBalance as the bonus pool
      try {
        const database2 = await db.getDb();
        const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
          fromUserId: systemUserId,
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
          fromBalanceType: 'bonus',  // Debit from system user's bonusBalance (bonus pool)
          toBalanceType: 'bonus',    // Credit to user bonus balance
        }, { database: database2 });
        
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
        throw new GraphQLError(PAYMENT_ERRORS.FailedToCreateBonusTransfer, { 
          error: getErrorMessage(transferError), 
          eventId: event.eventId,
          walletId,
          userId: event.userId,
        });
      }
  }));
  
  on<BonusConvertedData>('bonus.converted', withEventHandlerError<IntegrationEvent<BonusConvertedData>>(PAYMENT_ERRORS.FailedToConvertBonusToRealBalance, async (event) => {
    logger.info('Processing bonus.converted - moving to real balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      amount: event.data.amount,
    });
    const database = await db.getDb();
    const walletsCollection = database.collection('wallets');
    const wallet = await findOneById(walletsCollection, event.data.walletId, {});
    if (!wallet) {
      logger.warn('Wallet not found for bonus conversion', { walletId: event.data.walletId });
      return;
    }
    const currentBonusBalance = (wallet as any).bonusBalance || 0;
    const convertAmount = Math.min(event.data.amount, currentBonusBalance);
    if (convertAmount <= 0) {
      logger.warn('No bonus balance to convert', { walletId: event.data.walletId });
      return;
    }
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
        }, { database });
        
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
      throw new GraphQLError(PAYMENT_ERRORS.FailedToCreateBonusConversionTransfer, { 
        error: getErrorMessage(transferError), 
        eventId: event.eventId,
        walletId: event.data.walletId,
        userId: event.userId,
      });
    }
  }));
  
  on<BonusForfeitedData>('bonus.forfeited', withEventHandlerError<IntegrationEvent<BonusForfeitedData>>(PAYMENT_ERRORS.FailedToForfeitBonusFromWallet, async (event) => {
    logger.info('Processing bonus.forfeited - debiting bonus balance', {
      eventId: event.eventId,
      userId: event.userId,
      bonusId: event.data.bonusId,
      forfeitedValue: event.data.forfeitedValue,
    });
    if (!event.data.walletId) {
      logger.warn('No walletId in forfeited event, skipping wallet update');
      return;
    }
    const systemUserId = await getSystemUserId(event.tenantId);
    try {
      const database = await db.getDb();
      const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
          fromUserId: event.userId!,
          toUserId: systemUserId,
          amount: event.data.forfeitedValue,
          currency: event.data.currency || SYSTEM_CURRENCY,
          tenantId: event.tenantId,
          feeAmount: 0,
          method: 'bonus_forfeit',
          externalRef: `bonus-forfeit-${event.data.bonusId}`,
          description: `Bonus forfeited: ${event.data.reason || 'Forfeited'}`,
          fromBalanceType: 'bonus',  // Debit from user bonus balance
          toBalanceType: 'bonus',    // Credit to system user's bonusBalance (bonus pool)
          objectId: event.data.bonusId,  // Transactions reference bonus, not transfer
          objectModel: 'bonus',
          bonusId: event.data.bonusId,
          reason: event.data.reason,
        }, { database });
        
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
        error: getErrorMessage(transferError), 
        eventId: event.eventId,
        walletId: event.data.walletId,
        userId: event.userId,
      });
      throw new GraphQLError(PAYMENT_ERRORS.FailedToForfeitBonusFromWallet, {
        error: getErrorMessage(transferError),
        eventId: event.eventId,
      });
    }
  }));
  
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
      // Get system user ID (bonus pool is system user's bonusBalance)
      const systemUserId = await getSystemUserId(event.tenantId);
      
      // Create transfer: user (bonus) -> system (bonus)
      // Returns expired bonus to system user's bonusBalance (bonus pool)
      const database = await db.getDb();
      const { transfer } = await createTransferWithTransactions({
        fromUserId: event.userId!,
        toUserId: systemUserId,
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
        fromBalanceType: 'bonus',  // Debit from user bonus balance
        toBalanceType: 'bonus',    // Credit to system user's bonusBalance (bonus pool)
      }, { database });
      
      logger.info('Expired bonus removed via transfer', {
        transferId: transfer.id,
        bonusId: event.data.bonusId,
        amount: event.data.forfeitedValue,
      });
    } catch (err) {
      // Silently handle expired bonus removal failures (non-critical)
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
  await runServiceStartup<PaymentConfig>({
    serviceName: SERVICE_NAME,
    registerErrorCodes: () => registerServiceErrorCodes(PAYMENT_ERROR_CODES),
    registerConfigDefaults: () => registerServiceConfigDefaults(SERVICE_NAME, PAYMENT_CONFIG_DEFAULTS),
    resolveContext: async () => {
      const c = await resolveContext();
      return { brand: c.brand ?? 'default', tenantId: c.tenantId };
    },
    loadConfig: (brand?: string, tenantId?: string) => loadConfig(brand, tenantId),
    validateConfig,
    printConfigSummary,
    afterDb: async (context, config) => {
      paymentConfig = config;
      setUseMongoTransactions(config.useMongoTransactions ?? true);
      setupBonusEventHandlers();
      const { strategy, context: dbContext } = await db.initialize({ brand: context.brand, tenantId: context.tenantId });
      paymentDbStrategy = strategy;
      paymentDbContext = dbContext;
      logger.info('Database initialized via service database accessor', { context: dbContext });
    },
    buildGatewayConfig: () => buildGatewayConfig(),
    ensureDefaults: true,
    withRedis: {
      redis,
      afterReady: async () => {
        await startListening(['integration:bonus', 'integration:ledger']);
        logger.info('Started listening on event channels', { channels: ['integration:bonus', 'integration:ledger'] });
      },
    },
    afterGateway: async () => {
      const databaseStrategy = paymentDbStrategy!;
      const dbContext = paymentDbContext!;
      try {
        await initializeWebhooks(paymentWebhooks, { databaseStrategy, defaultContext: dbContext });
        logger.info('Payment webhooks initialized via centralized helper');
      } catch (error) {
        logger.error('Failed to initialize payment webhooks', { error });
      }
      try {
        const database = await db.getDb();
        const transactionsCollection = database.collection('transactions');
        await createUniqueIndexSafe(
          transactionsCollection,
          { 'metadata.externalRef': 1 },
          { name: 'metadata.externalRef_1_unique', dropConflictNames: ['metadata.externalRef_1', 'metadata.externalRef_1_unique'] }
        );
      } catch (indexError: unknown) {
        logger.error('Failed to ensure unique index on metadata.externalRef', { error: getErrorMessage(indexError) });
      }
      try {
        await setupRecovery();
        logger.info('✅ Recovery system initialized');
      } catch (err) {
        logger.warn('Could not setup recovery system', { error: (err as Error).message });
      }
      setInterval(async () => {
        try {
          const deleted = await cleanupPaymentWebhookDeliveries(30);
          if (deleted > 0) logger.info(`Cleaned up ${deleted} old payment webhook deliveries`);
        } catch (err) {
          logger.error('Webhook cleanup failed', { error: err });
        }
      }, 24 * 60 * 60 * 1000);
    },
  });
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
