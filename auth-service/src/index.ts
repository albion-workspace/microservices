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
 * - Account security (rate limiting, locking)
 */

import {
  createGateway,
  hasRole,
  isAuthenticated,
  allow,
  logger,
  on,
  startListening,
  getDatabase,
  createWebhookService,
  type IntegrationEvent,
  type ResolverContext,
} from 'core-service';

import { loadConfig, validateConfig, printConfigSummary } from './config.js';
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
  initializeAuthWebhooks,
  cleanupAuthWebhookDeliveries,
  type AuthWebhookEvents,
} from './event-dispatcher.js';

// Re-export for consumers
export { emitAuthEvent, type AuthWebhookEvents };

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const authConfig = loadConfig();
validateConfig(authConfig);

// ═══════════════════════════════════════════════════════════════════
// Initialize Services
// ═══════════════════════════════════════════════════════════════════

const otpProviders = new OTPProviderFactory(authConfig);

const registrationService = new RegistrationService(authConfig, otpProviders);
const authenticationService = new AuthenticationService(authConfig);
const otpService = new OTPService(authConfig, otpProviders);
const passwordService = new PasswordService(authConfig, otpProviders);
const twoFactorService = new TwoFactorService();

// Configure Passport.js strategies
configurePassport(authConfig);

// Create resolvers
const authResolvers = createAuthResolvers(
  registrationService,
  authenticationService,
  otpService,
  passwordService,
  twoFactorService
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
      getUser: hasRole('admin'),
      users: hasRole('admin'),
      mySessions: isAuthenticated,
      // Webhooks (admin only)
      webhooks: hasRole('admin'),
      webhook: hasRole('admin'),
      webhookStats: hasRole('admin'),
      webhookDeliveries: hasRole('admin'),
    },
    Mutation: {
      // Public mutations (no auth required)
      register: allow,
      login: allow,
      forgotPassword: allow,
      resetPassword: allow,
      sendOTP: allow,
      verifyOTP: allow,
      resendOTP: allow,
      
      // Authenticated mutations
      logout: isAuthenticated,
      logoutAll: isAuthenticated,
      refreshToken: allow, // Token validation in resolver
      changePassword: isAuthenticated,
      enable2FA: isAuthenticated,
      verify2FA: isAuthenticated,
      disable2FA: isAuthenticated,
      regenerateBackupCodes: isAuthenticated,
      
      // Webhooks (admin only)
      registerWebhook: hasRole('admin'),
      updateWebhook: hasRole('admin'),
      deleteWebhook: hasRole('admin'),
      testWebhook: hasRole('admin'),
      
      // User Management (admin only)
      updateUserRoles: hasRole('admin'),
      updateUserPermissions: hasRole('admin'),
      updateUserStatus: hasRole('admin'),
    },
  },
  mongoUri: authConfig.mongoUri,
  redisUrl: authConfig.redisUrl,
  defaultPermission: 'deny' as const,
};

// ═══════════════════════════════════════════════════════════════════
// Cross-Service Event Handlers
// ═══════════════════════════════════════════════════════════════════

function setupEventHandlers() {
  // Example: Listen to events from other services
  // This service typically emits events rather than consuming them
  
  logger.info('Event handlers registered');
}

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                     AUTHENTICATION SERVICE                            ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Features:                                                            ║
║  • Multi-identifier registration (username/email/phone)               ║
║  • Password authentication with security features                     ║
║  • Social OAuth (Google, Facebook, LinkedIn, Instagram)               ║
║  • Multi-channel OTP (Email, SMS, WhatsApp, Telegram)                 ║
║  • Two-factor authentication (TOTP + backup codes)                    ║
║  • Password management (forgot/reset/change)                          ║
║  • JWT + refresh token management                                     ║
║  • Session management & device tracking                               ║
║  • Account security (rate limiting, locking, validation)              ║
║  • Dynamic user metadata (flexible fields)                            ║
║                                                                       ║
║  Security:                                                            ║
║  • Password: min ${authConfig.passwordMinLength} chars, uppercase, numbers, symbols       ║
║  • Max login attempts: ${authConfig.maxLoginAttempts} (locks for ${authConfig.lockoutDuration}min)                   ║
║  • OTP: ${authConfig.otpLength} digits, expires in ${authConfig.otpExpiryMinutes} minutes                       ║
║  • Session: max ${authConfig.sessionMaxAge} days                                          ║
║                                                                       ║
║  Available OTP Channels:                                              ║
║  ${otpProviders.getAvailableChannels().map(c => `• ${c}`).join('\n║  ') || '  • None configured'}
║                                                                       ║
║  Social Auth Providers:                                               ║
║  ${[
    authConfig.googleClientId ? '• Google' : null,
    authConfig.facebookAppId ? '• Facebook' : null,
    authConfig.linkedinClientId ? '• LinkedIn' : null,
    authConfig.instagramClientId ? '• Instagram' : null,
  ].filter(Boolean).join('\n║  ') || '  • None configured'}
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  printConfigSummary(authConfig);

  // Register event handlers
  setupEventHandlers();

  // Create and start gateway first (this connects to database)
  await createGateway({
    ...config,
  });

  // Initialize webhooks AFTER database connection is established
  try {
    await initializeAuthWebhooks();
  } catch (error) {
    logger.error('Failed to initialize auth webhooks', { error });
    // Continue - webhooks are optional
  }
  
  // Cleanup old webhook deliveries daily
  setInterval(async () => {
    try {
      const deleted = await cleanupAuthWebhookDeliveries(30);
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old webhook deliveries`);
      }
    } catch (err) {
      logger.error('Webhook cleanup failed', { error: err });
    }
  }, 24 * 60 * 60 * 1000); // Daily
  
  // Cleanup expired OTPs hourly
  setInterval(async () => {
    try {
      const deleted = await otpService.cleanupExpiredOTPs();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired OTPs`);
      }
    } catch (err) {
      logger.error('OTP cleanup failed', { error: err });
    }
  }, 60 * 60 * 1000); // Hourly
  
  // Cleanup expired password reset tokens daily
  setInterval(async () => {
    try {
      const deleted = await passwordService.cleanupExpiredTokens();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired password reset tokens`);
      }
    } catch (err) {
      logger.error('Token cleanup failed', { error: err });
    }
  }, 24 * 60 * 60 * 1000); // Daily
  
  // Note: OAuth routes would need to be added via a custom Express middleware
  // For now, OAuth is configured in Passport strategies and can be triggered from frontend
  logger.info('OAuth strategies configured and ready');
  
  // Start listening to Redis events
  if (process.env.REDIS_URL) {
    try {
      const channels = [
        'integration:auth',
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
  RefreshToken,
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
