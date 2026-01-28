/**
 * Authentication Service Configuration
 * 
 * Centralized configuration management with dynamic MongoDB-based config store.
 * Supports multi-brand/tenant configurations with permission-based access.
 * 
 * Priority order:
 * 1. Environment variables (highest priority - overrides everything)
 * 2. MongoDB config store (dynamic, multi-brand/tenant) - stored in core_service
 * 3. Registered defaults (auto-created if missing)
 * 
 * NOTE: Config is always stored in core_service.service_configs (central)
 * because you need to read the database strategy before connecting to service DB.
 */

import type { AuthConfig as BaseAuthConfig } from './types.js';
import { 
  logger, 
  getConfigWithDefault, 
  loadConfig as loadConfigFromCore,
  resolveRedisUrlFromConfig,
} from 'core-service';
import type { AuthConfigDefaults } from './config-defaults.js';

/**
 * Extended AuthConfig with service-specific settings
 */
export interface AuthConfig extends BaseAuthConfig {
  // Service
  port: number;
  nodeEnv: string;
  serviceName: string;
  
  // Database
  mongoUri: string;
  redisUrl?: string;
  
  // URLs
  frontendUrl: string;
  appUrl: string;
  
  // CORS
  corsOrigins: string[];
}

// Service name constant
const SERVICE_NAME = 'auth-service';

/**
 * Load configuration with dynamic MongoDB config store support
 * 
 * Priority order:
 * 1. Environment variables (highest priority)
 * 2. MongoDB config store (dynamic, multi-brand/tenant)
 * 3. Registered defaults (auto-created if missing)
 */
export async function loadConfig(brand?: string, tenantId?: string): Promise<AuthConfig> {
  const port = parseInt(process.env.PORT || '3003');
  
  // Load from MongoDB config store (core_service.service_configs) with automatic default creation
  // If config doesn't exist in DB, uses registered default and creates it automatically
  const otpLength = await getConfigWithDefault<number>(SERVICE_NAME, 'otpLength', { brand, tenantId }) ?? 6;
  const otpExpiryMinutes = await getConfigWithDefault<number>(SERVICE_NAME, 'otpExpiryMinutes', { brand, tenantId }) ?? 10;
  const sessionMaxAge = await getConfigWithDefault<number>(SERVICE_NAME, 'sessionMaxAge', { brand, tenantId }) ?? 30;
  const maxActiveSessions = await getConfigWithDefault<number>(SERVICE_NAME, 'maxActiveSessions', { brand, tenantId }) ?? 5;
  const passwordMinLength = await getConfigWithDefault<number>(SERVICE_NAME, 'passwordMinLength', { brand, tenantId }) ?? 8;
  const passwordRequireUppercase = await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireUppercase', { brand, tenantId }) ?? true;
  const passwordRequireNumbers = await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireNumbers', { brand, tenantId }) ?? true;
  const passwordRequireSymbols = await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireSymbols', { brand, tenantId }) ?? true;
  
  // Load nested configs
  const jwtConfig = await getConfigWithDefault<AuthConfigDefaults['jwt']>(SERVICE_NAME, 'jwt', { brand, tenantId }) ?? {
    expiresIn: '1h',
    refreshExpiresIn: '7d',
    secret: '',
    refreshSecret: '',
  };
  
  const oauthConfig = await getConfigWithDefault<AuthConfigDefaults['oauth']>(SERVICE_NAME, 'oauth', { brand, tenantId }) ?? {
    google: { clientId: '', clientSecret: '', callbackUrl: '' },
    facebook: { appId: '', appSecret: '', callbackUrl: '' },
    linkedin: { clientId: '', clientSecret: '', callbackUrl: '' },
    instagram: { clientId: '', clientSecret: '', callbackUrl: '' },
  };
  
  const smtpConfig = await getConfigWithDefault<AuthConfigDefaults['smtp']>(SERVICE_NAME, 'smtp', { brand, tenantId }) ?? {
    host: '',
    port: 587,
    user: '',
    password: '',
    from: '',
  };
  
  const twilioConfig = await getConfigWithDefault<AuthConfigDefaults['twilio']>(SERVICE_NAME, 'twilio', { brand, tenantId }) ?? {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  };
  
  const whatsappConfig = await getConfigWithDefault<AuthConfigDefaults['whatsapp']>(SERVICE_NAME, 'whatsapp', { brand, tenantId }) ?? {
    apiKey: '',
  };
  
  const telegramConfig = await getConfigWithDefault<AuthConfigDefaults['telegram']>(SERVICE_NAME, 'telegram', { brand, tenantId }) ?? {
    botToken: '',
  };
  
  const urlsConfig = await getConfigWithDefault<AuthConfigDefaults['urls']>(SERVICE_NAME, 'urls', { brand, tenantId }) ?? {
    frontendUrl: 'http://localhost:5173',
    appUrl: 'http://localhost:3000',
  };
  
  const corsOrigins = await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId }) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  
  // Load database config (for MongoDB URI and Redis URL resolution)
  const dbConfig = await getConfigWithDefault<{ strategy: string; mongoUri?: string; dbNameTemplate?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId });
  
  // Resolve MongoDB URI from config or env
  // IMPORTANT: Use database strategy to resolve the correct database name
  // For per-service strategy, this will be 'auth_service', but users should be in 'core_service'
  // So we need to resolve the base URI and use 'core_service' as the database name
  let mongoUri: string;
  if (process.env.MONGO_URI) {
    mongoUri = process.env.MONGO_URI;
  } else if (dbConfig?.mongoUri) {
    // Extract base URI (without database name) and use core_service
    const uriTemplate = dbConfig.mongoUri;
    // Remove database name from URI if present, keep only host/port/options
    const baseUri = uriTemplate.replace(/\/[^\/\?]+(\?|$)/, '/core_service$1').replace(/{service}/g, 'core_service');
    mongoUri = baseUri;
  } else {
    mongoUri = 'mongodb://localhost:27017/core_service?directConnection=true';
  }
  
  // Resolve Redis URL from config or env
  const resolvedRedisUrl = await resolveRedisUrlFromConfig(SERVICE_NAME, { brand, tenantId });
  const redisUrl = process.env.REDIS_URL 
    || resolvedRedisUrl
    || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`;
  
  // Build config object (env vars override MongoDB configs)
  return {
    // Service
    port,
    nodeEnv: process.env.NODE_ENV || 'development',
    serviceName: process.env.SERVICE_NAME || 'auth-service',
    
    // Database - Fully configurable from MongoDB config store
    mongoUri,
    redisUrl,
    
    // JWT - Env vars override MongoDB configs
    jwtSecret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || jwtConfig.expiresIn,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || jwtConfig.refreshSecret || 'shared-jwt-secret-change-in-production',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || jwtConfig.refreshExpiresIn,
    
    // Password Policy - Env vars override MongoDB configs
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || String(passwordMinLength)),
    passwordRequireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false' ? passwordRequireUppercase : false,
    passwordRequireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false' ? passwordRequireNumbers : false,
    passwordRequireSymbols: process.env.PASSWORD_REQUIRE_SYMBOLS !== 'false' ? passwordRequireSymbols : false,
    
    // OTP - Env vars override MongoDB configs
    otpLength: parseInt(process.env.OTP_LENGTH || String(otpLength)),
    otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || String(otpExpiryMinutes)),
    
    // Session - Env vars override MongoDB configs
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(sessionMaxAge)),
    maxActiveSessions: parseInt(process.env.MAX_ACTIVE_SESSIONS || String(maxActiveSessions)),
    
    // URLs - Env vars override MongoDB configs
    frontendUrl: process.env.FRONTEND_URL || urlsConfig.frontendUrl,
    appUrl: process.env.APP_URL || urlsConfig.appUrl,
    
    // Google OAuth - Env vars override MongoDB configs
    googleClientId: process.env.GOOGLE_CLIENT_ID || oauthConfig.google.clientId || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || oauthConfig.google.clientSecret || '',
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || oauthConfig.google.callbackUrl || `http://localhost:${port}/auth/google/callback`,
    
    // Facebook OAuth - Env vars override MongoDB configs
    facebookAppId: process.env.FACEBOOK_APP_ID || oauthConfig.facebook.appId || '',
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET || oauthConfig.facebook.appSecret || '',
    facebookCallbackUrl: process.env.FACEBOOK_CALLBACK_URL || oauthConfig.facebook.callbackUrl || `http://localhost:${port}/auth/facebook/callback`,
    
    // LinkedIn OAuth - Env vars override MongoDB configs
    linkedinClientId: process.env.LINKEDIN_CLIENT_ID || oauthConfig.linkedin.clientId || '',
    linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || oauthConfig.linkedin.clientSecret || '',
    linkedinCallbackUrl: process.env.LINKEDIN_CALLBACK_URL || oauthConfig.linkedin.callbackUrl || `http://localhost:${port}/auth/linkedin/callback`,
    
    // Instagram OAuth - Env vars override MongoDB configs
    instagramClientId: process.env.INSTAGRAM_CLIENT_ID || oauthConfig.instagram.clientId || '',
    instagramClientSecret: process.env.INSTAGRAM_CLIENT_SECRET || oauthConfig.instagram.clientSecret || '',
    instagramCallbackUrl: process.env.INSTAGRAM_CALLBACK_URL || oauthConfig.instagram.callbackUrl || `http://localhost:${port}/auth/instagram/callback`,
    
    // Twilio - Env vars override MongoDB configs
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || twilioConfig.accountSid,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || twilioConfig.authToken,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || twilioConfig.phoneNumber,
    
    // SMTP - Env vars override MongoDB configs
    smtpHost: process.env.SMTP_HOST || smtpConfig.host,
    smtpPort: parseInt(process.env.SMTP_PORT || String(smtpConfig.port)),
    smtpUser: process.env.SMTP_USER || smtpConfig.user,
    smtpPassword: process.env.SMTP_PASSWORD || smtpConfig.password,
    smtpFrom: process.env.SMTP_FROM || smtpConfig.from,
    
    // WhatsApp - Env vars override MongoDB configs
    whatsappApiKey: process.env.WHATSAPP_API_KEY || whatsappConfig.apiKey,
    
    // Telegram - Env vars override MongoDB configs
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || telegramConfig.botToken,
    
    // CORS - Env vars override MongoDB configs
    corsOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
      : corsOrigins,
  };
}

/**
 * Validate required configuration
 */
export function validateConfig(config: AuthConfig): void {
  const errors: string[] = [];
  
  if (!config.mongoUri) {
    errors.push('MONGO_URI is required');
  }
  
  if (!config.jwtSecret || config.jwtSecret === 'shared-jwt-secret-change-in-production') {
    if (config.nodeEnv === 'production') {
      errors.push('JWT_SECRET or SHARED_JWT_SECRET must be set in production');
    } else {
      logger.warn('⚠ WARNING: Using default JWT_SECRET. Change in production!');
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

/**
 * Print configuration summary (without sensitive data)
 */
export function printConfigSummary(config: AuthConfig): void {
  logger.info('Configuration:', {
    environment: config.nodeEnv,
    port: config.port,
    mongoUri: config.mongoUri.replace(/:[^:@]+@/, ':***@'), // Hide password
    redisUrl: config.redisUrl ? 'configured' : 'not configured',
    frontendUrl: config.frontendUrl,
    jwtExpiry: config.jwtExpiresIn,
  });
  
  const oauthProviders: string[] = [];
  if (config.googleClientId) oauthProviders.push('Google');
  if (config.facebookAppId) oauthProviders.push('Facebook');
  if (config.linkedinClientId) oauthProviders.push('LinkedIn');
  if (config.instagramClientId) oauthProviders.push('Instagram');
  
  logger.info('Available OAuth Providers', { 
    providers: oauthProviders.length > 0 ? oauthProviders : ['None configured'] 
  });
  
  const otpChannels: string[] = [];
  if (config.smtpHost) otpChannels.push('Email (SMTP)');
  if (config.twilioAccountSid) {
    otpChannels.push('SMS (Twilio)');
    otpChannels.push('WhatsApp (Twilio)');
  }
  if (config.telegramBotToken) otpChannels.push('Telegram');
  
  logger.info('Available OTP Channels', { 
    channels: otpChannels.length > 0 ? otpChannels : ['None configured'] 
  });
}
