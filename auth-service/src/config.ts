/**
 * Authentication Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * Exception: core-service or auth bootstrap/core DB may use process.env for strategy resolution (outside this file).
 * AuthConfig extends DefaultServiceConfig (core-service); single config type, aligned with service generator.
 */

import type { AuthConfig } from './types.js';
import { logger, getServiceConfigKey } from 'core-service';
import type { AuthConfigDefaults } from './config-defaults.js';

/** Options for config keys that fall back to gateway (port, nodeEnv, corsOrigins, jwt, database) */
const optsGateway = (brand?: string, tenantId?: string) => ({ brand, tenantId, fallbackService: 'gateway' as const });
const optsService = (brand?: string, tenantId?: string) => ({ brand, tenantId });

export type { AuthConfig } from './types.js';

export const SERVICE_NAME = 'auth-service';

/** Set by index after loadConfig so graphql, oauth-routes, password, otp-provider can read config without process.env */
let _authConfig: AuthConfig | null = null;
export function setAuthConfig(c: AuthConfig): void {
  _authConfig = c;
}
export function getAuthConfig(): AuthConfig {
  if (!_authConfig) throw new Error('Auth config not loaded yet');
  return _authConfig;
}

export async function loadConfig(brand?: string, tenantId?: string): Promise<AuthConfig> {
  const port = await getServiceConfigKey<number>(SERVICE_NAME, 'port', 9001, optsGateway(brand, tenantId));
  const serviceName = await getServiceConfigKey<string>(SERVICE_NAME, 'serviceName', SERVICE_NAME, optsGateway(brand, tenantId));
  const nodeEnv = await getServiceConfigKey<string>(SERVICE_NAME, 'nodeEnv', 'development', optsGateway(brand, tenantId));
  const corsOrigins = await getServiceConfigKey<string[]>(SERVICE_NAME, 'corsOrigins', [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ], optsGateway(brand, tenantId));
  const jwtConfig = await getServiceConfigKey<AuthConfigDefaults['jwt']>(SERVICE_NAME, 'jwt', {
    expiresIn: '2m',
    refreshExpiresIn: '7d',
    secret: '',
    refreshSecret: '',
  }, optsGateway(brand, tenantId));
  const databaseConfig = await getServiceConfigKey<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { mongoUri: '', redisUrl: '' }, optsGateway(brand, tenantId));

  const otpLength = await getServiceConfigKey<number>(SERVICE_NAME, 'otpLength', 6, optsService(brand, tenantId));
  const otpExpiryMinutes = await getServiceConfigKey<number>(SERVICE_NAME, 'otpExpiryMinutes', 10, optsService(brand, tenantId));
  const sessionMaxAge = await getServiceConfigKey<number>(SERVICE_NAME, 'sessionMaxAge', 30, optsService(brand, tenantId));
  const maxActiveSessions = await getServiceConfigKey<number>(SERVICE_NAME, 'maxActiveSessions', 5, optsService(brand, tenantId));
  const passwordMinLength = await getServiceConfigKey<number>(SERVICE_NAME, 'passwordMinLength', 8, optsService(brand, tenantId));
  const passwordRequireUppercase = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireUppercase', true, optsService(brand, tenantId));
  const passwordRequireNumbers = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireNumbers', true, optsService(brand, tenantId));
  const passwordRequireSymbols = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireSymbols', true, optsService(brand, tenantId));
  const oauthConfig = await getServiceConfigKey<AuthConfigDefaults['oauth']>(SERVICE_NAME, 'oauth', {
    google: { clientId: '', clientSecret: '', callbackUrl: '' },
    facebook: { appId: '', appSecret: '', callbackUrl: '' },
    linkedin: { clientId: '', clientSecret: '', callbackUrl: '' },
    instagram: { clientId: '', clientSecret: '', callbackUrl: '' },
  }, optsService(brand, tenantId));
  const smtpConfig = await getServiceConfigKey<AuthConfigDefaults['smtp']>(SERVICE_NAME, 'smtp', {
    host: '',
    port: 587,
    user: '',
    password: '',
    from: '',
  }, optsService(brand, tenantId));
  const twilioConfig = await getServiceConfigKey<AuthConfigDefaults['twilio']>(SERVICE_NAME, 'twilio', {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  }, optsService(brand, tenantId));
  const whatsappConfig = await getServiceConfigKey<AuthConfigDefaults['whatsapp']>(SERVICE_NAME, 'whatsapp', { apiKey: '' }, optsService(brand, tenantId));
  const telegramConfig = await getServiceConfigKey<AuthConfigDefaults['telegram']>(SERVICE_NAME, 'telegram', { botToken: '' }, optsService(brand, tenantId));
  const urlsConfig = await getServiceConfigKey<AuthConfigDefaults['urls'] & { notificationServiceUrl?: string; notificationServiceToken?: string }>(SERVICE_NAME, 'urls', {
    frontendUrl: 'http://localhost:5173',
    appUrl: 'http://localhost:3000',
    notificationServiceUrl: 'http://localhost:9004/graphql',
    notificationServiceToken: '',
  }, optsService(brand, tenantId));

  const portNum = typeof port === 'number' ? port : parseInt(String(port), 10);

  return {
    port: portNum,
    nodeEnv,
    serviceName,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    jwtSecret: jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn,
    passwordMinLength: typeof passwordMinLength === 'number' ? passwordMinLength : parseInt(String(passwordMinLength), 10),
    passwordRequireUppercase,
    passwordRequireNumbers,
    passwordRequireSymbols,
    otpLength: typeof otpLength === 'number' ? otpLength : parseInt(String(otpLength), 10),
    otpExpiryMinutes: typeof otpExpiryMinutes === 'number' ? otpExpiryMinutes : parseInt(String(otpExpiryMinutes), 10),
    sessionMaxAge: typeof sessionMaxAge === 'number' ? sessionMaxAge : parseInt(String(sessionMaxAge), 10),
    maxActiveSessions: typeof maxActiveSessions === 'number' ? maxActiveSessions : parseInt(String(maxActiveSessions), 10),
    frontendUrl: urlsConfig.frontendUrl,
    appUrl: urlsConfig.appUrl,
    googleClientId: oauthConfig.google.clientId || '',
    googleClientSecret: oauthConfig.google.clientSecret || '',
    googleCallbackUrl: oauthConfig.google.callbackUrl || `http://localhost:${portNum}/auth/google/callback`,
    facebookAppId: oauthConfig.facebook.appId || '',
    facebookAppSecret: oauthConfig.facebook.appSecret || '',
    facebookCallbackUrl: oauthConfig.facebook.callbackUrl || `http://localhost:${portNum}/auth/facebook/callback`,
    linkedinClientId: oauthConfig.linkedin.clientId || '',
    linkedinClientSecret: oauthConfig.linkedin.clientSecret || '',
    linkedinCallbackUrl: oauthConfig.linkedin.callbackUrl || `http://localhost:${portNum}/auth/linkedin/callback`,
    instagramClientId: oauthConfig.instagram.clientId || '',
    instagramClientSecret: oauthConfig.instagram.clientSecret || '',
    instagramCallbackUrl: oauthConfig.instagram.callbackUrl || `http://localhost:${portNum}/auth/instagram/callback`,
    twilioAccountSid: twilioConfig.accountSid,
    twilioAuthToken: twilioConfig.authToken,
    twilioPhoneNumber: twilioConfig.phoneNumber,
    smtpHost: smtpConfig.host || undefined,
    smtpPort: smtpConfig.port,
    smtpUser: smtpConfig.user || undefined,
    smtpPassword: smtpConfig.password || undefined,
    smtpFrom: smtpConfig.from,
    whatsappApiKey: whatsappConfig.apiKey,
    telegramBotToken: telegramConfig.botToken,
    corsOrigins,
    notificationServiceUrl: urlsConfig.notificationServiceUrl,
    notificationServiceToken: urlsConfig.notificationServiceToken,
  };
}

/**
 * Validate required configuration
 */
export function validateConfig(config: AuthConfig): void {
  const errors: string[] = [];

  if (!config.jwtSecret || config.jwtSecret === 'shared-jwt-secret-change-in-production') {
    if (config.nodeEnv === 'production') {
      errors.push('JWT_SECRET must be set in production');
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
    mongoUri: config.mongoUri ? config.mongoUri.replace(/:[^:@]+@/, ':***@') : 'using environment default', // Hide password
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
