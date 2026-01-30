/**
 * Notification Service Configuration
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

import { 
  logger, 
  getConfigWithDefault, 
  resolveRedisUrlFromConfig,
} from 'core-service';
import type { NotificationConfig } from './types.js';

export type { NotificationConfig };

// Service name constant
const SERVICE_NAME = 'notification-service';

/**
 * Load configuration with dynamic MongoDB config store support
 * 
 * Priority order:
 * 1. Environment variables (highest priority)
 * 2. MongoDB config store (from core_service.service_configs)
 * 3. Registered defaults (auto-created if missing)
 */
export async function loadConfig(brand?: string, tenantId?: string): Promise<NotificationConfig> {
  const port = parseInt(process.env.PORT || '9004');
  
  // Load from MongoDB config store (core_service.service_configs) with automatic default creation
  const corsOrigins = await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId }) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  
  const smtpConfig = await getConfigWithDefault<{ host: string; port: number; user: string; password: string; from: string; secure: boolean }>(SERVICE_NAME, 'smtp', { brand, tenantId }) ?? {
    host: '',
    port: 587,
    user: '',
    password: '',
    from: 'noreply@example.com',
    secure: false,
  };
  
  const twilioConfig = await getConfigWithDefault<{ accountSid: string; authToken: string; phoneNumber: string; whatsappNumber: string }>(SERVICE_NAME, 'twilio', { brand, tenantId }) ?? {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
    whatsappNumber: '',
  };
  
  const pushConfig = await getConfigWithDefault<{ apiKey: string; projectId: string }>(SERVICE_NAME, 'push', { brand, tenantId }) ?? {
    apiKey: '',
    projectId: '',
  };
  
  const queueConfig = await getConfigWithDefault<{ concurrency: number; maxRetries: number; retryDelay: number }>(SERVICE_NAME, 'queue', { brand, tenantId }) ?? {
    concurrency: 5,
    maxRetries: 3,
    retryDelay: 5000,
  };
  
  const realtimeConfig = await getConfigWithDefault<{ sseHeartbeatInterval: number; socketNamespace: string }>(SERVICE_NAME, 'realtime', { brand, tenantId }) ?? {
    sseHeartbeatInterval: 30000,
    socketNamespace: '/notifications',
  };
  
  // Load database config (for MongoDB URI and Redis URL resolution)
  const dbConfig = await getConfigWithDefault<{ strategy: string; mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId });
  
  // Resolve MongoDB URI from config or env
  const mongoUri = process.env.MONGO_URI 
    || (dbConfig?.mongoUri 
      ? dbConfig.mongoUri.replace(/{service}/g, 'notification_service')
      : 'mongodb://localhost:27017/notification_service?directConnection=true');
  
  // Resolve Redis URL from config or env
  const resolvedRedisUrl = await resolveRedisUrlFromConfig(SERVICE_NAME, { brand, tenantId });
  const redisUrl = process.env.REDIS_URL 
    || resolvedRedisUrl
    || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`;
  
  // Build config object (env vars override MongoDB configs)
  return {
    // Service
    port: parseInt(process.env.PORT || String(port)),
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // Database - Fully configurable from MongoDB config store
    mongoUri,
    redisUrl,
    
    // SMTP - Env vars override MongoDB configs
    smtpHost: process.env.SMTP_HOST || smtpConfig.host,
    smtpPort: parseInt(process.env.SMTP_PORT || String(smtpConfig.port)),
    smtpUser: process.env.SMTP_USER || smtpConfig.user,
    smtpPassword: process.env.SMTP_PASSWORD || smtpConfig.password,
    smtpFrom: process.env.SMTP_FROM || smtpConfig.from,
    smtpSecure: process.env.SMTP_SECURE === 'true' ? true : smtpConfig.secure,
    
    // Twilio - Env vars override MongoDB configs
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || twilioConfig.accountSid,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || twilioConfig.authToken,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || twilioConfig.phoneNumber,
    twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER || twilioConfig.whatsappNumber,
    
    // Push Notifications - Env vars override MongoDB configs
    pushProviderApiKey: process.env.PUSH_PROVIDER_API_KEY || pushConfig.apiKey,
    pushProviderProjectId: process.env.PUSH_PROVIDER_PROJECT_ID || pushConfig.projectId,
    
    // Queue - Env vars override MongoDB configs
    queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || String(queueConfig.concurrency)),
    queueMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || String(queueConfig.maxRetries)),
    queueRetryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || String(queueConfig.retryDelay)),
    
    // Real-time - Env vars override MongoDB configs
    sseHeartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || String(realtimeConfig.sseHeartbeatInterval)),
    socketNamespace: process.env.SOCKET_NAMESPACE || realtimeConfig.socketNamespace,
  };
}

export function validateConfig(config: NotificationConfig): void {
  const errors: string[] = [];
  
  if (!config.mongoUri) {
    errors.push('MONGO_URI is required');
  }
  
  // Warn about missing providers
  if (!config.smtpHost) {
    logger.warn('SMTP not configured - Email notifications disabled');
  }
  
  if (!config.twilioAccountSid) {
    logger.warn('Twilio not configured - SMS/WhatsApp notifications disabled');
  }
  
  if (!config.pushProviderApiKey) {
    logger.warn('Push provider not configured - Push notifications disabled');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export function printConfigSummary(config: NotificationConfig): void {
  logger.info('Configuration:', {
    Port: config.port,
    MongoDB: config.mongoUri,
    Redis: config.redisUrl || 'not configured',
  });
  
  const availableChannels = [
    config.smtpHost && 'Email (SMTP)',
    config.twilioAccountSid && 'SMS (Twilio)',
    config.twilioWhatsAppNumber && 'WhatsApp (Twilio)',
    config.pushProviderApiKey && 'Push Notifications',
    'SSE (Server-Sent Events)',
    'Socket.IO (Real-time)',
  ].filter(Boolean);
  
  logger.info('Available Channels:', { channels: availableChannels });
}
