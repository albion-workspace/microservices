/**
 * Authentication Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * Exception: core-service or auth bootstrap/core DB may use process.env for strategy resolution (outside this file).
 * AuthConfig extends DefaultServiceConfig (core-service); single config type, aligned with service generator.
 */

import type { AuthConfig } from './types.js';
import { logger, loadBaseServiceConfig, getBaseServiceConfigDefaults, getServiceConfigKey, configKeyOpts } from 'core-service';
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
  const base = await loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9001, serviceName: SERVICE_NAME, jwt: { expiresIn: '2m' } }), { brand, tenantId });
  const opts = configKeyOpts(brand, tenantId);

  const otpLength = await getServiceConfigKey<number>(SERVICE_NAME, 'otpLength', 6, opts);
  const otpExpiryMinutes = await getServiceConfigKey<number>(SERVICE_NAME, 'otpExpiryMinutes', 10, opts);
  const sessionMaxAge = await getServiceConfigKey<number>(SERVICE_NAME, 'sessionMaxAge', 30, opts);
  const maxActiveSessions = await getServiceConfigKey<number>(SERVICE_NAME, 'maxActiveSessions', 5, opts);
  const passwordMinLength = await getServiceConfigKey<number>(SERVICE_NAME, 'passwordMinLength', 8, opts);
  const passwordRequireUppercase = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireUppercase', true, opts);
  const passwordRequireNumbers = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireNumbers', true, opts);
  const passwordRequireSymbols = await getServiceConfigKey<boolean>(SERVICE_NAME, 'passwordRequireSymbols', true, opts);
  const oauthConfig = await getServiceConfigKey<AuthConfigDefaults['oauth']>(SERVICE_NAME, 'oauth', {
    google: { clientId: '', clientSecret: '', callbackUrl: '' },
    facebook: { appId: '', appSecret: '', callbackUrl: '' },
    linkedin: { clientId: '', clientSecret: '', callbackUrl: '' },
    instagram: { clientId: '', clientSecret: '', callbackUrl: '' },
  }, opts);
  const smtpConfig = await getServiceConfigKey<AuthConfigDefaults['smtp']>(SERVICE_NAME, 'smtp', {
    host: '',
    port: 587,
    user: '',
    password: '',
    from: '',
  }, opts);
  const twilioConfig = await getServiceConfigKey<AuthConfigDefaults['twilio']>(SERVICE_NAME, 'twilio', {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  }, opts);
  const whatsappConfig = await getServiceConfigKey<AuthConfigDefaults['whatsapp']>(SERVICE_NAME, 'whatsapp', { apiKey: '' }, opts);
  const telegramConfig = await getServiceConfigKey<AuthConfigDefaults['telegram']>(SERVICE_NAME, 'telegram', { botToken: '' }, opts);
  const urlsConfig = await getServiceConfigKey<AuthConfigDefaults['urls'] & { notificationServiceUrl?: string; notificationServiceToken?: string }>(SERVICE_NAME, 'urls', {
    frontendUrl: 'http://localhost:5173',
    appUrl: 'http://localhost:3000',
    notificationServiceUrl: 'http://localhost:9004/graphql',
    notificationServiceToken: '',
  }, opts);

  return {
    ...base,
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
    googleCallbackUrl: oauthConfig.google.callbackUrl || `http://localhost:${base.port}/auth/google/callback`,
    facebookAppId: oauthConfig.facebook.appId || '',
    facebookAppSecret: oauthConfig.facebook.appSecret || '',
    facebookCallbackUrl: oauthConfig.facebook.callbackUrl || `http://localhost:${base.port}/auth/facebook/callback`,
    linkedinClientId: oauthConfig.linkedin.clientId || '',
    linkedinClientSecret: oauthConfig.linkedin.clientSecret || '',
    linkedinCallbackUrl: oauthConfig.linkedin.callbackUrl || `http://localhost:${base.port}/auth/linkedin/callback`,
    instagramClientId: oauthConfig.instagram.clientId || '',
    instagramClientSecret: oauthConfig.instagram.clientSecret || '',
    instagramCallbackUrl: oauthConfig.instagram.callbackUrl || `http://localhost:${base.port}/auth/instagram/callback`,
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
    corsOrigins: base.corsOrigins,
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
