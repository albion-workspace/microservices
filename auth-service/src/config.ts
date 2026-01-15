/**
 * Authentication Service Configuration
 * 
 * Centralized configuration management
 * All values from environment variables with sensible defaults
 */

import type { AuthConfig as BaseAuthConfig } from './types.js';

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

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AuthConfig {
  const port = parseInt(process.env.PORT || '3003');
  
  return {
    // Service
    port,
    nodeEnv: process.env.NODE_ENV || 'development',
    serviceName: process.env.SERVICE_NAME || 'auth-service',
    
    // Database
    // Note: When connecting from localhost, directConnection=true prevents replica set member discovery
    // which would try to resolve Docker hostnames like ms-mongo that don't exist on the host machine
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service?directConnection=true',
    // Redis password: default is redis123 (from Docker container), can be overridden via REDIS_PASSWORD env var
    redisUrl: process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`,
    
    // JWT - Use shared secret for all services
    jwtSecret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    
    // Password Policy
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8'),
    passwordRequireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    passwordRequireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
    passwordRequireSymbols: process.env.PASSWORD_REQUIRE_SYMBOLS !== 'false',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '15'),
    
    // OTP
    otpLength: parseInt(process.env.OTP_LENGTH || '6'),
    otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10'),
    otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '3'),
    
    // Session
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || '30'),
    maxActiveSessions: parseInt(process.env.MAX_ACTIVE_SESSIONS || '5'),
    
    // URLs
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    
    // Google OAuth
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/auth/google/callback`,
    
    // Facebook OAuth
    facebookAppId: process.env.FACEBOOK_APP_ID,
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
    facebookCallbackUrl: process.env.FACEBOOK_CALLBACK_URL || `http://localhost:${port}/auth/facebook/callback`,
    
    // LinkedIn OAuth
    linkedinClientId: process.env.LINKEDIN_CLIENT_ID,
    linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    linkedinCallbackUrl: process.env.LINKEDIN_CALLBACK_URL || `http://localhost:${port}/auth/linkedin/callback`,
    
    // Instagram OAuth
    instagramClientId: process.env.INSTAGRAM_CLIENT_ID,
    instagramClientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
    instagramCallbackUrl: process.env.INSTAGRAM_CALLBACK_URL || `http://localhost:${port}/auth/instagram/callback`,
    
    // Twilio
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    
    // SMTP
    smtpHost: process.env.SMTP_HOST,
    smtpPort: parseInt(process.env.SMTP_PORT || '587'),
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpFrom: process.env.SMTP_FROM,
    
    // WhatsApp
    whatsappApiKey: process.env.WHATSAPP_API_KEY,
    
    // Telegram
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    
    // CORS
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173')
      .split(',')
      .map(origin => origin.trim()),
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
      console.warn('⚠ WARNING: Using default JWT_SECRET. Change in production!');
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
  console.log('Configuration:');
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  MongoDB: ${config.mongoUri}`);
  console.log(`  Redis: ${config.redisUrl || 'not configured'}`);
  console.log(`  Frontend URL: ${config.frontendUrl}`);
  console.log(`  JWT Expiry: ${config.jwtExpiresIn}`);
  console.log('');
  
  console.log('Available OAuth Providers:');
  if (config.googleClientId) console.log('  ✓ Google');
  if (config.facebookAppId) console.log('  ✓ Facebook');
  if (config.linkedinClientId) console.log('  ✓ LinkedIn');
  if (config.instagramClientId) console.log('  ✓ Instagram');
  if (!config.googleClientId && !config.facebookAppId && !config.linkedinClientId && !config.instagramClientId) {
    console.log('  - None configured');
  }
  console.log('');
  
  console.log('Available OTP Channels:');
  if (config.smtpHost) console.log('  ✓ Email (SMTP)');
  if (config.twilioAccountSid) console.log('  ✓ SMS (Twilio)');
  if (config.twilioAccountSid) console.log('  ✓ WhatsApp (Twilio)');
  if (config.telegramBotToken) console.log('  ✓ Telegram');
  if (!config.smtpHost && !config.twilioAccountSid && !config.telegramBotToken) {
    console.log('  - None configured');
  }
  console.log('');
}
