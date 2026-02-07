/**
 * Bonus Service
 * Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below.
 *
 * Multi-domain bonus and reward management (betting, crypto, social, gaming, ecommerce, fintech). Features:
 * - Multiple bonus types (welcome, deposit, referral, wagering, etc.)
 * - Saga-based state management with rollback
 * - Wagering requirements tracking
 * - Referral program management
 * - Multi-tenant support
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
  on,
  startListening,
  getUserId,
  createWebhookService,
  requireAuth,
  GraphQLError,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  ensureServiceDefaultConfigsCreated,
  resolveContext,
  initializeWebhooks,
  withRedis,
  type IntegrationEvent,
  type ResolverContext,
} from 'core-service';
import { db, redis } from './accessors.js';
import { hasAnyRole as hasAnyRoleAccess } from 'core-service/access';

// Local imports
import { BONUS_ERRORS, BONUS_ERROR_CODES } from './error-codes.js';
import { setupRecovery } from './recovery-setup.js';
import { createBonusEngine, type BonusEngineOptions } from './services/bonus-engine/index.js';
import { loadConfig, validateConfig, printConfigSummary, setUseMongoTransactions, SERVICE_NAME, type BonusConfig } from './config.js';
import { BONUS_CONFIG_DEFAULTS } from './config-defaults.js';
import {
  bonusWebhooks,
  emitBonusEvent,
  cleanupBonusWebhookDeliveries,
  type BonusWebhookEvents,
} from './event-dispatcher.js';

// Re-export for consumers
export { emitBonusEvent, type BonusWebhookEvents };

/**
 * Complete webhook service - ready to plug into gateway.
 * Single line to add webhooks to any service!
 */
const webhookService = createWebhookService({
  manager: bonusWebhooks,
  eventsDocs: `
    Bonus Service Webhook Events:
    • bonus.awarded - Bonus credited to user
    • bonus.activated - Bonus usage started  
    • bonus.converted - Bonus converted to real balance
    • bonus.forfeited - Bonus forfeited
    • bonus.expired - Bonus expired
    • bonus.cancelled - Bonus cancelled by user
    • bonus.requirements_met - Turnover requirements completed
    • bonus.* - All bonus events (wildcard)
  `,
});

import { 
  bonusTemplateService, 
  userBonusService, 
  bonusTransactionService 
} from './services/bonus.js';

import type { BonusTemplate } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Database Strategy & Persistence Initialization
// ═══════════════════════════════════════════════════════════════════

// Import centralized persistence singleton (avoids circular deps)
import { 
  initializeDatabaseLayer, 
  getInitializedPersistence,
} from './services/bonus-engine/persistence-singleton.js';

// Configuration will be loaded asynchronously in main()
let bonusConfig: BonusConfig | null = null;

// Bonus engine instance (initialized lazily)
let bonusEngineInstance: ReturnType<typeof createBonusEngine> | undefined;

// Re-export persistence getter for use by other modules
export { getInitializedPersistence as initializePersistence };

async function initializeBonusEngine(): Promise<ReturnType<typeof createBonusEngine>> {
  if (!bonusEngineInstance) {
    const { strategy, context } = await initializeDatabaseLayer();
    const options: BonusEngineOptions = {
      databaseStrategy: strategy,
      defaultContext: context,
    };
    bonusEngineInstance = createBonusEngine(options);
    logger.info('Bonus engine initialized with database strategy');
  }
  return bonusEngineInstance;
}

// Import handler registry for initialization
import { handlerRegistry } from './services/bonus-engine/handler-registry.js';

async function initializeHandlerRegistry(): Promise<void> {
  // Use the centralized initializeDatabaseLayer from persistence-singleton
  const { strategy, context } = await initializeDatabaseLayer();
  handlerRegistry.initialize({
    databaseStrategy: strategy,
    defaultContext: context,
  });
  logger.info('Handler registry initialized with database strategy');
}

// ═══════════════════════════════════════════════════════════════════
// Custom Resolvers for Client-Side Eligibility and Role-Based Filtering
// ═══════════════════════════════════════════════════════════════════

/**
 * Custom resolver to fetch available bonuses for client-side eligibility checking.
 * Returns all active templates with fields needed for BonusEligibility class.
 */
const availableBonusesResolver = {
  Query: {
    bonusTemplateByCode: async (
      args: Record<string, unknown>,
      _ctx: ResolverContext
    ): Promise<BonusTemplate | null> => {
      const code = args.code as string;
      if (!code) {
        return null;
      }
      const persistence = await getInitializedPersistence();
      return await persistence.template.findByCode(code);
    },
    
    /**
     * Fetch active bonus templates for client-side eligibility checking.
     * 
     * @param currency - Optional: filter by supported currency
     * @param domain - Optional: filter by domain (casino, sports, etc.)
     * @param type - Optional: filter by bonus type
     * 
     * Usage on client:
     * ```graphql
     * query {
     *   availableBonuses(currency: "USD") {
     *     id name code type domain value currency
     *     minDeposit maxValue validFrom validUntil
     *     eligibleTiers minSelections maxSelections
     *   }
     * }
     * ```
     * Then use with BonusEligibility.checkMany(templates, context)
     */
    availableBonuses: async (
      args: Record<string, unknown>,
      _ctx: ResolverContext
    ): Promise<BonusTemplate[]> => {
      const persistence = await getInitializedPersistence();
      const tenantId = _ctx.user?.tenantId as string | undefined;
      
      const now = new Date();
      const filter: Record<string, unknown> = {
        isActive: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      };
      
      // Filter by currency if provided
      if (args.currency) {
        filter.$or = [
          { supportedCurrencies: { $exists: false } },
          { supportedCurrencies: { $size: 0 } },
          { supportedCurrencies: args.currency },
        ];
      }
      
      // Filter by domain if provided
      if (args.domain) {
        filter.domain = { $in: [args.domain, 'universal'] };
      }
      
      // Filter by type if provided
      if (args.type) {
        filter.type = args.type;
      }
      
      // Use persistence layer to find active templates
      const allTemplates = await persistence.template.findActive(filter, tenantId);
      
      // Sort by priority
      return allTemplates.sort((a, b) => b.priority - a.priority);
    },
  },
  Mutation: {}, // Required by Resolvers type
};

/** Apply list scope: system/admin see all; others get args with filter merged with userId. */
function withListScope(
  args: Record<string, unknown>,
  ctx: ResolverContext,
  opts: { userIdFilterKey: string }
): Record<string, unknown> {
  const user = ctx.user;
  if (!user) return args;
  if (hasRole('system')(user) || hasAnyRole('system', 'admin', 'super-admin')(user)) return args;
  const filter = (args.filter as Record<string, unknown>) || {};
  return { ...args, filter: { ...filter, [opts.userIdFilterKey]: user.userId } };
}

/**
 * Custom resolver for userBonuss query to enforce role-based filtering.
 * System/admin users can see all bonuses, regular users only see their own.
 */
const userBonussCustomResolver = {
  Query: {
    userBonuss: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const defaultResolver = userBonusService.resolvers?.Query?.userBonuss;
      if (!defaultResolver) {
        throw new GraphQLError(BONUS_ERRORS.ResolverNotFound, { resolver: 'userBonuss' });
      }
      const scopedArgs = withListScope(args, ctx, { userIdFilterKey: 'userId' });
      return defaultResolver(scopedArgs, ctx);
    },
  },
};

const bonusApprovalTypeDefs = `
  type PendingBonus {
    token: String!
    userId: String!
    tenantId: String!
    templateId: String!
    templateCode: String!
    bonusType: String!
    calculatedValue: Float!
    currency: String!
    depositAmount: Float
    requestedAt: String!
    requestedBy: String
    reason: String
    expiresAt: String!
    # Full data including nested objects (context, calculation, etc.)
    rawData: JSON
  }
  
  type ApproveBonusResult {
    success: Boolean!
    bonusId: String
    error: String
  }
  
  type RejectBonusResult {
    success: Boolean!
    error: String
  }
  
  extend type Query {
    pendingBonuses(userId: String, templateCode: String): [PendingBonus!]!
    pendingBonus(token: String!): PendingBonus
  }
  
  extend type Mutation {
    approveBonus(token: String!, reason: String): ApproveBonusResult!
    rejectBonus(token: String!, reason: String!): RejectBonusResult!
  }
`;

const bonusApprovalResolvers = {
  Query: {
    pendingBonuses: async (
      args: Record<string, unknown>,
      context: ResolverContext
    ) => {
      requireAuth(context);
      if (!hasAnyRoleAccess(['system', 'admin'])(context.user!)) {
        throw new GraphQLError(BONUS_ERRORS.SystemOrAdminAccessRequired, {});
      }
      
      const { listPendingBonuses } = await import('./services/bonus-approval.js');
      const filter: { userId?: string; templateCode?: string } = {};
      if (args.userId) filter.userId = args.userId as string;
      if (args.templateCode) filter.templateCode = args.templateCode as string;
      
      const pending = await listPendingBonuses(filter);
      
      return pending.map(item => ({
        token: item.token,
        userId: item.data.userId,
        tenantId: item.data.tenantId,
        templateId: item.data.templateId,
        templateCode: item.data.templateCode,
        bonusType: item.data.bonusType,
        calculatedValue: item.data.calculatedValue,
        currency: item.data.currency,
        depositAmount: item.data.depositAmount,
        requestedAt: new Date(item.data.requestedAt).toISOString(),
        requestedBy: item.data.requestedBy,
        reason: item.data.reason,
        expiresAt: new Date(item.expiresAt).toISOString(),
        rawData: item.data, // Include full data with context, calculation, etc.
      }));
    },
    
    pendingBonus: async (
      args: Record<string, unknown>,
      context: ResolverContext
    ) => {
      requireAuth(context);
      if (!hasAnyRoleAccess(['system', 'admin'])(context.user!)) {
        throw new GraphQLError(BONUS_ERRORS.SystemOrAdminAccessRequired, {});
      }
      
      const { getPendingBonus } = await import('./services/bonus-approval.js');
      const token = args.token as string;
      const pending = await getPendingBonus(token);
      
      if (!pending) {
        return null;
      }
      
      if (!redis.isInitialized()) {
        throw new GraphQLError(BONUS_ERRORS.RedisNotAvailable, {});
      }
      
      const ttl = await redis.ttl(`pending:bonus:approval:${token}`);
      const expiresAt = Date.now() + (ttl * 1000);
      
      return {
        token,
        userId: pending.userId,
        tenantId: pending.tenantId,
        templateId: pending.templateId,
        templateCode: pending.templateCode,
        bonusType: pending.bonusType,
        calculatedValue: pending.calculatedValue,
        currency: pending.currency,
        depositAmount: pending.depositAmount,
        requestedAt: new Date(pending.requestedAt).toISOString(),
        requestedBy: pending.requestedBy,
        reason: pending.reason,
        expiresAt: new Date(expiresAt).toISOString(),
        rawData: pending, // Include full data with context, calculation, etc.
      };
    },
    
  },
  
  Mutation: {
    approveBonus: async (
      args: Record<string, unknown>,
      context: ResolverContext
    ) => {
      requireAuth(context);
      if (!hasAnyRoleAccess(['system', 'admin'])(context.user!)) {
        throw new GraphQLError(BONUS_ERRORS.SystemOrAdminAccessRequired, {});
      }
      
      const { approvePendingBonus } = await import('./services/bonus-approval.js');
      
      const token = args.token as string;
      const reason = args.reason as string | undefined;
      const approvedBy = (context.user as any).email || (context.user as any).username || 'system';
      const approvedByUserId = getUserId(context);
      
      const result = await approvePendingBonus(token, approvedBy, approvedByUserId);
      
      return {
        success: result.success,
        bonusId: result.bonusId,
        error: result.error,
      };
    },
    
    rejectBonus: async (
      args: Record<string, unknown>,
      context: ResolverContext
    ) => {
      requireAuth(context);
      if (!hasAnyRoleAccess(['system', 'admin'])(context.user!)) {
        throw new GraphQLError(BONUS_ERRORS.SystemOrAdminAccessRequired, {});
      }
      
      const { rejectPendingBonus } = await import('./services/bonus-approval.js');
      
      const token = args.token as string;
      const reason = args.reason as string;
      const rejectedBy = (context.user as any).email || (context.user as any).username || 'system';
      const rejectedByUserId = getUserId(context);
      
      const result = await rejectPendingBonus(token, rejectedBy, rejectedByUserId, reason);
      
      return {
        success: result.success,
        error: result.error,
      };
    },
  },
};

const availableBonusesTypeDefs = `
  extend type Query {
    bonusTemplateByCode(code: String!): BonusTemplate
  }
  extend type Query {
    """
    Fetch active bonus templates for client-side eligibility checking.
    Use with BonusEligibility.checkMany(templates, context) on client.
    """
    availableBonuses(currency: String, domain: String, type: String): [BonusTemplate!]!
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Configuration (will be loaded asynchronously in main())
// ═══════════════════════════════════════════════════════════════════

// Gateway config builder (will be built from bonusConfig)
const buildGatewayConfig = (): Parameters<typeof createGateway>[0] => {
  if (!bonusConfig) {
    throw new Error('Configuration not loaded yet');
  }
  
  const config = bonusConfig;
  return buildDefaultGatewayConfig(config, {
    name: 'bonus-service',
    services: [
      { name: 'bonusTemplate', types: bonusTemplateService.types, resolvers: bonusTemplateService.resolvers },
      { 
        name: 'userBonus', 
        types: userBonusService.types, 
        resolvers: {
          Query: {
            ...userBonusService.resolvers?.Query,
            ...userBonussCustomResolver.Query,
          },
          Mutation: {
            ...userBonusService.resolvers?.Mutation,
            createUserBonus: async (args: Record<string, unknown>, ctx: ResolverContext) => {
              // Call the default resolver
              const result = await (userBonusService.resolvers?.Mutation?.createUserBonus as any)(args, ctx);
              
              // Extract pendingToken from error message if present
              // Format: "BONUS_REQUIRES_APPROVAL|PENDING_TOKEN:{token}"
              if (!result.success && result.errors && result.errors.length > 0) {
                const errorMsg = result.errors[0];
                const tokenMatch = errorMsg.match(/PENDING_TOKEN:([^\s|]+)/);
                if (tokenMatch) {
                  return {
                    ...result,
                    pendingToken: tokenMatch[1],
                    errors: [errorMsg.replace(/\|PENDING_TOKEN:[^\s|]+/, '')], // Remove token from error message
                  };
                }
              }
              
              return result;
            },
          },
        }
      },
      { name: 'bonusTransaction', types: bonusTransactionService.types, resolvers: bonusTransactionService.resolvers },
      { name: 'bonusApproval', types: bonusApprovalTypeDefs, resolvers: bonusApprovalResolvers },
      { name: 'availableBonuses', types: availableBonusesTypeDefs, resolvers: availableBonusesResolver },
      webhookService,
    ],
    permissions: {
      Query: {
        health: allow,
        bonusTemplates: hasAnyRole('system', 'admin', 'super-admin'),
        bonusTemplate: hasAnyRole('system', 'admin', 'super-admin'),
        bonusTemplateByCode: hasAnyRole('system', 'admin', 'super-admin'),
        availableBonuses: isAuthenticated,
        userBonuss: isAuthenticated,
        userBonus: isAuthenticated,
        bonusTransactions: isAuthenticated,
        bonusTransaction: isAuthenticated,
        pendingBonuses: hasAnyRole('system', 'admin'),
        pendingBonus: hasAnyRole('system', 'admin'),
        webhooks: hasRole('system'),
        webhook: hasRole('system'),
        webhookStats: hasRole('system'),
        webhookDeliveries: hasRole('system'),
      },
      Mutation: {
        claimBonus: isAuthenticated,
        recordActivity: isAuthenticated,
        createBonusTemplate: hasAnyRole('system', 'admin'),
        createUserBonus: hasAnyRole('system', 'admin'),
        createBonusTransaction: hasAnyRole('system', 'admin'),
        approveBonus: hasAnyRole('system', 'admin'),
        rejectBonus: hasAnyRole('system', 'admin'),
        registerWebhook: hasRole('system'),
        updateWebhook: hasRole('system'),
        deleteWebhook: hasRole('system'),
        testWebhook: hasRole('system'),
      },
    },
  });
};

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Cross-Service Event Handlers
// ═══════════════════════════════════════════════════════════════════

interface WalletEventData {
  transactionId: string;
  walletId: string;
  type: string;
  amount: number;
  currency: string;
  balanceAfter: number;
}

interface ActivityEventData {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  category?: string;
}

function setupEventHandlers() {
  // ═══════════════════════════════════════════════════════════════════
  // Deposit Events - Auto-award bonuses
  // ═══════════════════════════════════════════════════════════════════
  
  on<WalletEventData>('wallet.deposit.completed', async (event: IntegrationEvent<WalletEventData>) => {
    logger.info('Processing deposit for bonus eligibility', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
      currency: event.data.currency,
    });
    
    try {
      // Use bonusEngine to check eligibility and award bonuses
      const engine = await initializeBonusEngine();
      const awardedBonuses = await engine.handleDeposit({
        transactionId: event.data.transactionId,
        walletId: event.data.walletId,
        userId: event.userId!,
        tenantId: event.tenantId,
        amount: event.data.amount,
        currency: event.data.currency,
      });
      
      if (awardedBonuses.length > 0) {
        logger.info('Bonuses awarded on deposit', {
          userId: event.userId,
          bonuses: awardedBonuses.map(b => ({ id: b.id, type: b.type, value: b.originalValue })),
        });
      }
    } catch (err) {
      logger.error('Failed to process deposit for bonuses', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Purchase Events - Auto-award first_purchase bonuses
  // ═══════════════════════════════════════════════════════════════════
  
  on<WalletEventData>('wallet.purchase.completed', async (event: IntegrationEvent<WalletEventData>) => {
    logger.info('Processing purchase for bonus eligibility', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
      currency: event.data.currency,
    });
    
    try {
      // Use bonusEngine to check eligibility and award bonuses
      // Metadata check (isFirstPurchase) happens in FirstPurchaseHandler.validateSpecific
      const engine = await initializeBonusEngine();
      const awardedBonuses = await engine.handlePurchase({
        transactionId: event.data.transactionId,
        walletId: event.data.walletId,
        userId: event.userId!,
        tenantId: event.tenantId,
        amount: event.data.amount,
        currency: event.data.currency,
      });
      
      if (awardedBonuses.length > 0) {
        logger.info('Bonuses awarded on purchase', {
          userId: event.userId,
          bonuses: awardedBonuses.map(b => ({ id: b.id, type: b.type, value: b.originalValue })),
        });
      }
    } catch (err) {
      logger.error('Failed to process purchase for bonuses', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Action Events - Auto-award first_action bonuses (bet, game action, etc.)
  // ═══════════════════════════════════════════════════════════════════
  
  on<WalletEventData>('wallet.bet.completed', async (event: IntegrationEvent<WalletEventData>) => {
    logger.info('Processing bet for bonus eligibility', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
      currency: event.data.currency,
    });
    
    try {
      // First bet can be considered first action
      // Metadata check (hasCompletedFirstAction) happens in FirstActionHandler.validateSpecific
      const engine = await initializeBonusEngine();
      const awardedBonuses = await engine.handleAction({
        transactionId: event.data.transactionId,
        walletId: event.data.walletId,
        userId: event.userId!,
        tenantId: event.tenantId,
        amount: event.data.amount,
        currency: event.data.currency,
      });
      
      if (awardedBonuses.length > 0) {
        logger.info('Bonuses awarded on bet', {
          userId: event.userId,
          bonuses: awardedBonuses.map(b => ({ id: b.id, type: b.type, value: b.originalValue })),
        });
      }
    } catch (err) {
      logger.error('Failed to process bet for bonuses', { error: err, eventId: event.eventId });
    }
  });
  
  on<WalletEventData>('wallet.action.completed', async (event: IntegrationEvent<WalletEventData>) => {
    logger.info('Processing action for bonus eligibility', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
      currency: event.data.currency,
    });
    
    try {
      // Metadata check (hasCompletedFirstAction) happens in FirstActionHandler.validateSpecific
      const engine = await initializeBonusEngine();
      const awardedBonuses = await engine.handleAction({
        transactionId: event.data.transactionId,
        walletId: event.data.walletId,
        userId: event.userId!,
        tenantId: event.tenantId,
        amount: event.data.amount,
        currency: event.data.currency,
      });
      
      if (awardedBonuses.length > 0) {
        logger.info('Bonuses awarded on action', {
          userId: event.userId,
          bonuses: awardedBonuses.map(b => ({ id: b.id, type: b.type, value: b.originalValue })),
        });
      }
    } catch (err) {
      logger.error('Failed to process action for bonuses', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Withdrawal Events - Potential bonus forfeit
  // ═══════════════════════════════════════════════════════════════════
  
  on<WalletEventData>('wallet.withdrawal.completed', async (event: IntegrationEvent<WalletEventData>) => {
    logger.info('Processing withdrawal for bonus status', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
    });
    
    // Note: Withdrawals while bonus is active may forfeit the bonus
    // This depends on business rules - implement if needed
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Activity Events - Turnover tracking
  // ═══════════════════════════════════════════════════════════════════
  
  on<ActivityEventData>('activity.completed', async (event: IntegrationEvent<ActivityEventData>) => {
    logger.info('Processing activity for turnover', {
      eventId: event.eventId,
      userId: event.userId,
      amount: event.data.amount,
      category: event.data.category,
    });
    
    try {
      const engine = await initializeBonusEngine();
      await engine.handleActivity({
        userId: event.data.userId || event.userId!,
        tenantId: event.tenantId,
        amount: event.data.amount,
        currency: event.data.currency,
        category: event.data.category,
        transactionId: event.data.transactionId,
      });
    } catch (err) {
      logger.error('Failed to process activity for turnover', { error: err, eventId: event.eventId });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // User Events
  // ═══════════════════════════════════════════════════════════════════
  
  on('user.birthday', async (event: IntegrationEvent<{ birthDate: string }>) => {
    logger.info('Processing birthday bonus', { userId: event.userId });
    
    try {
      const engine = await initializeBonusEngine();
      const result = await engine.award('birthday', {
        userId: event.userId!,
        tenantId: event.tenantId,
      });
      if (result.success && result.bonus) {
        logger.info('Birthday bonus awarded', { bonusId: result.bonus.id });
      }
    } catch (err) {
      logger.error('Failed to award birthday bonus', { error: err });
    }
  });
  
  on('user.login', async (event: IntegrationEvent<{ consecutiveDays: number }>) => {
    try {
      const engine = await initializeBonusEngine();
      const result = await engine.award('daily_login', {
        userId: event.userId!,
        tenantId: event.tenantId,
        consecutiveDays: event.data.consecutiveDays,
      });
      if (result.success && result.bonus) {
        logger.info('Daily login bonus awarded', { bonusId: result.bonus.id, streak: event.data.consecutiveDays });
      }
    } catch (err) {
      logger.error('Failed to award daily login bonus', { error: err });
    }
  });
  
  on('user.tier_upgraded', async (event: IntegrationEvent<{ newTier: string }>) => {
    logger.info('Processing tier upgrade bonus', { userId: event.userId, tier: event.data.newTier });
    
    try {
      const engine = await initializeBonusEngine();
      const result = await engine.award('tier_upgrade', {
        userId: event.userId!,
        tenantId: event.tenantId,
        newTier: event.data.newTier,
      });
      if (result.success && result.bonus) {
        logger.info('Tier upgrade bonus awarded', { bonusId: result.bonus.id });
      }
    } catch (err) {
      logger.error('Failed to award tier upgrade bonus', { error: err });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Referral Events
  // ═══════════════════════════════════════════════════════════════════
  
  on('referral.qualified', async (event: IntegrationEvent<{ 
    referrerId: string; 
    refereeId: string;
    depositAmount?: number;
    currency?: string;
  }>) => {
    logger.info('Processing referral bonus', { 
      referrerId: event.data.referrerId,
      refereeId: event.data.refereeId,
    });
    
    try {
      // Award bonus to referrer
      const engine = await initializeBonusEngine();
      const referrerResult = await engine.award('referral', {
        userId: event.data.referrerId,
        tenantId: event.tenantId,
        refereeId: event.data.refereeId,
        depositAmount: event.data.depositAmount,
        currency: event.data.currency,
      });
      if (referrerResult.success && referrerResult.bonus) {
        logger.info('Referrer bonus awarded', { bonusId: referrerResult.bonus.id });
      }
      
      // Award bonus to referee
      const refereeResult = await engine.award('referee', {
        userId: event.data.refereeId,
        tenantId: event.tenantId,
        referrerId: event.data.referrerId,
        depositAmount: event.data.depositAmount,
        currency: event.data.currency,
      });
      if (refereeResult.success && refereeResult.bonus) {
        logger.info('Referee bonus awarded', { bonusId: refereeResult.bonus.id });
      }
    } catch (err) {
      logger.error('Failed to process referral bonus', { error: err });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Achievement Events
  // ═══════════════════════════════════════════════════════════════════
  
  on('achievement.unlocked', async (event: IntegrationEvent<{ achievementCode: string }>) => {
    logger.info('Processing achievement bonus', { 
      userId: event.userId,
      achievement: event.data.achievementCode,
    });
    
    try {
      const engine = await initializeBonusEngine();
      const result = await engine.award('achievement', {
        userId: event.userId!,
        tenantId: event.tenantId,
        achievementCode: event.data.achievementCode,
      });
      if (result.success && result.bonus) {
        logger.info('Achievement bonus awarded', { bonusId: result.bonus.id });
      }
    } catch (err) {
      logger.error('Failed to award achievement bonus', { error: err });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Loss/Cashback Events
  // ═══════════════════════════════════════════════════════════════════
  
  on('user.weekly_loss', async (event: IntegrationEvent<{ lossAmount: number; currency: string }>) => {
    logger.info('Processing cashback bonus', { 
      userId: event.userId,
      loss: event.data.lossAmount,
    });
    
    try {
      const engine = await initializeBonusEngine();
      const result = await engine.award('cashback', {
        userId: event.userId!,
        tenantId: event.tenantId,
        lossAmount: event.data.lossAmount,
        currency: event.data.currency,
      });
      if (result.success && result.bonus) {
        logger.info('Cashback bonus awarded', { bonusId: result.bonus.id, value: result.bonus.originalValue });
      }
    } catch (err) {
      logger.error('Failed to award cashback bonus', { error: err });
    }
  });
  
  logger.info('Event handlers registered', {
    handlers: [
      'wallet.deposit.completed',
      'wallet.withdrawal.completed',
      'activity.completed',
      'user.birthday',
      'user.login',
      'user.tier_upgraded',
      'referral.qualified',
      'achievement.unlocked',
      'user.weekly_loss',
    ],
  });
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════
  // Configuration
  // ═══════════════════════════════════════════════════════════════════

  // Register error codes
  registerServiceErrorCodes(BONUS_ERROR_CODES);

  // Register default configs (auto-created in DB if missing)
  registerServiceConfigDefaults(SERVICE_NAME, BONUS_CONFIG_DEFAULTS);

  // Load config (MongoDB + env vars + defaults)
  // Resolve brand/tenantId dynamically (from user context, config store, or env vars)
  const context = await resolveContext();
  bonusConfig = await loadConfig(context.brand, context.tenantId);
  validateConfig(bonusConfig);
  printConfigSummary(bonusConfig);
  setUseMongoTransactions(bonusConfig.useMongoTransactions ?? true);

  // ═══════════════════════════════════════════════════════════════════
  // Initialize Services
  // ═══════════════════════════════════════════════════════════════════

  // Register event handlers before starting gateway
  setupEventHandlers();

  // ═══════════════════════════════════════════════════════════════════
  // Initialize Handler Registry BEFORE Gateway
  // ═══════════════════════════════════════════════════════════════════
  
  // Handler registry must be initialized with database strategy BEFORE
  // gateway starts accepting requests, otherwise handlers will be created
  // without database options and fail with "BonusPersistence requires database"
  await initializeHandlerRegistry();

  // ═══════════════════════════════════════════════════════════════════
  // Gateway Configuration
  // ═══════════════════════════════════════════════════════════════════

  // Create gateway (this connects to database and starts accepting requests)
  await createGateway(buildGatewayConfig());

  await withRedis(bonusConfig.redisUrl, redis, { brand: context.brand ?? 'default' });

  await ensureServiceDefaultConfigsCreated(SERVICE_NAME, context);

  // Initialize bonus webhooks AFTER database connection is established
  try {
    const { strategy, context: dbContext } = await initializeDatabaseLayer();
    // Use centralized initializeWebhooks helper from core-service
    await initializeWebhooks(bonusWebhooks, {
      databaseStrategy: strategy,
      defaultContext: dbContext,
    });
    logger.info('Bonus webhooks initialized via centralized helper');
  } catch (error) {
    logger.error('Failed to initialize bonus webhooks', { error });
    // Continue - webhooks are optional
  }
  
  // Ledger initialization removed - using simplified architecture (wallets + transactions + transfers)
  // Wallets are created automatically via createTransferWithTransactions
  logger.info('Bonus service initialized - using wallets + transactions + transfers architecture');
  
  // Setup recovery system (transfer recovery + recovery job)
  // Bonus operations use createTransferWithTransactions, so they need transfer recovery
  try {
    await setupRecovery();
    logger.info('✅ Recovery system initialized');
  } catch (err) {
    logger.warn('Could not setup recovery system', { error: (err as Error).message });
    // Don't throw - service can still run without recovery
  }

  // Note: User status flags are now stored in auth-service user.metadata
  // No need for separate user_status collection - consistent with payment-service architecture
  
  // Cleanup old webhook deliveries daily
  setInterval(async () => {
    try {
      const deleted = await cleanupBonusWebhookDeliveries(30);
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old bonus webhook deliveries`);
      }
    } catch (err) {
      logger.error('Webhook cleanup failed', { error: err });
    }
  }, 24 * 60 * 60 * 1000); // Daily
  
  // Start listening to Redis channels after gateway is up
  if (bonusConfig.redisUrl) {
    try {
      // Subscribe to all relevant event channels
      const channels = [
        'integration:wallet',    // wallet.deposit.completed, wallet.withdrawal.completed
        'integration:activity',  // activity.completed (turnover tracking)
        'integration:user',      // user.birthday, user.login, user.tier_upgraded
        'integration:referral',  // referral.qualified
        'integration:achievement', // achievement.unlocked
      ];
      await startListening(channels);
      logger.info('Started listening on event channels', { channels });
      
      // Start periodic bonus expiration check (every hour)
      setInterval(async () => {
        try {
          const engine = await initializeBonusEngine();
          const expired = await engine.expireOldBonuses();
          if (expired > 0) {
            logger.info(`Expired ${expired} bonuses`);
          }
        } catch (err) {
          logger.error('Bonus expiration check failed', { error: err });
        }
      }, 60 * 60 * 1000); // Every hour
      
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  }
}

// Export webhook manager for advanced use cases (direct dispatch without internal events)
export { bonusWebhooks };

main().catch((err) => {
  logger.error('Failed to start bonus-service', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

// Setup process-level error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in bonus-service', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in bonus-service', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit - log and continue (some rejections are acceptable)
});

// Export types for consumers
export type { 
  BonusType, 
  BonusDomain, 
  BonusStatus, 
  BonusValueType,
  Currency,
  BonusTemplate, 
  UserBonus, 
  BonusTransaction,
  BonusHistoryEntry,
  ReferralBonusConfig,
  ReferralSummary,
  ClaimBonusInput,
  RecordActivityInput,
  BonusEligibilityResult,
} from './types.js';
