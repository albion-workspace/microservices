/**
 * Authentication Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * Exception: core-service or auth bootstrap/core DB may use process.env for strategy resolution (outside this file).
 * AuthConfig extends DefaultServiceConfig (core-service); single config type, aligned with service generator.
 */

import type { AuthConfig } from './types.js';
import { logger, getConfigWithDefault } from 'core-service';
import type { AuthConfigDefaults } from './config-defaults.js';

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
  const port = (await getConfigWithDefault<number>(SERVICE_NAME, 'port', { brand, tenantId })) ?? 9001;
  const serviceName = (await getConfigWithDefault<string>(SERVICE_NAME, 'serviceName', { brand, tenantId })) ?? SERVICE_NAME;
  const nodeEnv = (await getConfigWithDefault<string>(SERVICE_NAME, 'nodeEnv', { brand, tenantId })) ?? (await getConfigWithDefault<string>('gateway', 'nodeEnv', { brand, tenantId })) ?? 'development';
  const otpLength = (await getConfigWithDefault<number>(SERVICE_NAME, 'otpLength', { brand, tenantId })) ?? 6;
  const otpExpiryMinutes = (await getConfigWithDefault<number>(SERVICE_NAME, 'otpExpiryMinutes', { brand, tenantId })) ?? 10;
  const sessionMaxAge = (await getConfigWithDefault<number>(SERVICE_NAME, 'sessionMaxAge', { brand, tenantId })) ?? 30;
  const maxActiveSessions = (await getConfigWithDefault<number>(SERVICE_NAME, 'maxActiveSessions', { brand, tenantId })) ?? 5;
  const passwordMinLength = (await getConfigWithDefault<number>(SERVICE_NAME, 'passwordMinLength', { brand, tenantId })) ?? 8;
  const passwordRequireUppercase = (await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireUppercase', { brand, tenantId })) ?? true;
  const passwordRequireNumbers = (await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireNumbers', { brand, tenantId })) ?? true;
  const passwordRequireSymbols = (await getConfigWithDefault<boolean>(SERVICE_NAME, 'passwordRequireSymbols', { brand, tenantId })) ?? true;

  // Per-service JWT first; fallback to shared 'gateway' key (like database strategy)
  const jwtConfig =
    (await getConfigWithDefault<AuthConfigDefaults['jwt']>(SERVICE_NAME, 'jwt', { brand, tenantId })) ??
    (await getConfigWithDefault<AuthConfigDefaults['jwt']>('gateway', 'jwt', { brand, tenantId })) ??
    {
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
  const whatsappConfig = await getConfigWithDefault<AuthConfigDefaults['whatsapp']>(SERVICE_NAME, 'whatsapp', { brand, tenantId }) ?? { apiKey: '' };
  const telegramConfig = await getConfigWithDefault<AuthConfigDefaults['telegram']>(SERVICE_NAME, 'telegram', { brand, tenantId }) ?? { botToken: '' };
  const urlsConfig = await getConfigWithDefault<AuthConfigDefaults['urls'] & { notificationServiceUrl?: string; notificationServiceToken?: string }>(SERVICE_NAME, 'urls', { brand, tenantId }) ?? {
    frontendUrl: 'http://localhost:5173',
    appUrl: 'http://localhost:3000',
    notificationServiceUrl: 'http://localhost:9004/graphql',
    notificationServiceToken: '',
  };
  const corsOrigins = (await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId })) ?? (await getConfigWithDefault<string[]>('gateway', 'corsOrigins', { brand, tenantId })) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  const databaseConfig = (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId })) ?? (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>('gateway', 'database', { brand, tenantId })) ?? { mongoUri: '', redisUrl: '' };

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
