/**
 * Authentication Service
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
  getDatabase,
  createWebhookService,
  setupCleanupTasks,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  ensureDefaultConfigsCreated,
  resolveContext,
  initializeServiceDatabase,
  initializeWebhooks,
  type IntegrationEvent,
  type ResolverContext,
  type DatabaseStrategyResolver,
  type DatabaseContext,
} from 'core-service';

import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { AUTH_CONFIG_DEFAULTS } from './config-defaults.js';
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
      const db = getDatabase();
      const usersCollection = db.collection('users');
      
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

async function main() {
  // ═══════════════════════════════════════════════════════════════════
  // Configuration
  // ═══════════════════════════════════════════════════════════════════

  // Register default configs (auto-created in DB if missing)
  registerServiceConfigDefaults('auth-service', AUTH_CONFIG_DEFAULTS);

  // Load config (MongoDB + env vars + defaults)
  // Resolve brand/tenantId dynamically (from user context, config store, or env vars)
  const context = await resolveContext();
  authConfig = await loadConfig(context.brand, context.tenantId);
  validateConfig(authConfig);

  // ═══════════════════════════════════════════════════════════════════
  // Initialize Services
  // ═══════════════════════════════════════════════════════════════════

  // Initialize database using centralized helper
  // Auth-service uses core_service database (users, sessions are shared)
  // Use 'core-service' as serviceName so per-service strategy resolves to 'core_service'
  const { database: registrationDb, strategy: databaseStrategy, context: defaultContext } = await initializeServiceDatabase({
    serviceName: 'core-service', // Users are in core_service database
    brand: context.brand,
    tenantId: context.tenantId,
  });
  
  logger.info('Database initialized via initializeServiceDatabase', {
    database: registrationDb.databaseName,
    context: defaultContext,
  });

  otpProviders = new OTPProviderFactory(authConfig);
  authenticationService = new AuthenticationService(authConfig);
  registrationService = new RegistrationService(authConfig, otpProviders, authenticationService, {
    database: registrationDb, // Use core_service database directly
    databaseStrategy,
    defaultContext,
  });
  otpService = new OTPService(authConfig, otpProviders);
  passwordService = new PasswordService(authConfig, otpProviders);
  twoFactorService = new TwoFactorService();

  // Configure Passport.js strategies
  configurePassport(authConfig);

  // Create resolvers
  authResolvers = createAuthResolvers(
    registrationService,
    authenticationService,
    otpService,
    passwordService,
    twoFactorService,
    authConfig // Pass config for JWT secret access
  );

  // ═══════════════════════════════════════════════════════════════════
  // Webhook Service
  // ═══════════════════════════════════════════════════════════════════

  const webhookService = createWebhookService({
    manager: authWebhooks as any,
    eventsDocs: `
      Authentication Service Webhook Events:
      • user.registered - New user registered
      • user.login - User logged in
      • user.logout - User logged out
      • user.email_verified - Email verified
      • user.phone_verified - Phone verified
      • user.password_changed - Password changed
      • user.password_reset - Password reset
      • user.2fa_enabled - Two-factor authentication enabled
      • user.2fa_disabled - Two-factor authentication disabled
      • user.locked - Account locked due to failed attempts
      • user.unlocked - Account unlocked
      • user.suspended - Account suspended
      • user.deleted - Account deleted
      • user.metadata - User metadata updated (type: deposit/withdrawal/purchase/action)
      • session.created - New session created
      • session.expired - Session expired
      • session.revoked - Session revoked
      • social.connected - Social profile connected
      • social.disconnected - Social profile disconnected
      • user.* - All user events (wildcard)
    `,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Gateway Configuration
  // ═══════════════════════════════════════════════════════════════════

  const config = {
    name: authConfig.serviceName,
    port: authConfig.port,
    cors: {
      origins: authConfig.corsOrigins,
    },
    jwt: {
      secret: authConfig.jwtSecret,
      refreshSecret: authConfig.jwtRefreshSecret,
      expiresIn: authConfig.jwtExpiresIn,
      refreshExpiresIn: authConfig.jwtRefreshExpiresIn,
    },
    services: [
      { 
        name: 'auth', 
        types: authGraphQLTypes, 
        resolvers: authResolvers 
      },
      webhookService,
    ],
    permissions: {
      Query: {
        health: allow,
        authHealth: allow,
        me: isAuthenticated,
        // URN-based permissions for user management
        getUser: or(hasRole('system'), can('user', 'read')), // System or user:read permission
        users: or(hasRole('system'), can('user', 'list')), // System or user:list permission
        usersByRole: or(hasRole('system'), can('user', 'list')), // System or user:list permission
        mySessions: isAuthenticated,
        // Pending Operations - allow all authenticated users (including system)
        // Same pattern as payment-service: transactions, transfers, etc.
        pendingOperations: or(hasRole('system'), isAuthenticated),
        pendingOperation: or(hasRole('system'), isAuthenticated),
        pendingOperationTypes: or(hasRole('system'), isAuthenticated),
        pendingOperationRawData: hasAnyRole('system', 'admin'), // Admin-only for security
        // Webhooks (system only - using URN for consistency)
        webhooks: or(hasRole('system'), can('webhook', 'read')),
        webhook: or(hasRole('system'), can('webhook', 'read')),
        webhookStats: or(hasRole('system'), can('webhook', 'read')),
        webhookDeliveries: or(hasRole('system'), can('webhook', 'read')),
      },
      Mutation: {
        // Public mutations (no auth required)
        register: allow,
        verifyRegistration: allow, // Public - part of registration flow
        login: allow,
        forgotPassword: allow,
        resetPassword: allow,
        sendOTP: allow,
        verifyOTP: allow,
        resendOTP: allow,
        
        // Authenticated mutations (users can manage their own account)
        logout: isAuthenticated,
        logoutAll: isAuthenticated,
        refreshToken: allow, // Token validation in resolver
        changePassword: isAuthenticated, // Users can change their own password
        enable2FA: isAuthenticated, // Users can enable 2FA for themselves
        verify2FA: isAuthenticated,
        disable2FA: isAuthenticated,
        regenerateBackupCodes: isAuthenticated,
        
        // Webhooks (system only - using URN for consistency)
        registerWebhook: or(hasRole('system'), can('webhook', 'create')),
        updateWebhook: or(hasRole('system'), can('webhook', 'update')),
        deleteWebhook: or(hasRole('system'), can('webhook', 'delete')),
        testWebhook: or(hasRole('system'), can('webhook', 'execute')),

        // User Management (system only - using URN for granular control)
        updateUserRoles: or(hasRole('system'), can('user', 'update')), // System or user:update permission
        updateUserPermissions: or(hasRole('system'), can('user', 'update')), // System or user:update permission
        updateUserStatus: or(hasRole('system'), can('user', 'update')), // System or user:update permission
      },
    },
    mongoUri: authConfig.mongoUri,
    redisUrl: authConfig.redisUrl,
    defaultPermission: 'deny' as const,
  };

  printConfigSummary(authConfig);

  // Register error codes
  registerServiceErrorCodes(AUTH_ERROR_CODES);

  // Register event handlers
  setupEventHandlers();

  // Create resolvers
  authResolvers = createAuthResolvers(
    registrationService,
    authenticationService,
    otpService,
    passwordService,
    twoFactorService,
    authConfig // Pass config for JWT secret access
  );

  // Create and start gateway first (this connects to database)
  await createGateway({
    ...config,
  });

  // Ensure all registered default configs are created in database
  // This happens after database connection is established
  try {
    const createdCount = await ensureDefaultConfigsCreated('auth-service', {
      brand: context.brand,
      tenantId: context.tenantId,
    });
    if (createdCount > 0) {
      logger.info(`Created ${createdCount} default config(s) in database`);
    }
  } catch (error) {
    logger.warn('Failed to ensure default configs are created', { error });
    // Continue - configs will be created on first access
  }

  // Initialize webhooks AFTER database connection is established
  // Use centralized initializeWebhooks helper from core-service
  try {
    await initializeWebhooks(authWebhooks, {
      databaseStrategy,
      defaultContext,
    });
    logger.info('Auth webhooks initialized via centralized helper');
  } catch (error) {
    logger.error('Failed to initialize auth webhooks', { error });
    // Continue - webhooks are optional
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // Unified Cleanup System
  // ═══════════════════════════════════════════════════════════════════
  
  // Setup all cleanup tasks using unified system
  setupCleanupTasks([
    {
      name: 'webhook deliveries',
      execute: async () => cleanupAuthWebhookDeliveries(30),
      intervalMs: 24 * 60 * 60 * 1000, // Daily
    },
    {
      name: 'password reset tokens (legacy DB entries)',
      execute: async () => passwordService.cleanupExpiredTokens(),
      intervalMs: 24 * 60 * 60 * 1000, // Daily
    },
    {
      name: 'expired/invalid sessions',
      execute: async () => authenticationService.cleanupExpiredSessions(),
      intervalMs: 24 * 60 * 60 * 1000, // Daily
    },
    // Note: Pending operations (Redis) don't need cleanup - Redis TTL auto-expires keys
    // Note: OTPs use JWT-based pending operations, so they auto-expire (no cleanup needed)
  ]);
  
  logger.info('Unified cleanup system initialized');
  
  // Note: OAuth routes would need to be added via a custom Express middleware
  // For now, OAuth is configured in Passport strategies and can be triggered from frontend
  logger.info('OAuth strategies configured and ready');
  
  // Start listening to Redis events
  if (process.env.REDIS_URL) {
    try {
      const channels = [
        'integration:auth',      // Auth service events
        'integration:wallet',    // Payment service events (wallet.deposit.completed, etc.)
      ];
      await startListening(channels);
      logger.info('Started listening on event channels', { channels });
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  }
  
  logger.info('Auth service started successfully', { port: config.port });
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
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

// Setup process-level error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in auth-service', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in auth-service', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit - log and continue (some rejections are acceptable)
});
