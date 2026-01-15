/**
 * Bonus Service - Multi-domain bonus and reward management
 * 
 * Supports: betting, crypto, social, gaming, ecommerce, fintech
 * 
 * Features:
 * - Multiple bonus types (welcome, deposit, referral, wagering, etc.)
 * - Saga-based state management with rollback
 * - Wagering requirements tracking
 * - Referral program management
 * - Multi-tenant support
 */

import {
  createGateway,
  // Legacy permission helpers (work without graphql-shield runtime)
  hasRole,
  isAuthenticated,
  allow,
  and,
  or,
  logger,
  on,
  startListening,
  getDatabase,
  // Webhooks - plug-and-play service
  createWebhookService,
  type IntegrationEvent,
  type ResolverContext,
} from 'core-service';

// Import unified event dispatcher (handles both internal events + webhooks)
import {
  bonusWebhooks,
  emitBonusEvent,
  initializeBonusWebhooks,
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

import { bonusEngine } from './services/bonus-engine/index.js';
import type { BonusTemplate } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Custom Resolvers for Client-Side Eligibility
// ═══════════════════════════════════════════════════════════════════

/**
 * Custom resolver to fetch available bonuses for client-side eligibility checking.
 * Returns all active templates with fields needed for BonusEligibility class.
 */
const availableBonusesResolver = {
  Query: {
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
      const db = getDatabase();
      
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
      
      const templates = await db.collection('bonus_templates')
        .find(filter)
        .sort({ priority: -1 })
        .toArray();
      
      return templates as unknown as BonusTemplate[];
    },
  },
  Mutation: {}, // Required by Resolvers type
};

// GraphQL type extension for custom query
const availableBonusesTypeDefs = `
  extend type Query {
    """
    Fetch active bonus templates for client-side eligibility checking.
    Use with BonusEligibility.checkMany(templates, context) on client.
    """
    availableBonuses(currency: String, domain: String, type: String): [BonusTemplate!]!
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const config = {
  name: 'bonus-service',
  port: parseInt(process.env.PORT || '3005'),
  cors: {
    origins: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  },
  jwt: {
    secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
    expiresIn: '8h',
  },
  services: [
    { name: 'bonusTemplate', types: bonusTemplateService.types, resolvers: bonusTemplateService.resolvers },
    { name: 'userBonus', types: userBonusService.types, resolvers: userBonusService.resolvers },
    { name: 'bonusTransaction', types: bonusTransactionService.types, resolvers: bonusTransactionService.resolvers },
    // Custom resolver for client-side eligibility
    { name: 'availableBonuses', types: availableBonusesTypeDefs, resolvers: availableBonusesResolver },
    // Webhooks - just plug it in!
    webhookService,
  ],
  // Permission rules using URN-based helpers
  permissions: {
    Query: {
      health: allow,
      // Templates (read) - any authenticated user
      bonusTemplates: isAuthenticated,
      bonusTemplate: isAuthenticated,
      availableBonuses: isAuthenticated, // Client-side eligibility check
      // User bonuses (includes referral bonuses)
      userBonuss: isAuthenticated,
      userBonus: isAuthenticated,
      // Transactions (includes turnover tracking)
      bonusTransactions: isAuthenticated,
      bonusTransaction: isAuthenticated,
      // Webhooks (admin only)
      webhooks: hasRole('admin'),
      webhook: hasRole('admin'),
      webhookStats: hasRole('admin'),
      webhookDeliveries: hasRole('admin'),
    },
    Mutation: {
      // Admin: Template management
      createBonusTemplate: hasRole('admin'),
      updateBonusTemplate: hasRole('admin'),
      deleteBonusTemplate: hasRole('admin'),
      // User: Bonus operations (claim, forfeit)
      createUserBonus: isAuthenticated,
      updateUserBonus: hasRole('admin'),
      deleteUserBonus: hasRole('admin'),
      // Transactions
      createBonusTransaction: isAuthenticated,
      updateBonusTransaction: hasRole('admin'),
      deleteBonusTransaction: hasRole('admin'),
      // Webhooks (admin only)
      registerWebhook: hasRole('admin'),
      updateWebhook: hasRole('admin'),
      deleteWebhook: hasRole('admin'),
      testWebhook: hasRole('admin'),
    },
  },
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/bonus_service',
  redisUrl: process.env.REDIS_URL,
  defaultPermission: 'deny' as const, // Secure default
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
      const awardedBonuses = await bonusEngine.handleDeposit({
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
    // await bonusEngine.forfeit(bonusId, event.userId!, 'Withdrawal while bonus active');
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
      await bonusEngine.handleActivity({
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
      const result = await bonusEngine.award('birthday', {
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
      const result = await bonusEngine.award('daily_login', {
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
      const result = await bonusEngine.award('tier_upgrade', {
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
      const referrerResult = await bonusEngine.award('referral', {
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
      const refereeResult = await bonusEngine.award('referee', {
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
      const result = await bonusEngine.award('achievement', {
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
      const result = await bonusEngine.award('cashback', {
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
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                       BONUS SERVICE                                   ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Design Patterns:                                                     ║
║  • Strategy Pattern - Handler per bonus type                          ║
║  • Template Method - Base handler defines algorithm                   ║
║  • Factory/Registry - Dynamic handler registration                    ║
║  • Chain of Responsibility - Validator chain                          ║
║  • Facade Pattern - Clean BonusEngine API                             ║
║                                                                       ║
║  Bonus Types Supported:                                               ║
║  • Welcome, First Deposit, Reload, Top-up                             ║
║  • Referral (Referrer & Referee rewards, Commission)                  ║
║  • Cashback, Consolation, Winback                                     ║
║  • Loyalty, Loyalty Points, VIP, Tier Upgrade                         ║
║  • Birthday, Anniversary, Seasonal                                    ║
║  • Daily Login, Streak, Flash                                         ║
║  • Achievement, Milestone, Task Completion, Challenge                 ║
║  • Tournament, Leaderboard, Promo Code, Special Event                 ║
║  • Free Credit, Trial, Selection, Combo                               ║
║                                                                       ║
║  Domains: betting, crypto, social, gaming, ecommerce, fintech         ║
║                                                                       ║
║  Events Listening:                                                    ║
║  • wallet.deposit.completed → Auto-award deposit bonuses              ║
║  • wallet.withdrawal.completed → Check forfeit rules                  ║
║  • activity.completed → Track turnover progress                       ║
║  • user.birthday, user.login, user.tier_upgraded                      ║
║  • referral.qualified, achievement.unlocked                           ║
║  • user.weekly_loss → Cashback bonuses                                ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  console.log('Environment:');
  console.log(`  PORT:       ${config.port}`);
  console.log(`  MONGO_URI:  ${process.env.MONGO_URI || 'mongodb://localhost:27017/bonus_service'}`);
  console.log(`  REDIS_URL:  ${process.env.REDIS_URL || 'not configured'}`);
  console.log('');

  // Register event handlers before starting gateway
  setupEventHandlers();

  await createGateway({
    ...config,
  });
  
  // Initialize bonus webhooks (unified event dispatcher)
  await initializeBonusWebhooks();
  
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
  if (process.env.REDIS_URL) {
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
          const expired = await bonusEngine.expireOldBonuses();
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
  logger.error('Failed to start bonus-service', { error: err.message });
  process.exit(1);
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
