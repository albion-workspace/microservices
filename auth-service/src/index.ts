/**
 * Authentication Service
 * Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below.
 *
 * Comprehensive authentication and authorization service with:
 * - Multi-identifier registration (username/email/phone)
 * - Social authentication (Google, Facebook, LinkedIn, Instagram)
 * - Multi-channel OTP (Email, SMS, WhatsApp, Telegram)
 * - Password management (forgot, reset, change)
 * - Two-factor authentication (TOTP + backup codes)
 * - Session management
 * - JWT + refresh tokens
 * - Account security (validation)
 * 
 * Restart trigger: ${Date.now()}
 */

import {
  createGateway,
  buildDefaultGatewayConfig,
  hasRole,
  hasAnyRole,
  isAuthenticated,
  allow,
  can,
  or,
  and,
  isOwner,
  logger,
  on,
  startListening,
  createWebhookService,
  setupCleanupTasks,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  getErrorMessage,
  resolveContext,
  initializeWebhooks,
  runServiceStartup,
  type IntegrationEvent,
  type ResolverContext,
  type DatabaseStrategyResolver,
  type DatabaseContext,
} from 'core-service';
import { db, redis } from './accessors.js';

import { loadConfig, validateConfig, printConfigSummary, setAuthConfig, SERVICE_NAME } from './config.js';
import { AUTH_CONFIG_DEFAULTS, GATEWAY_JWT_DEFAULTS, GATEWAY_DATABASE_DEFAULTS, GATEWAY_COMMON_DEFAULTS } from './config-defaults.js';
import { configurePassport } from './providers/passport-strategies.js';
import { setupOAuthRoutes } from './oauth-routes.js';
import { OTPProviderFactory } from './providers/otp-provider.js';
import { 
  RegistrationService,
  AuthenticationService,
  OTPService,
  PasswordService,
  TwoFactorService,
} from './services/index.js';
import { authGraphQLTypes, createAuthResolvers } from './graphql.js';
import {
  authWebhooks,
  emitAuthEvent,
  cleanupAuthWebhookDeliveries,
  type AuthWebhookEvents,
} from './event-dispatcher.js';
import { AUTH_ERROR_CODES } from './error-codes.js';

// Re-export for consumers
export { emitAuthEvent, type AuthWebhookEvents };

// ═══════════════════════════════════════════════════════════════════
// Service Instances (initialized in main function)
// ═══════════════════════════════════════════════════════════════════

let authConfig: Awaited<ReturnType<typeof loadConfig>>;
let otpProviders: OTPProviderFactory;
let authenticationService: AuthenticationService;
let registrationService: RegistrationService;
let otpService: OTPService;
let passwordService: PasswordService;
let twoFactorService: TwoFactorService;
let authResolvers: ReturnType<typeof createAuthResolvers>;
let authWebhookServiceInstance: ReturnType<typeof createWebhookService> | null = null;
let authDatabaseStrategy: DatabaseStrategyResolver | null = null;
let authDefaultContext: DatabaseContext | null = null;



// ═══════════════════════════════════════════════════════════════════
// Cross-Service Event Handlers
// ═══════════════════════════════════════════════════════════════════

function setupEventHandlers() {
  // ═══════════════════════════════════════════════════════════════════
  // Payment Service Events - Update User Metadata
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Generic handler for wallet events to track user activity in metadata
   * This allows other services (like bonus-service) to check user status
   * without querying large transaction tables
   * 
   * Handles: deposit, withdrawal, purchase, action, etc.
   */
  const handleWalletEvent = async (
    event: IntegrationEvent<{
      transactionId: string;
      walletId: string;
      type: string;
      amount: number;
      currency: string;
      balance: number;
    }>,
    eventType: 'deposit' | 'withdrawal' | 'purchase' | 'action' | string
  ) => {
    if (!event.userId) return;
    
    try {
      const database = await db.getDb();
      const usersCollection = database.collection('users');
      
      // Get current user metadata
      const user = await usersCollection.findOne(
        { id: event.userId, tenantId: event.tenantId },
        { projection: { metadata: 1 } }
      );
      
      const now = new Date();
      const metadataUpdates: Record<string, any> = {};
      let shouldUpdate = false;
      
      // Handle different event types
      if (eventType === 'deposit') {
        // Check if this is the user's first deposit
        const hasMadeFirstDeposit = user?.metadata?.hasMadeFirstDeposit === true;
        if (!hasMadeFirstDeposit) {
          metadataUpdates['metadata.hasMadeFirstDeposit'] = true;
          metadataUpdates['metadata.firstDepositAt'] = now;
          shouldUpdate = true;
        }
      } else if (eventType === 'withdrawal') {
        // Track first withdrawal if needed
        const hasMadeFirstWithdrawal = user?.metadata?.hasMadeFirstWithdrawal === true;
        if (!hasMadeFirstWithdrawal) {
          metadataUpdates['metadata.hasMadeFirstWithdrawal'] = true;
          metadataUpdates['metadata.firstWithdrawalAt'] = now;
          shouldUpdate = true;
        }
      } else if (eventType === 'purchase') {
        // Track first purchase
        const hasMadeFirstPurchase = user?.metadata?.hasMadeFirstPurchase === true;
        if (!hasMadeFirstPurchase) {
          metadataUpdates['metadata.hasMadeFirstPurchase'] = true;
          metadataUpdates['metadata.firstPurchaseAt'] = now;
          shouldUpdate = true;
        }
      } else if (eventType === 'action') {
        // Track first action
        const hasCompletedFirstAction = user?.metadata?.hasCompletedFirstAction === true;
        if (!hasCompletedFirstAction) {
          metadataUpdates['metadata.hasCompletedFirstAction'] = true;
          metadataUpdates['metadata.firstActionAt'] = now;
          shouldUpdate = true;
        }
      }
      
      // Update metadata if needed
      if (shouldUpdate) {
        await usersCollection.updateOne(
          { id: event.userId, tenantId: event.tenantId },
          {
            $set: {
              ...metadataUpdates,
              updatedAt: now,
            },
            $setOnInsert: {
              metadata: metadataUpdates,
            },
          },
          { upsert: false } // Don't create user - they should already exist
        );
        
        logger.info(`User ${eventType} marked in metadata`, {
          userId: event.userId,
          tenantId: event.tenantId,
          transactionId: event.data.transactionId,
          eventType,
        });
        
        // Emit generic user.metadata event for other services
        // This can be reused for all metadata updates (deposit, withdrawal, purchase, action, etc.)
        try {
          // Extract metadata fields (remove 'metadata.' prefix from keys)
          const metadataFields: Record<string, any> = {};
          Object.entries(metadataUpdates).forEach(([key, value]) => {
            if (key.startsWith('metadata.')) {
              const fieldName = key.replace('metadata.', '');
              metadataFields[fieldName] = value instanceof Date ? value.toISOString() : value;
            }
          });
          
          await emitAuthEvent('user.metadata', event.tenantId, event.userId, {
            type: eventType,
            metadata: metadataFields,
            transactionId: event.data.transactionId,
            amount: event.data.amount,
            currency: event.data.currency,
            timestamp: now.toISOString(),
          });
        } catch (err) {
          // Non-critical - log but don't fail
          logger.debug('Failed to emit user.metadata event', { error: err });
        }
      }
    } catch (error) {
      logger.error(`Failed to update user metadata on ${eventType}`, {
        error,
        userId: event.userId,
        tenantId: event.tenantId,
        eventId: event.eventId,
        eventType,
      });
      // Non-critical - don't fail the transaction
    }
  };
  
  // Map wallet transaction types to metadata event types
  // This allows us to track first-time activities for bonus eligibility
  const walletEventTypeMap: Record<string, string> = {
    'deposit': 'deposit',
    'withdrawal': 'withdrawal',
    'purchase': 'purchase',      // E-commerce purchases
    'bet': 'action',             // First bet = first action (gaming)
    'action': 'action',           // Generic first action
  };
  
  // Listen to wallet deposit events
  on<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
    isFirstDeposit?: boolean;
  }>('wallet.deposit.completed', async (event: IntegrationEvent<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
    isFirstDeposit?: boolean;
  }>) => {
    await handleWalletEvent(event, 'deposit');
  });
  
  // Listen to wallet withdrawal events
  on<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>('wallet.withdrawal.completed', async (event: IntegrationEvent<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>) => {
    await handleWalletEvent(event, 'withdrawal');
  });
  
  // Listen to wallet purchase events (for first_purchase bonus)
  on<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>('wallet.purchase.completed', async (event: IntegrationEvent<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>) => {
    await handleWalletEvent(event, 'purchase');
  });
  
  // Listen to wallet bet events (for first_action bonus - gaming context)
  // First bet can be considered first action
  on<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>('wallet.bet.completed', async (event: IntegrationEvent<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>) => {
    await handleWalletEvent(event, 'action');
  });
  
  // Listen to generic wallet action events (for first_action bonus)
  on<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>('wallet.action.completed', async (event: IntegrationEvent<{
    transactionId: string;
    walletId: string;
    type: string;
    amount: number;
    currency: string;
    balance: number;
  }>) => {
    await handleWalletEvent(event, 'action');
  });
  
  logger.info('Event handlers registered', {
    handlers: [
      'wallet.deposit.completed → update user.metadata (type: deposit)',
      'wallet.withdrawal.completed → update user.metadata (type: withdrawal)',
      'wallet.purchase.completed → update user.metadata (type: purchase)',
      'wallet.bet.completed → update user.metadata (type: action)',
      'wallet.action.completed → update user.metadata (type: action)',
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

const AUTH_PERMISSIONS = {
  Query: {
    health: allow,
    authHealth: allow,
    me: isAuthenticated,
    getUser: or(hasRole('system'), can('user', 'read')),
    users: or(hasRole('system'), can('user', 'list')),
    usersByRole: or(hasRole('system'), can('user', 'list')),
    mySessions: isAuthenticated,
    pendingOperations: or(hasRole('system'), isAuthenticated),
    pendingOperation: or(hasRole('system'), isAuthenticated),
    pendingOperationTypes: or(hasRole('system'), isAuthenticated),
    pendingOperationRawData: hasAnyRole('system', 'admin'),
    webhooks: or(hasRole('system'), can('webhook', 'read')),
    webhook: or(hasRole('system'), can('webhook', 'read')),
    webhookStats: or(hasRole('system'), can('webhook', 'read')),
    webhookDeliveries: or(hasRole('system'), can('webhook', 'read')),
  },
  Mutation: {
    register: allow,
    verifyRegistration: allow,
    login: allow,
    forgotPassword: allow,
    resetPassword: allow,
    sendOTP: allow,
    verifyOTP: allow,
    resendOTP: allow,
    logout: isAuthenticated,
    logoutAll: isAuthenticated,
    refreshToken: allow,
    changePassword: isAuthenticated,
    enable2FA: isAuthenticated,
    verify2FA: isAuthenticated,
    disable2FA: isAuthenticated,
    regenerateBackupCodes: isAuthenticated,
    registerWebhook: or(hasRole('system'), can('webhook', 'create')),
    updateWebhook: or(hasRole('system'), can('webhook', 'update')),
    deleteWebhook: or(hasRole('system'), can('webhook', 'delete')),
    testWebhook: or(hasRole('system'), can('webhook', 'execute')),
    updateUserRoles: or(hasRole('system'), can('user', 'update')),
    updateUserPermissions: or(hasRole('system'), can('user', 'update')),
    updateUserStatus: or(hasRole('system'), can('user', 'update')),
  },
};

async function main() {
  await runServiceStartup<Awaited<ReturnType<typeof loadConfig>>>({
    serviceName: SERVICE_NAME,
    registerErrorCodes: () => registerServiceErrorCodes(AUTH_ERROR_CODES),
    registerConfigDefaults: () => {
      registerServiceConfigDefaults(SERVICE_NAME, AUTH_CONFIG_DEFAULTS);
      registerServiceConfigDefaults('gateway', { ...GATEWAY_JWT_DEFAULTS, ...GATEWAY_DATABASE_DEFAULTS, ...GATEWAY_COMMON_DEFAULTS });
    },
    resolveContext: async () => {
      const c = await resolveContext();
      return { brand: c.brand ?? 'default', tenantId: c.tenantId };
    },
    loadConfig: (brand?: string, tenantId?: string) => loadConfig(brand, tenantId),
    validateConfig,
    printConfigSummary,
    afterDb: async (context, config) => {
      authConfig = config;
      setAuthConfig(config);
      const { database: registrationDb, strategy, context: defaultContext } = await db.initialize({ brand: context.brand, tenantId: context.tenantId });
      authDatabaseStrategy = strategy;
      authDefaultContext = defaultContext;
      logger.info('Database initialized via service database accessor', { database: registrationDb.databaseName, context: defaultContext });
      otpProviders = new OTPProviderFactory(config);
      authenticationService = new AuthenticationService(config);
      registrationService = new RegistrationService(config, otpProviders, authenticationService, { database: registrationDb, databaseStrategy: strategy, defaultContext });
      otpService = new OTPService(config, otpProviders);
      passwordService = new PasswordService(config, otpProviders);
      twoFactorService = new TwoFactorService();
      configurePassport(config);
      authResolvers = createAuthResolvers(registrationService, authenticationService, otpService, passwordService, twoFactorService, config);
      authWebhookServiceInstance = createWebhookService({
        manager: authWebhooks as any,
        eventsDocs: `Authentication Service Webhook Events: user.registered, user.login, user.logout, user.email_verified, user.phone_verified, user.password_changed, user.password_reset, user.2fa_enabled, user.2fa_disabled, user.locked, user.unlocked, user.suspended, user.deleted, user.metadata, session.created, session.expired, session.revoked, social.connected, social.disconnected, user.*`,
      });
    },
    buildGatewayConfig: (config) => buildDefaultGatewayConfig(config, {
      services: [{ name: 'auth', types: authGraphQLTypes, resolvers: authResolvers }, authWebhookServiceInstance!],
      permissions: AUTH_PERMISSIONS,
      name: config.serviceName,
    }),
    ensureDefaults: true,
    withRedis: { redis },
    afterGateway: async () => {
      setupEventHandlers();
      try {
        await initializeWebhooks(authWebhooks, { databaseStrategy: authDatabaseStrategy!, defaultContext: authDefaultContext! });
        logger.info('Auth webhooks initialized via centralized helper');
      } catch (error) {
        logger.error('Failed to initialize auth webhooks', { error });
      }
      setupCleanupTasks([
        { name: 'webhook deliveries', execute: async () => cleanupAuthWebhookDeliveries(30), intervalMs: 24 * 60 * 60 * 1000 },
        { name: 'password reset tokens', execute: async () => passwordService.cleanupExpiredTokens(), intervalMs: 24 * 60 * 60 * 1000 },
        { name: 'expired/invalid sessions', execute: async () => authenticationService.cleanupExpiredSessions(), intervalMs: 24 * 60 * 60 * 1000 },
      ]);
      try {
        await startListening(['integration:auth', 'integration:wallet']);
        logger.info('Started listening on event channels', { channels: ['integration:auth', 'integration:wallet'] });
      } catch (err) {
        logger.warn('Could not start event listener', { error: (err as Error).message });
      }
    },
  });
}

// Export webhook manager for advanced use cases
export { authWebhooks };

// Export types for consumers
export type {
  User,
  Session,
  OTP,
  AuthProvider,
  AccountStatus,
  OTPChannel,
  OTPPurpose,
  RegisterInput,
  LoginInput,
  SendOTPInput,
  VerifyOTPInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
  Enable2FAInput,
  Verify2FAInput,
  AuthResponse,
  OTPResponse,
  TwoFactorSetupResponse,
  TokenPair,
} from './types.js';

main().catch((err) => {
  logger.error('Failed to start auth-service', {
    error: getErrorMessage(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

// Setup process-level error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in auth-service', {
    error: getErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in auth-service', {
    reason: getErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit - log and continue (some rejections are acceptable)
});
